import type { Station } from '../types/station';

const API_BASE = '/api';

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
