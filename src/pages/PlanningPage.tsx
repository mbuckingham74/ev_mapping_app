import { useEffect } from 'react';
import { Map } from '../components';
import { useAppStore } from '../store';
import { fetchEAStations } from '../services';

export function PlanningPage() {
  const stations = useAppStore((state) => state.stations);
  const stationsLoading = useAppStore((state) => state.stationsLoading);
  const stationsError = useAppStore((state) => state.stationsError);
  const setStations = useAppStore((state) => state.setStations);
  const setStationsLoading = useAppStore((state) => state.setStationsLoading);
  const setStationsError = useAppStore((state) => state.setStationsError);
  const setSelectedStation = useAppStore((state) => state.setSelectedStation);

  useEffect(() => {
    if (stations.length === 0 && !stationsLoading) {
      loadStations();
    }
  }, []);

  async function loadStations() {
    setStationsLoading(true);
    setStationsError(null);

    try {
      const data = await fetchEAStations();
      setStations(data);
    } catch (error) {
      setStationsError(
        error instanceof Error ? error.message : 'Failed to load stations'
      );
    } finally {
      setStationsLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <h1 className="text-lg font-semibold text-white">
          EA Route Planner
        </h1>
        <p className="text-sm text-slate-400">
          Plan your Electrify America road trip
        </p>
      </header>

      {/* Main content */}
      <div className="flex-1 flex">
        {/* Map */}
        <div className="flex-1 relative">
          {stationsLoading && (
            <div className="absolute inset-0 bg-slate-900/50 flex items-center justify-center z-10">
              <div className="bg-slate-800 rounded-lg px-4 py-3 text-white">
                Loading stations...
              </div>
            </div>
          )}

          {stationsError && (
            <div className="absolute top-4 left-4 right-4 bg-red-900/90 text-red-100 rounded-lg px-4 py-3 z-10">
              <p className="font-medium">Error loading stations</p>
              <p className="text-sm">{stationsError}</p>
              <button
                onClick={loadStations}
                className="mt-2 text-sm underline hover:no-underline"
              >
                Try again
              </button>
            </div>
          )}

          <Map
            stations={stations}
            onStationClick={(station) => setSelectedStation(station)}
          />
        </div>

        {/* Sidebar */}
        <aside className="w-80 bg-slate-800 border-l border-slate-700 p-4 overflow-y-auto hidden lg:block">
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-2">
                Route Planning
              </h2>
              <p className="text-sm text-slate-400">
                Click on a station to see details. Route planning coming soon.
              </p>
            </div>

            <div className="pt-4 border-t border-slate-700">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-2">
                Stats
              </h2>
              <div className="text-sm text-slate-400">
                <p>{stations.length} EA stations loaded</p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
