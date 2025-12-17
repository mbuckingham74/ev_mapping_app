export type SavedRoute = {
  id: number;
  name: string | null;
  start_query: string;
  end_query: string;
  waypoints: string[];
  corridor_miles: number;
  preference: 'fastest' | 'charger_optimized';
  created_at: string;
};

