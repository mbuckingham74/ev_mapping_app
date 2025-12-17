import type { Station } from '../types/station';
import type { RouteResponse } from '../types/route';
import type { SavedRoute } from '../types/savedRoute';

const API_BASE = '/api';

async function getApiErrorMessage(response: Response, fallback: string): Promise<string> {
  let message = fallback;
  try {
    const data = (await response.json()) as unknown;
    if (data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
      message = (data as { error: string }).error;
    } else if (typeof data === 'string') {
      message = data;
    } else {
      message = JSON.stringify(data);
    }
  } catch {
    try {
      const text = await response.text();
      if (text) message = text;
    } catch {
      // ignore
    }
  }
  return message;
}

export async function fetchRoute(
  start: string,
  end: string,
  waypoints: string[] = [],
  corridorMiles: number = 15,
  preference: 'fastest' | 'charger_optimized' = 'fastest'
): Promise<RouteResponse> {
  const response = await fetch(`${API_BASE}/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ start, end, waypoints, corridorMiles, includeStations: true, preference }),
  });

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, `Failed to plan route: ${response.statusText}`));
  }

  return response.json();
}

export async function fetchStations(state?: string): Promise<Station[]> {
  const url = state
    ? `${API_BASE}/stations?state=${encodeURIComponent(state)}`
    : `${API_BASE}/stations`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch stations: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchStation(id: number): Promise<Station> {
  const response = await fetch(`${API_BASE}/stations/${id}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch station: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchNearbyStations(
  lat: number,
  lng: number,
  radius: number = 100,
  limit: number = 20
): Promise<Station[]> {
  const response = await fetch(
    `${API_BASE}/stations/near/${lat}/${lng}?radius=${radius}&limit=${limit}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch nearby stations: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchStationCount(): Promise<{ total: number }> {
  const response = await fetch(`${API_BASE}/stations/stats/count`);

  if (!response.ok) {
    throw new Error(`Failed to fetch station count: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchSavedRoutes(): Promise<SavedRoute[]> {
  const response = await fetch(`${API_BASE}/saved-routes`);

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, `Failed to fetch saved routes: ${response.statusText}`));
  }

  return response.json();
}

export async function fetchSavedRoute(id: number): Promise<SavedRoute> {
  const response = await fetch(`${API_BASE}/saved-routes/${id}`);

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, `Failed to fetch saved route: ${response.statusText}`));
  }

  return response.json();
}

export async function createSavedRoute(params: {
  name?: string;
  start: string;
  end: string;
  waypoints: string[];
  corridorMiles: number;
  preference: 'fastest' | 'charger_optimized';
}): Promise<SavedRoute> {
  const response = await fetch(`${API_BASE}/saved-routes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: params.name,
      start: params.start,
      end: params.end,
      waypoints: params.waypoints,
      corridorMiles: params.corridorMiles,
      preference: params.preference,
    }),
  });

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, `Failed to save route: ${response.statusText}`));
  }

  return response.json();
}
