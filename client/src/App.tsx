import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { createSavedRoute, fetchMe, fetchRoute, fetchSavedRoute, fetchSavedRoutes, fetchStations, fetchStationCount, login, logout, signup, updatePreferences } from './services/api';
import type { Station } from './types/station';
import type { RouteResponse, RouteStation, TruckStopAlongRoute } from './types/route';
import type { SavedRoute } from './types/savedRoute';
import RoutePlanner from './components/RoutePlanner';
import AuthModal from './components/AuthModal';
import AccountModal from './components/AccountModal';
import type { User, UserPreferences } from './types/user';

// Fix Leaflet marker icons
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const AUTO_WAYPOINT_ICON = L.divIcon({
  className: 'auto-waypoint-div-icon',
  html: '<div class="auto-waypoint-marker">W</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

function createPinIcon(options: { fill: string; stroke: string }): L.Icon {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
      <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="${options.fill}" stroke="${options.stroke}" stroke-width="1"/>
      <circle cx="12.5" cy="12.5" r="5" fill="#fff"/>
    </svg>
  `.trim();

  const iconUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  return L.icon({
    iconUrl,
    iconRetinaUrl: iconUrl,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    tooltipAnchor: [16, -28],
    shadowUrl: markerShadow,
    shadowSize: [41, 41],
    shadowAnchor: [12, 41],
  });
}

const START_ICON = createPinIcon({ fill: '#22c55e', stroke: '#14532d' });
const END_ICON = createPinIcon({ fill: '#ef4444', stroke: '#7f1d1d' });
const TRUCK_STOP_ICON = createPinIcon({ fill: '#f97316', stroke: '#9a3412' });
const MUST_STOP_ICON = createPinIcon({ fill: '#facc15', stroke: '#92400e' });

const DEFAULT_CENTER: [number, number] = [39.8283, -98.5795]; // Center of US
const DEFAULT_ZOOM = 4;
const METERS_PER_MILE = 1609.344;
const MUST_STOP_GAP_MILES = 120;
const MUST_STOP_AFTER_MILES = 50;

// Default truck stop brands to show on route (major chains only)
const DEFAULT_TRUCK_STOP_BRANDS = new Set([
  // Love's
  "Love's CS",
  "Love's TS",
  "Loves TS",
  // Pilot / Flying J (main travel centers only)
  "Flying J Travel Center",
  "Pilot Travel Center",
  // TA + Petro
  "TA Express",
  "Petro",
  // Road Ranger
  "Road Ranger",
]);

type RoutePlanParams = {
  start: string;
  end: string;
  waypoints: string[];
  corridorMiles: number;
  autoCorridor: boolean;
  preference: 'fastest' | 'charger_optimized';
};

function replaceUrlSearch(search: string) {
  const next = `${window.location.pathname}${search}${window.location.hash ?? ''}`;
  window.history.replaceState({}, '', next);
}

function buildSearchFromPlanParams(params: RoutePlanParams): string {
  const qs = new URLSearchParams();
  qs.set('start', params.start);
  qs.set('end', params.end);
  for (const wp of params.waypoints) {
    if (wp.trim()) qs.append('wp', wp);
  }
  qs.set('corridor', String(params.corridorMiles));
  if (params.autoCorridor) qs.set('auto', '1');
  qs.set('pref', params.preference);
  const query = qs.toString();
  return query ? `?${query}` : '';
}

function buildSearchFromSavedId(id: number): string {
  const qs = new URLSearchParams();
  qs.set('saved', String(id));
  return `?${qs.toString()}`;
}

function parsePlanParamsFromSearch(search: string): RoutePlanParams | null {
  const qs = new URLSearchParams(search);
  const start = qs.get('start');
  const end = qs.get('end');
  if (!start || !end) return null;

  const waypoints = qs.getAll('wp').map((w) => w.trim()).filter(Boolean);
  const corridorRaw = qs.get('corridor');
  const corridorMiles = corridorRaw ? Number.parseFloat(corridorRaw) : 30;
  const autoCorridor = qs.get('auto') === '1';
  const preferenceRaw = qs.get('pref');
  const preference = preferenceRaw === 'charger_optimized' ? 'charger_optimized' : 'fastest';

  return {
    start,
    end,
    waypoints,
    corridorMiles: Number.isFinite(corridorMiles) ? Math.max(0, corridorMiles) : 30,
    autoCorridor,
    preference,
  };
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * 6_371_000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function computeMaxGapSegmentMiles(stations: RouteStation[], totalMiles: number): { startMiles: number; endMiles: number; lengthMiles: number } {
  if (stations.length === 0) {
    return { startMiles: 0, endMiles: totalMiles, lengthMiles: totalMiles };
  }

  let bestStart = 0;
  let bestEnd = Math.max(0, stations[0]!.distance_along_route_miles);
  let bestLen = Math.max(0, bestEnd - bestStart);

  for (let i = 1; i < stations.length; i += 1) {
    const start = Math.max(0, stations[i - 1]!.distance_along_route_miles);
    const end = Math.max(start, stations[i]!.distance_along_route_miles);
    const len = end - start;
    if (len > bestLen) {
      bestLen = len;
      bestStart = start;
      bestEnd = end;
    }
  }

  const last = Math.max(0, stations[stations.length - 1]!.distance_along_route_miles);
  const endGapLen = Math.max(0, totalMiles - last);
  if (endGapLen > bestLen) {
    bestLen = endGapLen;
    bestStart = last;
    bestEnd = totalMiles;
  }

  return { startMiles: bestStart, endMiles: bestEnd, lengthMiles: bestLen };
}

function pointAtMiles(options: { geometry: [number, number][]; summaryDistanceMeters: number; miles: number }): [number, number] | null {
  const { geometry, summaryDistanceMeters, miles } = options;
  if (!Number.isFinite(miles) || geometry.length < 2) return null;

  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 1; i < geometry.length; i += 1) {
    total += haversineMeters(geometry[i - 1]!, geometry[i]!);
    cumulative[i] = total;
  }
  const scale = total > 0 ? summaryDistanceMeters / total : 1;
  const targetUnscaled = scale > 0 ? (miles * METERS_PER_MILE) / scale : miles * METERS_PER_MILE;
  const clamped = Math.max(0, Math.min(total, targetUnscaled));

  for (let i = 1; i < geometry.length; i += 1) {
    const prev = cumulative[i - 1]!;
    const next = cumulative[i]!;
    if (clamped > next) continue;
    const span = next - prev;
    const t = span > 0 ? (clamped - prev) / span : 0;
    const [lat1, lng1] = geometry[i - 1]!;
    const [lat2, lng2] = geometry[i]!;
    return [lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t];
  }

  return geometry[geometry.length - 1] ?? null;
}

function sliceGeometryByMiles(options: { geometry: [number, number][]; summaryDistanceMeters: number; startMiles: number; endMiles: number }): [number, number][] | null {
  const { geometry, summaryDistanceMeters } = options;
  if (geometry.length < 2) return null;

  const startMiles = Math.max(0, Math.min(options.startMiles, options.endMiles));
  const endMiles = Math.max(startMiles, options.endMiles);
  if (!Number.isFinite(startMiles) || !Number.isFinite(endMiles) || endMiles <= startMiles) return null;

  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 1; i < geometry.length; i += 1) {
    total += haversineMeters(geometry[i - 1]!, geometry[i]!);
    cumulative[i] = total;
  }
  const scale = total > 0 ? summaryDistanceMeters / total : 1;
  const startUnscaled = scale > 0 ? (startMiles * METERS_PER_MILE) / scale : startMiles * METERS_PER_MILE;
  const endUnscaled = scale > 0 ? (endMiles * METERS_PER_MILE) / scale : endMiles * METERS_PER_MILE;
  const startTarget = Math.max(0, Math.min(total, startUnscaled));
  const endTarget = Math.max(0, Math.min(total, endUnscaled));

  const startPoint = pointAtMiles({ geometry, summaryDistanceMeters, miles: startMiles });
  const endPoint = pointAtMiles({ geometry, summaryDistanceMeters, miles: endMiles });
  if (!startPoint || !endPoint) return null;

  const segment: [number, number][] = [startPoint];

  for (let i = 1; i < geometry.length - 1; i += 1) {
    const dist = cumulative[i]!;
    if (dist <= startTarget) continue;
    if (dist >= endTarget) break;
    segment.push(geometry[i]!);
  }

  segment.push(endPoint);
  return segment.length >= 2 ? segment : null;
}

function formatMiles(miles: number): string {
  if (!Number.isFinite(miles)) return '';
  if (miles < 10) return miles.toFixed(1);
  return `${Math.round(miles)}`;
}

function formatElevationFeet(deltaFeet: number | undefined): string {
  if (typeof deltaFeet !== 'number' || !Number.isFinite(deltaFeet)) return '';
  const rounded = Math.round(deltaFeet);
  if (rounded === 0) return '0 ft';
  return rounded > 0 ? `+${rounded} ft` : `${rounded} ft`;
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

function PanToSelection({ position }: { position: [number, number] | null }) {
  const map = useMap();

  useEffect(() => {
    if (!position) return;
    const targetZoom = Math.max(map.getZoom(), 12);
    map.setView(position, targetZoom, { animate: true });
  }, [map, position]);

  return null;
}

function RouteStationMarker({
  station,
  index,
  mapZoom,
  selected,
  isAutoWaypoint,
  isMustStop,
  onSelect,
}: {
  station: RouteStation;
  index: number;
  mapZoom: number;
  selected: boolean;
  isAutoWaypoint: boolean;
  isMustStop: boolean;
  onSelect: (stationId: number) => void;
}) {
  const markerRef = useRef<L.Marker>(null);
  const iconProps = useMemo(() => {
    if (isAutoWaypoint) return { icon: AUTO_WAYPOINT_ICON };
    if (isMustStop) return { icon: MUST_STOP_ICON };
    return {};
  }, [isAutoWaypoint, isMustStop]);

  useEffect(() => {
    if (!selected) return;
    markerRef.current?.openPopup();
  }, [selected]);

  return (
    <>
      {isMustStop && (
        <CircleMarker
          center={[station.latitude, station.longitude]}
          radius={18}
          interactive={false}
          pathOptions={{
            color: '#facc15',
            weight: 3,
            opacity: 0.95,
            fillColor: '#facc15',
            fillOpacity: 0.15,
          }}
        />
      )}
      <Marker
        ref={markerRef}
        position={[station.latitude, station.longitude]}
        zIndexOffset={selected ? 1_000 : 0}
        eventHandlers={{
          click: () => onSelect(station.id),
        }}
        {...iconProps}
      >
          <Tooltip
            permanent={mapZoom >= 9}
            direction="top"
            offset={[0, -10]}
            opacity={0.9}
          >
          {index === 0
            ? `+${formatMiles(station.distance_from_prev_miles)} mi${formatElevationFeet(station.elevation_from_prev_ft) ? ` • ${formatElevationFeet(station.elevation_from_prev_ft)}` : ''} from start`
            : `+${formatMiles(station.distance_from_prev_miles)} mi${formatElevationFeet(station.elevation_from_prev_ft) ? ` • ${formatElevationFeet(station.elevation_from_prev_ft)}` : ''}`}
        </Tooltip>
        <Popup>
          <div className="min-w-[220px]">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${station.status_code === 'E' ? 'bg-emerald-500' : 'bg-red-500'}`}
              />
              {station.station_name}
            </h3>
            {station.status_code !== 'E' && (
              <p className="text-red-600 text-sm font-semibold">Temporarily Unavailable</p>
            )}
            <p className="text-slate-600 text-sm">
              {station.street_address}<br />
              {station.city}, {station.state} {station.zip}
            </p>
            <div className="mt-2 text-sm">
              <p><strong>Status:</strong> {station.status_code === 'E' ? 'Operational' : 'Temporarily Unavailable'}</p>
              <p><strong>Chargers:</strong> {station.ev_dc_fast_num} DC Fast</p>
              <p><strong>Max:</strong> {station.max_power_kw ?? '—'} kW</p>
              {station.rank_tier && typeof station.rank === 'number' && (
                <p>
                  <strong>Rank:</strong> {station.rank_tier} #{station.rank}
                  {typeof station.rank_score === 'number' ? ` (${station.rank_score}/100)` : ''}
                </p>
              )}
              <p><strong>Off-route:</strong> {formatMiles(station.distance_to_route_miles)} mi</p>
              <p><strong>Mile marker:</strong> {formatMiles(station.distance_along_route_miles)} mi</p>
              <p>
                <strong>From prev:</strong> {formatMiles(station.distance_from_prev_miles)} mi
                {formatElevationFeet(station.elevation_from_prev_ft) ? ` (${formatElevationFeet(station.elevation_from_prev_ft)})` : ''}
              </p>
              <p>
                <strong>To next:</strong> {formatMiles(station.distance_to_next_miles)} mi
                {formatElevationFeet(station.elevation_to_next_ft) ? ` (${formatElevationFeet(station.elevation_to_next_ft)})` : ''}
              </p>
              {isAutoWaypoint && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-800">
                  Optimizer waypoint
                </p>
              )}
              {isMustStop && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                  MUST STOP
                </p>
              )}
            </div>
          </div>
        </Popup>
      </Marker>
    </>
  );
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
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [selectedTruckStopBrands, setSelectedTruckStopBrands] = useState<Set<string>>(() => new Set());
  const [showMustStopsOnly, setShowMustStopsOnly] = useState<boolean>(false);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [savedRoutesLoading, setSavedRoutesLoading] = useState(false);
  const [savedRoutesError, setSavedRoutesError] = useState<string | null>(null);
  const [plannerInitialParams, setPlannerInitialParams] = useState<RoutePlanParams | null>(null);
  const [plannerKey, setPlannerKey] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const preferencesRef = useRef<UserPreferences | null>(null);

  const routeStops = useMemo(() => {
    if (!route) return [];
    return route.points.map((p) => ({ ...p, position: [p.lat, p.lng] as [number, number] }));
  }, [route]);

  const routeStations = useMemo<RouteStation[]>(() => {
    return route?.stations ?? [];
  }, [route]);

  const mustStopStationIds = useMemo(() => {
    const ids = new Set<number>();
    for (const station of routeStations) {
      if (station.distance_from_prev_miles > MUST_STOP_GAP_MILES && station.distance_to_next_miles > MUST_STOP_AFTER_MILES) {
        ids.add(station.id);
      }
    }
    return ids;
  }, [routeStations]);

  const visibleRouteStations = useMemo(() => {
    if (!showMustStopsOnly) return routeStations;
    if (mustStopStationIds.size === 0) return routeStations;
    return routeStations.filter((station) => mustStopStationIds.has(station.id));
  }, [mustStopStationIds, routeStations, showMustStopsOnly]);

  const routeTruckStops = useMemo<TruckStopAlongRoute[]>(() => {
    return route?.truck_stops ?? [];
  }, [route]);

  const truckStopBrandCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const stop of routeTruckStops) {
      const brand = stop.brand?.trim() ? stop.brand.trim() : 'Unknown';
      counts.set(brand, (counts.get(brand) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => a.brand.localeCompare(b.brand));
  }, [routeTruckStops]);

  const visibleTruckStops = useMemo(() => {
    if (!route) return [];
    if (selectedTruckStopBrands.size === 0) return [];
    return routeTruckStops.filter((stop) => selectedTruckStopBrands.has(stop.brand));
  }, [route, routeTruckStops, selectedTruckStopBrands]);

  useEffect(() => {
    if (!route) {
      setSelectedTruckStopBrands(new Set());
      return;
    }
    // Only select brands that are both in the route AND in our default set
    const routeBrands = new Set((route.truck_stops ?? []).map((s) => s.brand).filter(Boolean));
    const defaultsInRoute = new Set(
      [...routeBrands].filter((brand) => DEFAULT_TRUCK_STOP_BRANDS.has(brand))
    );
    setSelectedTruckStopBrands(defaultsInRoute);
  }, [route]);

  function toggleTruckStopBrand(brand: string) {
    setSelectedTruckStopBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });
  }

  function setAllTruckStopBrands(selectAll: boolean) {
    if (!selectAll) {
      setSelectedTruckStopBrands(new Set());
      return;
    }
    setSelectedTruckStopBrands(new Set(truckStopBrandCounts.map((b) => b.brand)));
  }

  const autoWaypointIds = useMemo(() => {
    const ids = new Set<number>();
    for (const waypoint of route?.auto_waypoints ?? []) {
      ids.add(waypoint.id);
    }
    return ids;
  }, [route]);

  const selectedStation = useMemo(() => {
    if (!selectedStationId) return null;
    return routeStations.find((s) => s.id === selectedStationId) ?? null;
  }, [routeStations, selectedStationId]);

  useEffect(() => {
    if (!showMustStopsOnly) return;
    if (!selectedStationId) return;
    if (mustStopStationIds.has(selectedStationId)) return;
    setSelectedStationId(null);
  }, [mustStopStationIds, selectedStationId, showMustStopsOnly]);

  useEffect(() => {
    if (!route) return;
    if (!showMustStopsOnly) return;
    if (mustStopStationIds.size > 0) return;
    setShowMustStopsOnly(false);
  }, [mustStopStationIds, route, showMustStopsOnly]);

  const maxGapHighlight = useMemo(() => {
    if (!route) return null;
    const totalMiles = route.summary.distance_meters / METERS_PER_MILE;
    if (!Number.isFinite(totalMiles) || totalMiles <= 0) return null;

    const segment = computeMaxGapSegmentMiles(routeStations, totalMiles);
    if (!Number.isFinite(segment.lengthMiles) || segment.lengthMiles <= 0) return null;

    const segmentGeometry = sliceGeometryByMiles({
      geometry: route.geometry,
      summaryDistanceMeters: route.summary.distance_meters,
      startMiles: segment.startMiles,
      endMiles: segment.endMiles,
    });
    if (!segmentGeometry) return null;

    return {
      geometry: segmentGeometry,
      lengthMiles: segment.lengthMiles,
    };
  }, [route, routeStations]);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    void loadData();
    await initializeAuth();
    await initializeFromUrl();
  }

  async function initializeAuth() {
    try {
      const me = await fetchMe();
      setUser(me.user);
      setPreferences(me.preferences);
      preferencesRef.current = me.preferences;
      if (me.user) {
        await loadSavedRoutes(me.user);
      } else {
        setSavedRoutes([]);
        setSavedRoutesError(null);
      }
    } catch (err) {
      console.error('Failed to initialize auth:', err);
      setUser(null);
      setPreferences(null);
      preferencesRef.current = null;
      setSavedRoutes([]);
    }
  }

  useEffect(() => {
    setSelectedStationId(null);
  }, [route]);

  function handleSelectStation(stationId: number) {
    if (showMustStopsOnly && !mustStopStationIds.has(stationId)) {
      setShowMustStopsOnly(false);
    }
    setSelectedStationId(stationId);
  }

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

  async function loadSavedRoutes(activeUser: User | null = user) {
    if (!activeUser) {
      setSavedRoutes([]);
      setSavedRoutesLoading(false);
      setSavedRoutesError(null);
      return;
    }
    setSavedRoutesLoading(true);
    setSavedRoutesError(null);
    try {
      const routes = await fetchSavedRoutes();
      setSavedRoutes(routes);
    } catch (err) {
      setSavedRoutesError(err instanceof Error ? err.message : 'Failed to load saved routes');
    } finally {
      setSavedRoutesLoading(false);
    }
  }

  async function planRoute(params: RoutePlanParams): Promise<RouteResponse | null> {
    setRouteLoading(true);
    setRouteError(null);
    try {
      const prefs = preferencesRef.current;
      const data = await fetchRoute(params.start, params.end, params.waypoints, params.corridorMiles, params.preference, {
        rangeMiles: prefs?.range_miles,
        minArrivalPercent: prefs?.min_arrival_percent,
        maxDetourFactor: prefs?.max_detour_factor,
        autoCorridor: params.autoCorridor,
      });
      setRoute(data);
      return data;
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : 'Failed to plan route');
      return null;
    } finally {
      setRouteLoading(false);
    }
  }

  async function handlePlanRoute(params: RoutePlanParams) {
    const data = await planRoute(params);
    setPlannerInitialParams(null);
    const corridorMiles = typeof data?.corridor_miles === 'number' && Number.isFinite(data.corridor_miles)
      ? Math.max(0, data.corridor_miles)
      : params.corridorMiles;
    const preference = data?.preference === 'charger_optimized' || data?.preference === 'fastest'
      ? data.preference
      : params.preference;
    replaceUrlSearch(buildSearchFromPlanParams({ ...params, corridorMiles, preference }));
  }

  async function handleLoadSavedRoute(id: number) {
    const saved = await fetchSavedRoute(id);
    const params: RoutePlanParams = {
      start: saved.start_query,
      end: saved.end_query,
      waypoints: saved.waypoints ?? [],
      corridorMiles: saved.corridor_miles ?? 30,
      autoCorridor: false,
      preference: saved.preference ?? 'fastest',
    };
    setPlannerInitialParams(params);
    setPlannerKey((k) => k + 1);
    await planRoute(params);
    replaceUrlSearch(buildSearchFromSavedId(id));
  }

  async function handleSaveRoute(params: RoutePlanParams & { name?: string }) {
    const saved = await createSavedRoute({
      name: params.name,
      start: params.start,
      end: params.end,
      waypoints: params.waypoints,
      corridorMiles: params.corridorMiles,
      preference: params.preference,
    });
    setSavedRoutes((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
    replaceUrlSearch(buildSearchFromSavedId(saved.id));
  }

  async function initializeFromUrl() {
    const qs = new URLSearchParams(window.location.search);
    const savedRaw = qs.get('saved');
    if (savedRaw) {
      const id = Number.parseInt(savedRaw, 10);
      if (Number.isFinite(id) && id > 0) {
        try {
          await handleLoadSavedRoute(id);
        } catch (err) {
          setRouteError(err instanceof Error ? err.message : 'Failed to load saved route');
        }
        return;
      }
    }

    const params = parsePlanParamsFromSearch(window.location.search);
    if (!params) return;

    setPlannerInitialParams(params);
    setPlannerKey((k) => k + 1);
    await planRoute(params);
  }

  function handleClearRoute() {
    setRoute(null);
    setRouteError(null);
    setSelectedStationId(null);
    setPlannerInitialParams(null);
    replaceUrlSearch('');
  }

  async function handleLogin(email: string, password: string) {
    const result = await login(email, password);
    setUser(result.user);
    setPreferences(result.preferences);
    preferencesRef.current = result.preferences;
    await loadSavedRoutes(result.user);
  }

  async function handleSignup(email: string, password: string) {
    const result = await signup(email, password);
    setUser(result.user);
    setPreferences(result.preferences);
    preferencesRef.current = result.preferences;
    await loadSavedRoutes(result.user);
  }

  async function handleLogout() {
    await logout();
    setUser(null);
    setPreferences(null);
    preferencesRef.current = null;
    setSavedRoutes([]);
    setSavedRoutesError(null);
  }

  async function handleSavePreferences(patch: Parameters<typeof updatePreferences>[0]) {
    const updated = await updatePreferences(patch);
    setPreferences(updated);
    preferencesRef.current = updated;
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-[1100] bg-slate-800 border-b border-slate-700 px-6 py-5">
        <div className="flex justify-between items-center">
          <a href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <img
              src="/EV_DC_mapper_logo.png"
              alt="EV DC Route Planner"
              className="h-20"
            />
          </a>
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <div>{loading ? 'Loading...' : `${count} stations`}</div>
            {user ? (
              <div className="flex items-center gap-2">
                <div className="hidden sm:block max-w-[220px] truncate text-slate-300">
                  {user.email}
                </div>
                <button
                  type="button"
                  onClick={() => setAccountModalOpen(true)}
                  className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                >
                  Account
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
              >
                Sign in
              </button>
            )}
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
            key={plannerKey}
            route={route}
            loading={routeLoading}
            error={routeError}
            initialParams={plannerInitialParams}
            savedRoutes={savedRoutes}
            savedRoutesLoading={savedRoutesLoading}
            savedRoutesError={savedRoutesError}
            onPlanRoute={handlePlanRoute}
            onClearRoute={handleClearRoute}
            onSelectStation={handleSelectStation}
            selectedStationId={selectedStationId}
            truckStopBrandCounts={truckStopBrandCounts}
            truckStopTotalCount={routeTruckStops.length}
            truckStopVisibleCount={visibleTruckStops.length}
            visibleTruckStops={visibleTruckStops}
            selectedTruckStopBrands={selectedTruckStopBrands}
            onToggleTruckStopBrand={toggleTruckStopBrand}
            onSetAllTruckStopBrands={setAllTruckStopBrands}
            mustStopStationIds={mustStopStationIds}
            showMustStopsOnly={showMustStopsOnly}
            onSetShowMustStopsOnly={setShowMustStopsOnly}
            isAuthenticated={Boolean(user)}
            onOpenAuth={() => setAuthModalOpen(true)}
            defaultCorridorMiles={preferences?.default_corridor_miles}
            defaultPreference={preferences?.default_preference}
            rangeMiles={preferences?.range_miles}
            minArrivalPercent={preferences?.min_arrival_percent}
            onSaveRoute={user ? handleSaveRoute : undefined}
            onLoadSavedRoute={handleLoadSavedRoute}
          />
        </div>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          className="h-full w-full"
          scrollWheelZoom={true}
          zoomControl={false}
          minZoom={3}
          maxBounds={[[-85, -180], [85, 180]]}
          maxBoundsViscosity={1.0}
        >
          <MapZoomTracker onZoomChange={setMapZoom} />
          <ZoomControl position="bottomright" />
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
              {maxGapHighlight && (
                <Polyline
                  positions={maxGapHighlight.geometry}
                  pathOptions={{ color: '#f59e0b', weight: 8, opacity: 0.75, dashArray: '14 10' }}
                >
                  <Tooltip
                    permanent={mapZoom >= 7}
                    direction="center"
                    opacity={0.9}
                  >
                    Max gap {formatMiles(maxGapHighlight.lengthMiles)} mi
                  </Tooltip>
                </Polyline>
              )}
              <FitRouteBounds geometry={route.geometry} />
              <PanToSelection position={selectedStation ? [selectedStation.latitude, selectedStation.longitude] : null} />
              {routeStops.map((stop, idx) => (
                <Marker
                  key={`route-stop-${idx}`}
                  position={stop.position}
                  icon={idx === 0 ? START_ICON : idx === routeStops.length - 1 ? END_ICON : undefined}
                >
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

              {visibleTruckStops.map((stop) => (
                <Marker
                  key={`truck-stop-${stop.id}`}
                  position={[stop.latitude, stop.longitude]}
                  icon={TRUCK_STOP_ICON}
                >
                  <Popup>
                    <div className="min-w-[220px]">
                      <h3 className="font-bold text-slate-900">{stop.name}</h3>
                      <p className="text-slate-600 text-sm">
                        <strong>{stop.brand}</strong>
                        {stop.city && stop.state ? ` • ${stop.city}, ${stop.state}` : ''}
                      </p>
                      <div className="mt-2 text-sm">
                        {stop.address && (
                          <p><strong>Address:</strong> {stop.address}</p>
                        )}
                        {stop.phone && (
                          <p><strong>Phone:</strong> {stop.phone}</p>
                        )}
                        {typeof stop.truck_parking_spots === 'number' && Number.isFinite(stop.truck_parking_spots) ? (
                          <p><strong>Truck parking:</strong> {stop.truck_parking_spots} spots</p>
                        ) : stop.truck_parking_raw ? (
                          <p><strong>Truck parking:</strong> {stop.truck_parking_raw}</p>
                        ) : null}
                        <p><strong>Off-route:</strong> {formatMiles(stop.distance_to_route_miles)} mi</p>
                        <p><strong>Mile marker:</strong> {formatMiles(stop.distance_along_route_miles)} mi</p>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </>
          )}

          {route ? (
            visibleRouteStations.map((station, idx) => (
              <RouteStationMarker
                key={`route-station-${station.id}-${idx}`}
                station={station}
                index={idx}
                mapZoom={mapZoom}
                selected={station.id === selectedStationId}
                isAutoWaypoint={autoWaypointIds.has(station.id)}
                isMustStop={mustStopStationIds.has(station.id)}
                onSelect={setSelectedStationId}
              />
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

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onLogin={handleLogin}
        onSignup={handleSignup}
      />

      {user && (
        <AccountModal
          open={accountModalOpen}
          user={user}
          preferences={preferences}
          onClose={() => setAccountModalOpen(false)}
          onLogout={handleLogout}
          onSavePreferences={handleSavePreferences}
        />
      )}
    </div>
  );
}

export default App;
