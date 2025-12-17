import { config, EA_OPERATOR_ID } from './config';

interface OCMConnection {
  PowerKW: number | null;
  ConnectionTypeID: number;
  Quantity: number | null;
}

interface OCMAddressInfo {
  Latitude: number;
  Longitude: number;
}

interface OCMStation {
  ID: number;
  AddressInfo: OCMAddressInfo;
  Connections: OCMConnection[];
}

export interface ChargerPowerData {
  latitude: number;
  longitude: number;
  maxPowerKW: number;
}

/**
 * Fetch charger power data from OpenChargeMap for Electrify America stations
 * Returns data that can be matched to NREL stations by coordinates
 */
export async function fetchChargerPowerData(): Promise<ChargerPowerData[]> {
  const params = new URLSearchParams({
    key: config.openChargeMap.apiKey,
    operatorid: EA_OPERATOR_ID.toString(),
    countrycode: 'US',
    maxresults: '5000',
    compact: 'true',
    verbose: 'false',
  });

  const response = await fetch(
    `${config.openChargeMap.baseUrl}/poi?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(
      `OpenChargeMap API error: ${response.status} ${response.statusText}`
    );
  }

  const data: OCMStation[] = await response.json();

  return data.map((station) => ({
    latitude: station.AddressInfo.Latitude,
    longitude: station.AddressInfo.Longitude,
    maxPowerKW: getMaxPowerKW(station.Connections),
  }));
}

/**
 * Get maximum power output from connections
 */
function getMaxPowerKW(connections: OCMConnection[]): number {
  if (!connections || connections.length === 0) {
    return 150; // Default conservative estimate
  }

  const powers = connections
    .filter((c) => c.PowerKW !== null)
    .map((c) => c.PowerKW as number);

  return powers.length > 0 ? Math.max(...powers) : 150;
}

/**
 * Match OpenChargeMap power data to NREL stations by proximity
 * @param nrelLat NREL station latitude
 * @param nrelLng NREL station longitude
 * @param powerData Array of ChargerPowerData from OpenChargeMap
 * @param toleranceKm Distance tolerance in kilometers (default 0.5km)
 */
export function matchPowerData(
  nrelLat: number,
  nrelLng: number,
  powerData: ChargerPowerData[],
  toleranceKm: number = 0.5
): number | undefined {
  const match = powerData.find((pd) => {
    const distance = haversineDistance(nrelLat, nrelLng, pd.latitude, pd.longitude);
    return distance <= toleranceKm;
  });

  return match?.maxPowerKW;
}

/**
 * Calculate distance between two points using Haversine formula
 * @returns Distance in kilometers
 */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
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
