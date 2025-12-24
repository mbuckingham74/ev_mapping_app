import { useEffect, useMemo, useState } from 'react';
import type { RouteResponse, RouteStation, TruckStopAlongRoute, RechargePOICategory } from '../types/route';
import type { SavedRoute } from '../types/savedRoute';

type Props = {
  route: RouteResponse | null;
  loading: boolean;
  error: string | null;
  selectedStationId?: number | null;
  truckStopBrandCounts?: Array<{ brand: string; count: number }>;
  truckStopTotalCount?: number;
  truckStopVisibleCount?: number;
  visibleTruckStops?: TruckStopAlongRoute[];
  selectedTruckStopBrands?: Set<string>;
  onToggleTruckStopBrand?: (brand: string) => void;
  onSetAllTruckStopBrands?: (selectAll: boolean) => void;
  rechargePOICategoryCounts?: Array<{ category: RechargePOICategory; count: number }>;
  rechargePOITotalCount?: number;
  rechargePOIVisibleCount?: number;
  selectedRechargePOICategories?: Set<RechargePOICategory>;
  onToggleRechargePOICategory?: (category: RechargePOICategory) => void;
  onSetAllRechargePOICategories?: (selectAll: boolean) => void;
  mustStopStationIds?: Set<number>;
  showMustStopsOnly?: boolean;
  onSetShowMustStopsOnly?: (showMustStopsOnly: boolean) => void;
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
    autoCorridor: boolean;
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
    autoCorridor: boolean;
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
    autoCorridor: boolean;
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

function formatElevationSummary(gainFeet?: number, lossFeet?: number): string {
  const gain = typeof gainFeet === 'number' && Number.isFinite(gainFeet) ? Math.round(gainFeet) : null;
  const loss = typeof lossFeet === 'number' && Number.isFinite(lossFeet) ? Math.round(lossFeet) : null;
  if (gain === null && loss === null) return '—';
  const gainText = gain === null ? '—' : `+${gain.toLocaleString()} ft`;
  const lossText = loss === null ? '—' : `-${loss.toLocaleString()} ft`;
  return `${gainText} / ${lossText}`;
}

function formatMiles(miles: number): string {
  if (!Number.isFinite(miles)) return '—';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

function formatElevationFeet(deltaFeet: number | undefined): string {
  if (typeof deltaFeet !== 'number' || !Number.isFinite(deltaFeet)) return '—';
  const rounded = Math.round(deltaFeet);
  if (rounded === 0) return '0 ft';
  return rounded > 0 ? `+${rounded} ft` : `${rounded} ft`;
}

function rankBadgeClasses(tier: 'A' | 'B' | 'C' | 'D'): string {
  switch (tier) {
    case 'A':
      return 'border-emerald-700 bg-emerald-900/40 text-emerald-100';
    case 'B':
      return 'border-sky-700 bg-sky-900/40 text-sky-100';
    case 'C':
      return 'border-amber-700 bg-amber-900/40 text-amber-100';
    case 'D':
    default:
      return 'border-slate-600 bg-slate-800/40 text-slate-200';
  }
}

// Google Maps URL with waypoints (max ~23 waypoints due to URL limits)
function buildGoogleMapsUrl(
  startPoint: { lat: number; lng: number; label: string },
  endPoint: { lat: number; lng: number; label: string },
  waypoints: Array<{ lat: number; lng: number }>
): string {
  const origin = `${startPoint.lat},${startPoint.lng}`;
  const destination = `${endPoint.lat},${endPoint.lng}`;

  // Google Maps has a limit on waypoints - take evenly spaced ones if too many
  const maxWaypoints = 20;
  let selectedWaypoints = waypoints;
  if (waypoints.length > maxWaypoints) {
    const step = waypoints.length / maxWaypoints;
    selectedWaypoints = [];
    for (let i = 0; i < maxWaypoints; i++) {
      const idx = Math.floor(i * step);
      if (waypoints[idx]) selectedWaypoints.push(waypoints[idx]);
    }
  }

  const waypointStr = selectedWaypoints
    .map((wp) => `${wp.lat},${wp.lng}`)
    .join('|');

  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode: 'driving',
  });

  if (waypointStr) {
    params.set('waypoints', waypointStr);
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// Apple Maps URL - unfortunately Apple Maps web doesn't support multiple waypoints well
// So we build a URL that at least gets the user started with origin and destination
// and shows the waypoints as a note
function buildAppleMapsUrl(
  startPoint: { lat: number; lng: number; label: string },
  endPoint: { lat: number; lng: number; label: string },
  _waypoints: Array<{ lat: number; lng: number }>
): string {
  // Apple Maps links work best with just origin and destination
  // The native iOS app supports waypoints but the web version doesn't handle them well
  const params = new URLSearchParams({
    saddr: `${startPoint.lat},${startPoint.lng}`,
    daddr: `${endPoint.lat},${endPoint.lng}`,
    dirflg: 'd', // driving
  });

  return `https://maps.apple.com/?${params.toString()}`;
}

// Navigate section with Google/Apple Maps export and print
function NavigateSection({
  route,
  routeStations,
  mustStopStationIds,
  visibleTruckStops,
  onPrintSummary,
}: {
  route: RouteResponse;
  routeStations: RouteStation[];
  mustStopStationIds?: Set<number>;
  visibleTruckStops?: TruckStopAlongRoute[];
  onPrintSummary: (route: RouteResponse, stations: RouteStation[], mustStops?: Set<number>) => void;
}) {
  const [includeTruckStops, setIncludeTruckStops] = useState(true);

  type Waypoint = { lat: number; lng: number; mile: number; type: 'charging' | 'truckstop' };

  // Get charging station waypoints
  const chargingWaypoints = useMemo((): Waypoint[] => {
    const stations = mustStopStationIds && mustStopStationIds.size > 0
      ? routeStations.filter((s) => mustStopStationIds.has(s.id))
      : routeStations.filter((s) => s.rank_tier === 'A' || s.rank_tier === 'B');
    return stations.map((s) => ({
      lat: s.latitude,
      lng: s.longitude,
      mile: s.distance_along_route_miles,
      type: 'charging' as const,
    }));
  }, [routeStations, mustStopStationIds]);

  // Get truck stop waypoints (only visible ones)
  const truckStopWaypoints = useMemo((): Waypoint[] => {
    if (!visibleTruckStops || visibleTruckStops.length === 0) return [];
    return visibleTruckStops.map((ts) => ({
      lat: ts.latitude,
      lng: ts.longitude,
      mile: ts.distance_along_route_miles,
      type: 'truckstop' as const,
    }));
  }, [visibleTruckStops]);

  // Combine and sort by mile marker
  const allWaypoints = useMemo((): Waypoint[] => {
    const waypoints: Waypoint[] = [...chargingWaypoints];
    if (includeTruckStops) {
      waypoints.push(...truckStopWaypoints);
    }
    return waypoints.sort((a, b) => a.mile - b.mile);
  }, [chargingWaypoints, truckStopWaypoints, includeTruckStops]);

  const chargingCount = chargingWaypoints.length;
  const truckStopCount = truckStopWaypoints.length;

  return (
    <div className="text-xs text-slate-200 bg-slate-800/40 border border-slate-700 rounded-md px-3 py-2">
      <div className="font-medium text-slate-100 mb-2">Navigate with stops</div>

      {truckStopCount > 0 && (
        <label className="flex items-center gap-2 mb-2 text-[11px] text-slate-200">
          <input
            type="checkbox"
            checked={includeTruckStops}
            onChange={(e) => setIncludeTruckStops(e.target.checked)}
            className="h-3.5 w-3.5 accent-sky-500"
          />
          Include truck stops ({truckStopCount} visible)
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <a
          href={buildGoogleMapsUrl(
            { lat: route.points[0].lat, lng: route.points[0].lng, label: route.points[0].label },
            { lat: route.points[route.points.length - 1].lat, lng: route.points[route.points.length - 1].lng, label: route.points[route.points.length - 1].label },
            allWaypoints.map((wp) => ({ lat: wp.lat, lng: wp.lng }))
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-md bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-[11px] font-semibold text-center"
        >
          Google Maps
        </a>
        <a
          href={buildAppleMapsUrl(
            { lat: route.points[0].lat, lng: route.points[0].lng, label: route.points[0].label },
            { lat: route.points[route.points.length - 1].lat, lng: route.points[route.points.length - 1].lng, label: route.points[route.points.length - 1].label },
            []
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-md bg-slate-600 hover:bg-slate-500 px-3 py-1.5 text-[11px] font-semibold text-center"
        >
          Apple Maps
        </a>
      </div>
      <div className="mt-1.5 text-[10px] text-slate-400">
        Google Maps: {chargingCount} charging{includeTruckStops && truckStopCount > 0 ? ` + ${truckStopCount} truck stops` : ''} = {allWaypoints.length} waypoints
        <br />
        Apple Maps: start/end only (add stops manually in app)
      </div>
      <button
        type="button"
        onClick={() => onPrintSummary(route, routeStations, mustStopStationIds)}
        className="mt-2 w-full rounded-md border border-slate-600 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-200"
      >
        Print route summary
      </button>
    </div>
  );
}

export default function RoutePlanner({
  route,
  loading,
  error,
  selectedStationId,
  truckStopBrandCounts,
  truckStopTotalCount,
  truckStopVisibleCount,
  visibleTruckStops,
  selectedTruckStopBrands,
  onToggleTruckStopBrand,
  onSetAllTruckStopBrands,
  rechargePOICategoryCounts,
  rechargePOITotalCount,
  rechargePOIVisibleCount,
  selectedRechargePOICategories,
  onToggleRechargePOICategory,
  onSetAllRechargePOICategories,
  mustStopStationIds,
  showMustStopsOnly,
  onSetShowMustStopsOnly,
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
  const initialAutoCorridor = initialParams?.autoCorridor ?? true;
  const [start, setStart] = useState(initialParams?.start ?? '');
  const [end, setEnd] = useState(initialParams?.end ?? '');
  const [waypoints, setWaypoints] = useState<string[]>(initialParams?.waypoints ?? []);
  const [autoCorridor, setAutoCorridor] = useState<boolean>(initialAutoCorridor);
  const [corridorMiles, setCorridorMiles] = useState<number>(() => (
    initialAutoCorridor ? 5 : (initialParams?.corridorMiles ?? defaultCorridorMiles ?? 30)
  ));
  const [preference, setPreference] = useState<'fastest' | 'charger_optimized'>(initialParams?.preference ?? defaultPreference ?? 'charger_optimized');
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSavedRoutes, setShowSavedRoutes] = useState(false);

  const routeStations = useMemo(() => route?.stations ?? [], [route]);
  const mustStopCount = useMemo(() => mustStopStationIds?.size ?? 0, [mustStopStationIds]);

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
    if (!autoCorridor && typeof defaultCorridorMiles === 'number' && Number.isFinite(defaultCorridorMiles)) {
      setCorridorMiles(Math.max(0, defaultCorridorMiles));
    }
    if (defaultPreference === 'fastest' || defaultPreference === 'charger_optimized') {
      setPreference(defaultPreference);
    }
  }, [autoCorridor, defaultCorridorMiles, defaultPreference, end, initialParams, start]);

  useEffect(() => {
    const used = route?.corridor_miles;
    if (typeof used !== 'number' || !Number.isFinite(used)) return;
    setCorridorMiles((current) => {
      if (!Number.isFinite(current) || current < 0) return Math.max(0, used);
      return current === used ? current : Math.max(0, used);
    });
  }, [route?.corridor_miles]);

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
      autoCorridor,
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
        if (autoCorridor) next.set('auto', '1');
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
        autoCorridor,
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

  function handlePrintSummary(
    routeData: RouteResponse,
    stations: RouteStation[],
    mustStops?: Set<number>
  ) {
    const startLabel = routeData.points[0]?.label ?? 'Start';
    const endLabel = routeData.points[routeData.points.length - 1]?.label ?? 'End';
    const totalMiles = (routeData.summary.distance_meters / 1609.344).toFixed(0);
    const totalHours = Math.floor(routeData.summary.duration_seconds / 3600);
    const totalMins = Math.round((routeData.summary.duration_seconds % 3600) / 60);

    const stationRows = stations
      .map((s, idx) => {
        const isMustStop = mustStops?.has(s.id) ?? false;
        const mustStopBadge = isMustStop ? ' [MUST STOP]' : '';
        const tierBadge = s.rank_tier ? ` (${s.rank_tier})` : '';
        const statusBadge = s.status_code !== 'E' ? ' <span style="color: #dc2626; font-weight: bold;">[OFFLINE]</span>' : '';
        const statusDot = s.status_code === 'E'
          ? '<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; margin-right: 6px;"></span>'
          : '<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #dc2626; margin-right: 6px;"></span>';
        return `
          <tr style="border-bottom: 1px solid #ddd;${s.status_code !== 'E' ? ' background: #fef2f2;' : ''}">
            <td style="padding: 8px; text-align: center;">${idx + 1}</td>
            <td style="padding: 8px;">
              ${statusDot}<strong>${s.station_name}</strong>${tierBadge}${mustStopBadge}${statusBadge}<br>
              <span style="color: #666; font-size: 12px;">${s.street_address}<br>${s.city}, ${s.state} ${s.zip}</span>
            </td>
            <td style="padding: 8px; text-align: center;">${formatMiles(s.distance_along_route_miles)}</td>
            <td style="padding: 8px; text-align: center;">+${formatMiles(s.distance_from_prev_miles)}</td>
            <td style="padding: 8px; text-align: center;">${s.ev_dc_fast_num} DC</td>
            <td style="padding: 8px; text-align: center;">${s.max_power_kw ?? '—'} kW</td>
          </tr>
        `;
      })
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Route Summary - ${startLabel} to ${endLabel}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 900px; margin: 0 auto; }
          h1 { font-size: 24px; margin-bottom: 8px; }
          .subtitle { color: #666; margin-bottom: 20px; }
          .summary { background: #f5f5f5; padding: 16px; border-radius: 8px; margin-bottom: 20px; }
          .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
          .summary-item { text-align: center; }
          .summary-value { font-size: 24px; font-weight: bold; }
          .summary-label { font-size: 12px; color: #666; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th { background: #333; color: white; padding: 10px; text-align: left; }
          th:nth-child(1), th:nth-child(3), th:nth-child(4), th:nth-child(5), th:nth-child(6) { text-align: center; }
          tr:nth-child(even) { background: #f9f9f9; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <h1>EV Route Summary</h1>
        <div class="subtitle">${startLabel} → ${endLabel}</div>

        <div class="summary">
          <div class="summary-grid">
            <div class="summary-item">
              <div class="summary-value">${totalMiles}</div>
              <div class="summary-label">Miles</div>
            </div>
            <div class="summary-item">
              <div class="summary-value">${totalHours}h ${totalMins}m</div>
              <div class="summary-label">Drive Time</div>
            </div>
            <div class="summary-item">
              <div class="summary-value">${stations.length}</div>
              <div class="summary-label">Stations</div>
            </div>
            <div class="summary-item">
              <div class="summary-value">${routeData.max_gap_miles ? formatMiles(routeData.max_gap_miles) : '—'}</div>
              <div class="summary-label">Max Gap</div>
            </div>
          </div>
        </div>

        <h2>Charging Stations Along Route</h2>
        <table>
          <thead>
            <tr>
              <th style="width: 40px;">#</th>
              <th>Station</th>
              <th style="width: 80px;">Mile</th>
              <th style="width: 80px;">Gap</th>
              <th style="width: 70px;">Chargers</th>
              <th style="width: 70px;">Power</th>
            </tr>
          </thead>
          <tbody>
            ${stationRows}
          </tbody>
        </table>

        <div class="footer">
          Generated by EV DC Route Planner • ev.tachyonfuture.com • ${new Date().toLocaleDateString()}
        </div>

        <div class="no-print" style="margin-top: 20px; text-align: center;">
          <button onclick="window.print()" style="padding: 10px 24px; font-size: 16px; cursor: pointer;">Print / Save as PDF</button>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
    }
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
          <div className="flex items-center justify-between gap-3 mb-1">
            <label className="block text-xs text-slate-300" htmlFor="route-corridor">
              Corridor width
            </label>
            <label className="inline-flex items-center gap-2 text-[11px] text-slate-300">
              <input
                type="checkbox"
                checked={autoCorridor}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setAutoCorridor(checked);
                  if (checked) setCorridorMiles(5);
                }}
                className="h-3.5 w-3.5 accent-sky-500"
              />
              Auto
            </label>
          </div>
          <select
            id="route-corridor"
            value={corridorMiles}
            onChange={(e) => setCorridorMiles(Number.parseInt(e.target.value, 10))}
            disabled={autoCorridor}
            className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {[5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80].map((value) => (
              <option key={value} value={value}>
                {value} miles
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            {autoCorridor
              ? 'Starts narrow and widens only if needed to keep max gaps within your range.'
              : 'Includes EA stations within this distance of the route.'}
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
            {(typeof route.summary.elevation_gain_ft === 'number' || typeof route.summary.elevation_loss_ft === 'number') && (
              <div className="flex justify-between mt-1">
                <span className="text-slate-300">Elevation</span>
                <span className="font-medium">
                  {formatElevationSummary(route.summary.elevation_gain_ft, route.summary.elevation_loss_ft)}
                </span>
              </div>
            )}
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
            {mustStopStationIds && (
              <div className="flex justify-between mt-1">
                <span className="text-slate-300">Must stops</span>
                <span className="font-medium">{mustStopCount}</span>
              </div>
            )}
            {typeof route.max_gap_miles === 'number' && (
              <div className="flex justify-between mt-1">
                <span className="text-slate-300">Max gap</span>
                <span className="font-medium">{formatMiles(route.max_gap_miles)}</span>
              </div>
            )}
          </div>
        )}

        {route && route.points.length >= 2 && (
          <NavigateSection
            route={route}
            routeStations={routeStations}
            mustStopStationIds={mustStopStationIds}
            visibleTruckStops={visibleTruckStops}
            onPrintSummary={handlePrintSummary}
          />
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

        {route && typeof truckStopTotalCount === 'number' && (
          <div className="text-xs text-slate-200 bg-slate-800/40 border border-slate-700 rounded-md px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-slate-100">Truck stops</div>
              <div className="text-[11px] text-slate-400">
                {typeof truckStopVisibleCount === 'number' ? `${truckStopVisibleCount}/` : ''}
                {truckStopTotalCount}
              </div>
            </div>

            {truckStopTotalCount === 0 ? (
              <div className="mt-1 text-[11px] text-slate-400">
                None found within {route.corridor_miles ?? 15} miles of this route.
              </div>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={onSetAllTruckStopBrands ? () => onSetAllTruckStopBrands(true) : undefined}
                    disabled={!onSetAllTruckStopBrands}
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={onSetAllTruckStopBrands ? () => onSetAllTruckStopBrands(false) : undefined}
                    disabled={!onSetAllTruckStopBrands}
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    None
                  </button>
                  <div className="ml-auto text-slate-400">
                    {selectedTruckStopBrands ? `${selectedTruckStopBrands.size} brands` : ''}
                  </div>
                </div>

                {(truckStopBrandCounts?.length ?? 0) > 0 && selectedTruckStopBrands && onToggleTruckStopBrand && (
                  <div className="mt-2 max-h-28 overflow-auto space-y-1 pr-1">
                    {truckStopBrandCounts!.map(({ brand, count }) => (
                      <label key={brand} className="flex items-center gap-2 text-[11px] text-slate-200">
                        <input
                          type="checkbox"
                          checked={selectedTruckStopBrands.has(brand)}
                          onChange={() => onToggleTruckStopBrand(brand)}
                          className="h-3.5 w-3.5 accent-orange-500"
                        />
                        <span className="min-w-0 flex-1 truncate">{brand}</span>
                        <span className="shrink-0 tabular-nums text-slate-400">{count}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {route && typeof rechargePOITotalCount === 'number' && (
          <div className="text-xs text-slate-200 bg-slate-800/40 border border-slate-700 rounded-md px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-slate-100">Recharge and Work POIs</div>
              <div className="text-[11px] text-slate-400">
                {typeof rechargePOIVisibleCount === 'number' ? `${rechargePOIVisibleCount}/` : ''}
                {rechargePOITotalCount}
              </div>
            </div>

            {rechargePOITotalCount === 0 ? (
              <div className="mt-1 text-[11px] text-slate-400">
                No McDonald's or Starbucks data available. Add CSV files to poi_data/.
              </div>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={onSetAllRechargePOICategories ? () => onSetAllRechargePOICategories(true) : undefined}
                    disabled={!onSetAllRechargePOICategories}
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={onSetAllRechargePOICategories ? () => onSetAllRechargePOICategories(false) : undefined}
                    disabled={!onSetAllRechargePOICategories}
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    None
                  </button>
                </div>

                {(rechargePOICategoryCounts?.length ?? 0) > 0 && selectedRechargePOICategories && onToggleRechargePOICategory && (
                  <div className="mt-2 space-y-1">
                    {rechargePOICategoryCounts!.map(({ category, count }) => (
                      <label key={category} className="flex items-center gap-2 text-[11px] text-slate-200">
                        <input
                          type="checkbox"
                          checked={selectedRechargePOICategories.has(category)}
                          onChange={() => onToggleRechargePOICategory(category)}
                          className={`h-3.5 w-3.5 ${category === 'mcdonalds' ? 'accent-yellow-500' : 'accent-emerald-500'}`}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {category === 'mcdonalds' ? "McDonald's" : 'Starbucks'}
                          <span className="text-slate-500 ml-1">
                            ({category === 'mcdonalds' ? '≤2 mi' : '≤5 mi'} off-route)
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-400">{count}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {route && (
          <div className="text-xs text-slate-200 bg-slate-800/40 border border-slate-700 rounded-md">
            <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-3 py-2">
              <div className="text-slate-300">
                Stations
              </div>
              {mustStopStationIds && onSetShowMustStopsOnly && (
                <label className="flex items-center gap-2 text-[11px] text-slate-200">
                  <input
                    type="checkbox"
                    checked={Boolean(showMustStopsOnly)}
                    onChange={(e) => onSetShowMustStopsOnly(e.target.checked)}
                    disabled={mustStopCount === 0}
                    className="h-3.5 w-3.5 accent-amber-400 disabled:opacity-50"
                  />
                  <span className={mustStopCount === 0 ? 'text-slate-500' : undefined}>
                    Must stops only (map)
                  </span>
                  <span className="tabular-nums text-slate-400">
                    {mustStopCount}
                  </span>
                </label>
              )}
            </div>
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
                      <div className="font-medium text-slate-100 truncate flex items-center gap-1.5">
                        <span
                          className={[
                            'inline-block w-2 h-2 rounded-full shrink-0',
                            station.status_code === 'E' ? 'bg-emerald-500' : 'bg-red-500',
                          ].join(' ')}
                          title={station.status_code === 'E' ? 'Operational' : 'Temporarily unavailable'}
                        />
                        {idx + 1}. {station.station_name}
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {station.status_code !== 'E' && (
                          <span className="inline-flex items-center rounded-full border border-red-700 bg-red-900/40 px-2 py-0.5 text-[10px] font-semibold text-red-100">
                            OFFLINE
                          </span>
                        )}
                        {mustStopStationIds?.has(station.id) && (
                          <span className="inline-flex items-center rounded-full border border-amber-700 bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                            MUST STOP
                          </span>
                        )}
                        {station.rank_tier && typeof station.rank === 'number' && (
                          <span
                            className={[
                              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                              rankBadgeClasses(station.rank_tier),
                            ].join(' ')}
                            title={typeof station.rank_score === 'number' ? `Score ${station.rank_score}/100` : undefined}
                          >
                            {station.rank_tier} #{station.rank}
                          </span>
                        )}
                        <span className="text-slate-200">
                          +{formatMiles(station.distance_from_prev_miles)}
                          {typeof station.elevation_from_prev_ft === 'number' && Number.isFinite(station.elevation_from_prev_ft)
                            ? ` • ${formatElevationFeet(station.elevation_from_prev_ft)}`
                            : ''}
                        </span>
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
