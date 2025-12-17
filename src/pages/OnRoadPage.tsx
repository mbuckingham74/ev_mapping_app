import { useState } from 'react';
import { Map } from '../components';
import { useAppStore } from '../store';
import {
  sortStationsByRank,
  calculateArrivalBattery,
  getSegmentRiskLevel,
  getFacilityDisplayName,
  getChargerSpeedLabel,
} from '../utils';
import type { Station } from '../types';

export function OnRoadPage() {
  const stations = useAppStore((state) => state.stations);
  const currentBatteryPercent = useAppStore((state) => state.currentBatteryPercent);
  const setCurrentBatteryPercent = useAppStore((state) => state.setCurrentBatteryPercent);
  const preferences = useAppStore((state) => state.preferences);
  const setSelectedStation = useAppStore((state) => state.setSelectedStation);
  const setCurrentLocation = useAppStore((state) => state.setCurrentLocation);

  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [nearbyStations, setNearbyStations] = useState<Station[]>([]);

  async function handleGetLocation() {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      return;
    }

    setIsLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCurrentLocation({
          name: 'Current Location',
          latitude,
          longitude,
        });

        // Find nearby stations (simplified - would use edges in real implementation)
        const nearby = findNearbyStations(stations, latitude, longitude, 5);
        setNearbyStations(sortStationsByRank(nearby));
        setIsLocating(false);
      },
      (error) => {
        setLocationError(error.message);
        setIsLocating(false);
      },
      { enableHighAccuracy: true }
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <h1 className="text-lg font-semibold text-white">On-Road Mode</h1>
        <p className="text-sm text-slate-400">Find your next charging stop</p>
      </header>

      {/* Battery Input */}
      <div className="bg-slate-800/50 border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-4">
          <label className="text-sm text-slate-300">
            Current Battery:
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={currentBatteryPercent}
            onChange={(e) => setCurrentBatteryPercent(Number(e.target.value))}
            className="flex-1 max-w-xs"
          />
          <span className="text-white font-medium w-12">
            {currentBatteryPercent}%
          </span>
          <button
            onClick={handleGetLocation}
            disabled={isLocating}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {isLocating ? 'Locating...' : 'Find Nearby'}
          </button>
        </div>
        {locationError && (
          <p className="text-red-400 text-sm mt-2">{locationError}</p>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex">
        {/* Map */}
        <div className="flex-1">
          <Map
            stations={nearbyStations.length > 0 ? nearbyStations : stations}
            onStationClick={(station) => setSelectedStation(station)}
          />
        </div>

        {/* Nearby stations list */}
        <aside className="w-80 bg-slate-800 border-l border-slate-700 overflow-y-auto hidden lg:block">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
              Reachable Stations
            </h2>

            {nearbyStations.length === 0 ? (
              <p className="text-sm text-slate-400">
                Use the "Find Nearby" button to see reachable stations from your
                current location.
              </p>
            ) : (
              <div className="space-y-3">
                {nearbyStations.slice(0, 5).map((station, index) => (
                  <StationCard
                    key={station.id}
                    station={station}
                    index={index}
                    currentBattery={currentBatteryPercent}
                    vehicleRange={preferences.vehicleRange}
                    onClick={() => setSelectedStation(station)}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

interface StationCardProps {
  station: Station;
  index: number;
  currentBattery: number;
  vehicleRange: number;
  onClick: () => void;
}

function StationCard({
  station,
  index,
  currentBattery,
  vehicleRange,
  onClick,
}: StationCardProps) {
  // Placeholder distance - would come from edges in real implementation
  const distanceMiles = 50 + index * 30;
  const arrivalBattery = calculateArrivalBattery(
    currentBattery,
    distanceMiles,
    vehicleRange
  );
  const riskLevel = getSegmentRiskLevel(distanceMiles, vehicleRange);

  const riskColors = {
    safe: 'border-green-500/50 bg-green-500/10',
    tight: 'border-yellow-500/50 bg-yellow-500/10',
    risky: 'border-red-500/50 bg-red-500/10',
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border ${riskColors[riskLevel]} hover:opacity-80 transition-opacity`}
    >
      <div className="flex justify-between items-start mb-1">
        <h3 className="font-medium text-white text-sm line-clamp-1">
          {station.station_name}
        </h3>
        <span className="text-xs text-slate-400 ml-2">
          {distanceMiles} mi
        </span>
      </div>
      <p className="text-xs text-slate-400 mb-2">
        {getFacilityDisplayName(station.facility_type)}
      </p>
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">
          {station.ev_dc_fast_num} chargers •{' '}
          {getChargerSpeedLabel(station.max_power_kw)}
        </span>
        <span
          className={`font-medium ${
            arrivalBattery < 15 ? 'text-red-400' : 'text-green-400'
          }`}
        >
          ~{Math.round(arrivalBattery)}%
        </span>
      </div>
    </button>
  );
}

/**
 * Find stations within a certain distance (simplified haversine)
 */
function findNearbyStations(
  stations: Station[],
  lat: number,
  lng: number,
  count: number
): Station[] {
  const withDistances = stations.map((station) => ({
    station,
    distance: haversineDistance(lat, lng, station.latitude, station.longitude),
  }));

  return withDistances
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map((item) => item.station);
}

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
