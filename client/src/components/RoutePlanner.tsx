import { useMemo, useState } from 'react';
import type { RouteResponse } from '../types/route';

type Props = {
  route: RouteResponse | null;
  loading: boolean;
  error: string | null;
  onPlanRoute: (params: {
    start: string;
    end: string;
    waypoints: string[];
    corridorMiles: number;
    preference: 'fastest' | 'charger_optimized';
  }) => Promise<void>;
  onClearRoute: () => void;
};

function formatDistanceMiles(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

function formatDuration(durationSeconds: number): string {
  const totalMinutes = Math.round(durationSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} min`;
  return `${hours}h ${minutes}m`;
}

function formatMiles(miles: number): string {
  if (!Number.isFinite(miles)) return '—';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export default function RoutePlanner({ route, loading, error, onPlanRoute, onClearRoute }: Props) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [waypoints, setWaypoints] = useState<string[]>([]);
  const [corridorMiles, setCorridorMiles] = useState<number>(30);
  const [preference, setPreference] = useState<'fastest' | 'charger_optimized'>('fastest');

  const routeStations = useMemo(() => route?.stations ?? [], [route]);

  const canSubmit = useMemo(() => {
    return start.trim().length > 0 && end.trim().length > 0 && !loading;
  }, [start, end, loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    await onPlanRoute({
      start: start.trim(),
      end: end.trim(),
      waypoints: waypoints.map((w) => w.trim()).filter(Boolean),
      corridorMiles,
      preference,
    });
  }

  function addWaypoint() {
    setWaypoints((prev) => [...prev, '']);
  }

  function removeWaypoint(index: number) {
    setWaypoints((prev) => prev.filter((_, i) => i !== index));
  }

  function updateWaypoint(index: number, value: string) {
    setWaypoints((prev) => prev.map((w, i) => (i === index ? value : w)));
  }

  return (
    <div className="bg-slate-900/95 text-slate-100 border border-slate-700 rounded-lg shadow-lg p-4 backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Plan a route</h2>
          <p className="text-xs text-slate-400">Enter a city or full address.</p>
        </div>
        {route && (
          <button
            type="button"
            onClick={onClearRoute}
            className="text-xs text-slate-300 hover:text-white underline"
          >
            Clear
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <div>
          <label className="block text-xs text-slate-300 mb-1" htmlFor="route-start">Start</label>
          <input
            id="route-start"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="e.g. Austin, TX"
            className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
            autoComplete="off"
          />
        </div>

        {waypoints.length > 0 && (
          <div className="space-y-2">
            {waypoints.map((value, idx) => (
              <div key={idx} className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-slate-300 mb-1" htmlFor={`route-waypoint-${idx}`}>
                    Waypoint {idx + 1}
                  </label>
                  <input
                    id={`route-waypoint-${idx}`}
                    value={value}
                    onChange={(e) => updateWaypoint(idx, e.target.value)}
                    placeholder="Optional stop"
                    className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                    autoComplete="off"
                  />
                </div>
                <div className="pt-6">
                  <button
                    type="button"
                    onClick={() => removeWaypoint(idx)}
                    className="text-xs text-slate-300 hover:text-white underline"
                    aria-label={`Remove waypoint ${idx + 1}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={addWaypoint}
            className="text-xs text-slate-300 hover:text-white underline"
          >
            + Add waypoint
          </button>
        </div>

        <div>
          <label className="block text-xs text-slate-300 mb-1" htmlFor="route-preference">
            Route type
          </label>
          <select
            id="route-preference"
            value={preference}
            onChange={(e) => setPreference(e.target.value === 'charger_optimized' ? 'charger_optimized' : 'fastest')}
            className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="fastest">Fastest / default</option>
            <option value="charger_optimized">DC charger optimized</option>
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            Optimized mode may take a longer route to include more stations.
          </p>
        </div>

        <div>
          <label className="block text-xs text-slate-300 mb-1" htmlFor="route-corridor">
            Corridor width
          </label>
          <select
            id="route-corridor"
            value={corridorMiles}
            onChange={(e) => setCorridorMiles(Number.parseInt(e.target.value, 10))}
            className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
          >
            {[5, 10, 15, 20, 25, 30, 40, 50].map((value) => (
              <option key={value} value={value}>
                {value} miles
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            Includes EA stations within this distance of the route.
          </p>
        </div>

        <div>
          <label className="block text-xs text-slate-300 mb-1" htmlFor="route-end">End</label>
          <input
            id="route-end"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            placeholder="e.g. Dallas, TX"
            className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
            autoComplete="off"
          />
        </div>

        {error && (
          <div className="text-xs text-red-200 bg-red-900/50 border border-red-800 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {route && (
          <div className="text-xs text-slate-200 bg-slate-800/60 border border-slate-700 rounded-md px-3 py-2">
            <div className="flex justify-between">
              <span className="text-slate-300">Distance</span>
              <span className="font-medium">{formatDistanceMiles(route.summary.distance_meters)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-slate-300">Duration</span>
              <span className="font-medium">{formatDuration(route.summary.duration_seconds)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-slate-300">Route type</span>
              <span className="font-medium">
                {route.preference === 'charger_optimized' ? 'DC optimized' : 'Fastest'}
              </span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-slate-300">Stations (≤ {route.corridor_miles ?? 15} mi)</span>
              <span className="font-medium">{routeStations.length}</span>
            </div>
            {typeof route.max_gap_miles === 'number' && (
              <div className="flex justify-between mt-1">
                <span className="text-slate-300">Max gap</span>
                <span className="font-medium">{formatMiles(route.max_gap_miles)}</span>
              </div>
            )}
          </div>
        )}

        {route && (
          <div className="text-xs text-slate-200 bg-slate-800/40 border border-slate-700 rounded-md">
            {routeStations.length === 0 ? (
              <div className="px-3 py-2 text-slate-300">
                No EA stations found within {route.corridor_miles ?? 15} miles of this route.
              </div>
            ) : (
              <div className="max-h-56 overflow-auto divide-y divide-slate-700">
                {routeStations.map((station, idx) => (
                  <div key={`${station.id}-${idx}`} className="px-3 py-2">
                    <div className="flex justify-between gap-3">
                      <div className="font-medium text-slate-100 truncate">
                        {idx + 1}. {station.station_name}
                      </div>
                      <div className="shrink-0 text-slate-200">
                        +{formatMiles(station.distance_from_prev_miles)}
                      </div>
                    </div>
                    <div className="mt-0.5 flex justify-between gap-3 text-slate-400">
                      <div className="truncate">
                        {station.city}, {station.state}
                      </div>
                      <div className="shrink-0">
                        off-route {formatMiles(station.distance_to_route_miles)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-md bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-400 px-3 py-2 text-sm font-medium"
        >
          {loading ? 'Planning…' : 'Plan route'}
        </button>
      </form>
    </div>
  );
}
