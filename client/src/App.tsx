import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { fetchStations, fetchStationCount } from './services/api';
import type { Station } from './types/station';

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

function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number>(0);

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
      <div className="flex-1">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          className="h-full w-full"
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {stations.map((station) => (
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
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

export default App;
