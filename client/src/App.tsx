import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { fetchRoute, fetchStations, fetchStationCount } from './services/api';
import type { Station } from './types/station';
import type { RouteResponse, RouteStation } from './types/route';
import RoutePlanner from './components/RoutePlanner';

// Fix Leaflet marker icons
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795]; // Center of US
const DEFAULT_ZOOM = 4;
const ROUTE_CORRIDOR_MILES = 15;

function formatMiles(miles: number): string {
  if (!Number.isFinite(miles)) return '';
  if (miles < 10) return miles.toFixed(1);
  return `${Math.round(miles)}`;
}

function FitRouteBounds({ geometry }: { geometry: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (!geometry || geometry.length === 0) return;
    const bounds = L.latLngBounds(geometry.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, geometry]);

  return null;
}

function MapZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);

  useMapEvents({
    zoomend: () => {
      onZoomChange(map.getZoom());
    },
  });

  return null;
}

function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number>(0);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [mapZoom, setMapZoom] = useState<number>(DEFAULT_ZOOM);

  const routeStops = useMemo(() => {
    if (!route) return [];
    return route.points.map((p) => ({ ...p, position: [p.lat, p.lng] as [number, number] }));
  }, [route]);

  const routeStations = useMemo<RouteStation[]>(() => {
    return route?.stations ?? [];
  }, [route]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const [stationData, countData] = await Promise.all([
        fetchStations(),
        fetchStationCount(),
      ]);
      setStations(stationData);
      setCount(countData.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  async function handlePlanRoute(params: { start: string; end: string; waypoints: string[] }) {
    setRouteLoading(true);
    setRouteError(null);
    try {
      const data = await fetchRoute(params.start, params.end, params.waypoints, ROUTE_CORRIDOR_MILES);
      setRoute(data);
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : 'Failed to plan route');
    } finally {
      setRouteLoading(false);
    }
  }

  function handleClearRoute() {
    setRoute(null);
    setRouteError(null);
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-lg font-semibold text-white">EA Route Planner</h1>
            <p className="text-sm text-slate-400">Electrify America station finder</p>
          </div>
          <div className="text-sm text-slate-400">
            {loading ? 'Loading...' : `${count} stations`}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-900/90 text-red-100 px-4 py-2 text-sm">
          {error}
          <button onClick={loadData} className="ml-2 underline">
            Retry
          </button>
        </div>
      )}

      {/* Map */}
      <div className="flex-1 relative">
        <div className="absolute top-4 left-4 z-[1000] w-[360px] max-w-[calc(100%-2rem)]">
          <RoutePlanner
            route={route}
            loading={routeLoading}
            error={routeError}
            onPlanRoute={handlePlanRoute}
            onClearRoute={handleClearRoute}
          />
        </div>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          className="h-full w-full"
          scrollWheelZoom={true}
        >
          <MapZoomTracker onZoomChange={setMapZoom} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {route && (
            <>
              <Polyline
                positions={route.geometry}
                pathOptions={{ color: '#ef4444', weight: 5, opacity: 0.9 }}
              />
              <FitRouteBounds geometry={route.geometry} />
              {routeStops.map((stop, idx) => (
                <Marker key={`route-stop-${idx}`} position={stop.position}>
                  <Popup>
                    <div className="min-w-[200px]">
                      <h3 className="font-bold text-slate-900">
                        {idx === 0 ? 'Start' : idx === routeStops.length - 1 ? 'End' : `Waypoint ${idx}`}
                      </h3>
                      <p className="text-slate-600 text-sm">{stop.label}</p>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </>
          )}

          {route ? (
            routeStations.map((station, idx) => (
              <Marker key={`route-station-${station.id}-${idx}`} position={[station.latitude, station.longitude]}>
                <Tooltip
                  permanent={mapZoom >= 9}
                  direction="top"
                  offset={[0, -10]}
                  opacity={0.9}
                >
                  {idx === 0
                    ? `+${formatMiles(station.distance_from_prev_miles)} mi from start`
                    : `+${formatMiles(station.distance_from_prev_miles)} mi`}
                </Tooltip>
                <Popup>
                  <div className="min-w-[220px]">
                    <h3 className="font-bold text-slate-900">{station.station_name}</h3>
                    <p className="text-slate-600 text-sm">
                      {station.street_address}<br />
                      {station.city}, {station.state} {station.zip}
                    </p>
                    <div className="mt-2 text-sm">
                      <p><strong>Chargers:</strong> {station.ev_dc_fast_num} DC Fast</p>
                      <p><strong>Max:</strong> {station.max_power_kw ?? '—'} kW</p>
                      <p><strong>Off-route:</strong> {formatMiles(station.distance_to_route_miles)} mi</p>
                      <p><strong>Mile marker:</strong> {formatMiles(station.distance_along_route_miles)} mi</p>
                      <p><strong>From prev:</strong> {formatMiles(station.distance_from_prev_miles)} mi</p>
                      <p><strong>To next:</strong> {formatMiles(station.distance_to_next_miles)} mi</p>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))
          ) : (
            stations.map((station) => (
              <Marker key={station.id} position={[station.latitude, station.longitude]}>
                <Popup>
                  <div className="min-w-[200px]">
                    <h3 className="font-bold text-slate-900">{station.station_name}</h3>
                    <p className="text-slate-600 text-sm">
                      {station.street_address}<br />
                      {station.city}, {station.state} {station.zip}
                    </p>
                    <div className="mt-2 text-sm">
                      <p><strong>Chargers:</strong> {station.ev_dc_fast_num} DC Fast</p>
                      <p><strong>Type:</strong> {station.facility_type}</p>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))
          )}
        </MapContainer>
      </div>
    </div>
  );
}

export default App;
