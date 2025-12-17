import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Station, Location, PlannedRoute } from '../types';

interface UserPreferences {
  vehicleRange: number; // miles
  efficiency: number; // mi/kWh
  minArrivalBattery: number; // percentage (0-100)
  excludedFacilityTypes: string[];
}

interface AppState {
  // Station data
  stations: Station[];
  stationsLoading: boolean;
  stationsError: string | null;

  // Route planning
  origin: Location | null;
  destination: Location | null;
  plannedRoute: PlannedRoute | null;

  // On-road mode
  currentLocation: Location | null;
  currentBatteryPercent: number;

  // User preferences
  preferences: UserPreferences;

  // UI state
  activeMode: 'planning' | 'onroad';
  selectedStation: Station | null;

  // Actions
  setStations: (stations: Station[]) => void;
  setStationsLoading: (loading: boolean) => void;
  setStationsError: (error: string | null) => void;

  setOrigin: (origin: Location | null) => void;
  setDestination: (destination: Location | null) => void;
  setPlannedRoute: (route: PlannedRoute | null) => void;

  setCurrentLocation: (location: Location | null) => void;
  setCurrentBatteryPercent: (percent: number) => void;

  setPreferences: (prefs: Partial<UserPreferences>) => void;

  setActiveMode: (mode: 'planning' | 'onroad') => void;
  setSelectedStation: (station: Station | null) => void;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  vehicleRange: 215, // Kia EV6 example from planning doc
  efficiency: 3.5, // mi/kWh
  minArrivalBattery: 15, // 15% buffer
  excludedFacilityTypes: [],
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Initial state
      stations: [],
      stationsLoading: false,
      stationsError: null,

      origin: null,
      destination: null,
      plannedRoute: null,

      currentLocation: null,
      currentBatteryPercent: 80,

      preferences: DEFAULT_PREFERENCES,

      activeMode: 'planning',
      selectedStation: null,

      // Actions
      setStations: (stations) => set({ stations }),
      setStationsLoading: (stationsLoading) => set({ stationsLoading }),
      setStationsError: (stationsError) => set({ stationsError }),

      setOrigin: (origin) => set({ origin }),
      setDestination: (destination) => set({ destination }),
      setPlannedRoute: (plannedRoute) => set({ plannedRoute }),

      setCurrentLocation: (currentLocation) => set({ currentLocation }),
      setCurrentBatteryPercent: (currentBatteryPercent) =>
        set({ currentBatteryPercent }),

      setPreferences: (prefs) =>
        set((state) => ({
          preferences: { ...state.preferences, ...prefs },
        })),

      setActiveMode: (activeMode) => set({ activeMode }),
      setSelectedStation: (selectedStation) => set({ selectedStation }),
    }),
    {
      name: 'ea-route-planner-storage',
      partialize: (state) => ({
        preferences: state.preferences,
        currentBatteryPercent: state.currentBatteryPercent,
      }),
    }
  )
);
