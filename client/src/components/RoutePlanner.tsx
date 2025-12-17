import { useEffect, useMemo, useState } from 'react';
import type { RouteResponse } from '../types/route';
import type { SavedRoute } from '../types/savedRoute';

type Props = {
  route: RouteResponse | null;
  loading: boolean;
  error: string | null;
  selectedStationId?: number | null;
  isAuthenticated?: boolean;
  onOpenAuth?: () => void;
  defaultCorridorMiles?: number;
  defaultPreference?: 'fastest' | 'charger_optimized';
  rangeMiles?: number;
  minArrivalPercent?: number;
  initialParams?: {
    start: string;
    end: string;
    waypoints: string[];
    corridorMiles: number;
    preference: 'fastest' | 'charger_optimized';
  } | null;
  savedRoutes?: SavedRoute[];
  savedRoutesLoading?: boolean;
  savedRoutesError?: string | null;
  onPlanRoute: (params: {
    start: string;
    end: string;
    waypoints: string[];
    corridorMiles: number;
    preference: 'fastest' | 'charger_optimized';
  }) => Promise<void>;
  onClearRoute: () => void;
  onSelectStation?: (stationId: number) => void;
  onSaveRoute?: (params: {
    name?: string;
    start: string;
    end: string;
    waypoints: string[];
    corridorMiles: number;
    preference: 'fastest' | 'charger_optimized';
  }) => Promise<void>;
  onLoadSavedRoute?: (id: number) => Promise<void>;
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

export default function RoutePlanner({
  route,
  loading,
  error,
  selectedStationId,
  isAuthenticated,
  onOpenAuth,
  defaultCorridorMiles,
  defaultPreference,
  rangeMiles,
  minArrivalPercent,
  initialParams,
  savedRoutes,
  savedRoutesLoading,
  savedRoutesError,
  onPlanRoute,
  onClearRoute,
  onSelectStation,
  onSaveRoute,
  onLoadSavedRoute,
}: Props) {
  const [start, setStart] = useState(initialParams?.start ?? '');
  const [end, setEnd] = useState(initialParams?.end ?? '');
  const [waypoints, setWaypoints] = useState<string[]>(initialParams?.waypoints ?? []);
  const [corridorMiles, setCorridorMiles] = useState<number>(initialParams?.corridorMiles ?? defaultCorridorMiles ?? 30);
  const [preference, setPreference] = useState<'fastest' | 'charger_optimized'>(initialParams?.preference ?? defaultPreference ?? 'charger_optimized');
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSavedRoutes, setShowSavedRoutes] = useState(false);

  const routeStations = useMemo(() => route?.stations ?? [], [route]);

  const gapAlert = useMemo(() => {
    if (!route || typeof route.max_gap_miles !== 'number' || !Number.isFinite(route.max_gap_miles)) return null;
    const effectiveRange = typeof rangeMiles === 'number' && Number.isFinite(rangeMiles) ? Math.max(0, rangeMiles) : 210;
    if (effectiveRange <= 0) return null;

    const maxGap = route.max_gap_miles;
    const bufferMiles = effectiveRange - maxGap;
    const configuredMinArrivalPercent = typeof minArrivalPercent === 'number' && Number.isFinite(minArrivalPercent)
      ? Math.max(0, Math.min(100, minArrivalPercent))
      : 10;
    const minBufferMiles = (effectiveRange * configuredMinArrivalPercent) / 100;

    if (maxGap > effectiveRange) {
      return {
        level: 'danger' as const,
        message: `No viable EA-only path for your ${Math.round(effectiveRange)} mi range (max gap ${Math.round(maxGap)} mi). Increase corridor miles, add waypoints, or use another network.`,
      };
    }

    // Warn only when the max-gap would dip below the configured min arrival percent.
    if (bufferMiles < minBufferMiles) {
      const arrivalPercent = Math.max(0, Math.round((bufferMiles / effectiveRange) * 100));
      return {
        level: 'warning' as const,
        message: `Risky max gap: ${Math.round(maxGap)} mi (buffer ${Math.round(bufferMiles)} mi, ~${arrivalPercent}% arrival; below your min ${Math.round(configuredMinArrivalPercent)}%). You may need to slow down, draft, or reroute.`,
      };
    }

    return null;
  }, [minArrivalPercent, rangeMiles, route]);

  const optimizerNote = useMemo(() => {
    if (!route) return null;
    if (route.requested_preference !== 'charger_optimized') return null;
    if (route.preference !== 'fastest') return null;
    return 'No charger-optimized alternative found within detour limits; showing the fastest route.';
  }, [route]);

  useEffect(() => {
    if (initialParams) return;
    if (start.trim() || end.trim()) return;
    if (typeof defaultCorridorMiles === 'number' && Number.isFinite(defaultCorridorMiles)) {
      setCorridorMiles(Math.max(0, defaultCorridorMiles));
    }
    if (defaultPreference === 'fastest' || defaultPreference === 'charger_optimized') {
      setPreference(defaultPreference);
    }
  }, [defaultCorridorMiles, defaultPreference, end, initialParams, start]);

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

  async function handleCopyLink() {
    try {
      let url = window.location.href;
      const startTrimmed = start.trim();
      const endTrimmed = end.trim();
      if (startTrimmed && endTrimmed) {
        const next = new URLSearchParams();
        next.set('start', startTrimmed);
        next.set('end', endTrimmed);
        for (const wp of waypoints.map((w) => w.trim()).filter(Boolean)) {
          next.append('wp', wp);
        }
        next.set('corridor', String(corridorMiles));
        next.set('pref', preference);
        url = `${window.location.origin}${window.location.pathname}?${next.toString()}`;
      }

      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to copy';
      setSaveError(message);
    }
  }

  async function handleSave() {
    if (!onSaveRoute) return;
    if (!start.trim() || !end.trim()) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await onSaveRoute({
        name: saveName.trim() ? saveName.trim() : undefined,
        start: start.trim(),
        end: end.trim(),
        waypoints: waypoints.map((w) => w.trim()).filter(Boolean),
        corridorMiles,
        preference,
      });
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save route');
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadSavedRoute(id: number) {
    if (!onLoadSavedRoute) return;
    setSaveError(null);
    try {
      await onLoadSavedRoute(id);
      setShowSavedRoutes(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to load saved route');
    }
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

        {route?.warning && (
          <div className="text-xs text-amber-100 bg-amber-900/40 border border-amber-800 rounded-md px-3 py-2">
            {route.warning}
          </div>
        )}

        {gapAlert && (
          <div
            className={[
              'text-xs rounded-md px-3 py-2',
              gapAlert.level === 'danger'
                ? 'text-red-100 bg-red-900/50 border border-red-800'
                : 'text-amber-100 bg-amber-900/40 border border-amber-800',
            ].join(' ')}
          >
            {gapAlert.message}
          </div>
        )}

        {optimizerNote && (
          <div className="text-[11px] text-slate-400">
            {optimizerNote}
          </div>
        )}

        {(route || start.trim() || end.trim()) && (
          <div className="text-xs text-slate-200 bg-slate-800/40 border border-slate-700 rounded-md px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-slate-100">Share & save</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isAuthenticated && onOpenAuth) {
                      onOpenAuth();
                      return;
                    }
                    setShowSavedRoutes((v) => !v);
                  }}
                  className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                >
                  Saved routes
                </button>
              </div>
            </div>

            {onSaveRoute ? (
              <div className="mt-2 flex gap-2">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Optional name (e.g. “Austin → Dallas”)"
                  className="flex-1 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-[11px] outline-none focus:ring-2 focus:ring-sky-500"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !start.trim() || !end.trim()}
                  className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 px-3 py-1 text-[11px] font-semibold"
                >
                  {saving ? 'Saving…' : saveSuccess ? 'Saved' : 'Save'}
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <div>Sign in to save routes.</div>
                {onOpenAuth && (
                  <button
                    type="button"
                    onClick={onOpenAuth}
                    className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                  >
                    Sign in
                  </button>
                )}
              </div>
            )}

            {saveError && (
              <div className="mt-2 text-[11px] text-red-200 bg-red-900/40 border border-red-800 rounded-md px-2 py-1">
                {saveError}
              </div>
            )}

            {showSavedRoutes && (
              <div className="mt-2 border-t border-slate-700 pt-2">
                {!isAuthenticated ? (
                  <div className="text-[11px] text-slate-400">
                    Sign in to view your saved routes.
                  </div>
                ) : (
                  <>
                {savedRoutesError && (
                  <div className="text-[11px] text-red-200 bg-red-900/40 border border-red-800 rounded-md px-2 py-1">
                    {savedRoutesError}
                  </div>
                )}
                {savedRoutesLoading ? (
                  <div className="text-[11px] text-slate-400">Loading saved routes…</div>
                ) : (savedRoutes?.length ?? 0) === 0 ? (
                  <div className="text-[11px] text-slate-400">No saved routes yet.</div>
                ) : (
                  <div className="max-h-40 overflow-auto divide-y divide-slate-700">
                    {(savedRoutes ?? []).map((r) => (
                      <div key={r.id} className="py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[11px] text-slate-100 font-medium">
                              {r.name ?? `${r.start_query} → ${r.end_query}`}
                            </div>
                            <div className="truncate text-[11px] text-slate-400">
                              {r.preference === 'charger_optimized' ? 'DC optimized' : 'Fastest'} • {r.corridor_miles} mi
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleLoadSavedRoute(r.id)}
                            className="shrink-0 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                          >
                            Load
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                  </>
                )}
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
                  <button
                    key={`${station.id}-${idx}`}
                    type="button"
                    onClick={onSelectStation ? () => onSelectStation(station.id) : undefined}
                    disabled={!onSelectStation}
                    className={[
                      'w-full text-left px-3 py-2 transition-colors',
                      onSelectStation ? 'hover:bg-slate-700/40' : 'cursor-default',
                      station.id === selectedStationId ? 'bg-slate-700/50' : '',
                    ].join(' ')}
                  >
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
                  </button>
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
