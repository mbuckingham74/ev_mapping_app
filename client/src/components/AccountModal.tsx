import { useEffect, useState } from 'react';
import type { User, UserPreferences } from '../types/user';

type Props = {
  open: boolean;
  user: User;
  preferences: UserPreferences | null;
  onClose: () => void;
  onLogout: () => Promise<void>;
  onSavePreferences: (patch: {
    vehicleName?: string | null;
    rangeMiles?: number;
    efficiencyMiPerKwh?: number | null;
    batteryKwh?: number | null;
    minArrivalPercent?: number;
    defaultCorridorMiles?: number;
    defaultPreference?: 'fastest' | 'charger_optimized';
    maxDetourFactor?: number;
  }) => Promise<void>;
};

export default function AccountModal({ open, user, preferences, onClose, onLogout, onSavePreferences }: Props) {
  const [vehicleName, setVehicleName] = useState('');
  const [rangeMiles, setRangeMiles] = useState<number>(210);
  const [efficiencyMiPerKwh, setEfficiencyMiPerKwh] = useState<string>('');
  const [batteryKwh, setBatteryKwh] = useState<string>('');
  const [minArrivalPercent, setMinArrivalPercent] = useState<number>(10);
  const [defaultCorridorMiles, setDefaultCorridorMiles] = useState<number>(30);
  const [defaultPreference, setDefaultPreference] = useState<'fastest' | 'charger_optimized'>('charger_optimized');
  const [maxDetourFactor, setMaxDetourFactor] = useState<number>(1.25);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccess(false);
    setSaving(false);
    setLoggingOut(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!preferences) return;
    setVehicleName(preferences.vehicle_name ?? '');
    setRangeMiles(preferences.range_miles ?? 210);
    setEfficiencyMiPerKwh(preferences.efficiency_mi_per_kwh === null ? '' : String(preferences.efficiency_mi_per_kwh));
    setBatteryKwh(preferences.battery_kwh === null ? '' : String(preferences.battery_kwh));
    setMinArrivalPercent(preferences.min_arrival_percent ?? 10);
    setDefaultCorridorMiles(preferences.default_corridor_miles ?? 30);
    setDefaultPreference(preferences.default_preference ?? 'charger_optimized');
    setMaxDetourFactor(preferences.max_detour_factor ?? 1.25);
  }, [open, preferences]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const patch: Parameters<Props['onSavePreferences']>[0] = {
        vehicleName: vehicleName.trim() ? vehicleName.trim() : null,
        rangeMiles,
        minArrivalPercent,
        defaultCorridorMiles,
        defaultPreference,
        maxDetourFactor,
      };

      const efficiency = efficiencyMiPerKwh.trim() ? Number.parseFloat(efficiencyMiPerKwh.trim()) : null;
      patch.efficiencyMiPerKwh = Number.isFinite(efficiency ?? NaN) ? efficiency : null;

      const battery = batteryKwh.trim() ? Number.parseFloat(batteryKwh.trim()) : null;
      patch.batteryKwh = Number.isFinite(battery ?? NaN) ? battery : null;

      await onSavePreferences(patch);
      setSuccess(true);
      window.setTimeout(() => setSuccess(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setError(null);
    try {
      await onLogout();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign out');
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl">
        {success && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border border-emerald-800 bg-emerald-900/80 px-3 py-1 text-xs font-semibold text-emerald-50 shadow">
            Preferences saved
          </div>
        )}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-100">Account</div>
            <div className="mt-0.5 text-xs text-slate-400">{user.email}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700 disabled:opacity-60"
            >
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <div className="text-[11px] text-slate-300">Vehicle name (optional)</div>
            <input
              value={vehicleName}
              onChange={(e) => setVehicleName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="e.g. Kia EV6"
              autoComplete="off"
            />
          </label>

          <label className="block">
            <div className="text-[11px] text-slate-300">Range (miles)</div>
            <input
              type="number"
              value={rangeMiles}
              onChange={(e) => setRangeMiles(Number.parseInt(e.target.value || '0', 10))}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
              min={0}
              max={2000}
            />
          </label>

          <label className="block">
            <div className="text-[11px] text-slate-300">Min arrival (%)</div>
            <input
              type="number"
              value={minArrivalPercent}
              onChange={(e) => setMinArrivalPercent(Number.parseInt(e.target.value || '0', 10))}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
              min={0}
              max={100}
            />
          </label>

          <label className="block">
            <div className="text-[11px] text-slate-300">Efficiency (mi/kWh)</div>
            <input
              value={efficiencyMiPerKwh}
              onChange={(e) => setEfficiencyMiPerKwh(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="optional"
              inputMode="decimal"
            />
          </label>

          <label className="block">
            <div className="text-[11px] text-slate-300">Battery (kWh)</div>
            <input
              value={batteryKwh}
              onChange={(e) => setBatteryKwh(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="optional"
              inputMode="decimal"
            />
          </label>

          <label className="block">
            <div className="text-[11px] text-slate-300">Default corridor (miles)</div>
            <input
              type="number"
              value={defaultCorridorMiles}
              onChange={(e) => setDefaultCorridorMiles(Number.parseInt(e.target.value || '0', 10))}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
              min={0}
              max={200}
            />
          </label>

          <label className="block">
            <div className="text-[11px] text-slate-300">Default route type</div>
            <select
              value={defaultPreference}
              onChange={(e) => setDefaultPreference(e.target.value === 'fastest' ? 'fastest' : 'charger_optimized')}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="charger_optimized">DC optimized</option>
              <option value="fastest">Fastest</option>
            </select>
          </label>

          <label className="block sm:col-span-2">
            <div className="text-[11px] text-slate-300">Max detour factor</div>
            <input
              type="number"
              value={maxDetourFactor}
              onChange={(e) => setMaxDetourFactor(Number.parseFloat(e.target.value || '1'))}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
              min={1}
              max={5}
              step={0.05}
            />
            <div className="mt-1 text-[11px] text-slate-500">
              Higher values allow longer routes to include more charging options.
            </div>
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-800 bg-red-900/40 px-3 py-2 text-xs text-red-100">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-400" />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-300"
          >
            {saving ? 'Saving…' : success ? 'Saved' : 'Save preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}
