import { config, EA_NETWORK_NAME } from './config';
import type { Station } from '../types';

interface NRELStationResponse {
  fuel_stations: NRELStation[];
  total_results: number;
}

interface NRELStation {
  id: number;
  station_name: string;
  street_address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  ev_dc_fast_num: number | null;
  ev_connector_types: string[] | null;
  facility_type: string | null;
  status_code: string;
  ev_pricing: string | null;
  access_days_time: string | null;
}

/**
 * Fetch all Electrify America DC fast charging stations from NREL AFDC API
 */
export async function fetchEAStations(): Promise<Station[]> {
  const params = new URLSearchParams({
    api_key: config.nrel.apiKey,
    fuel_type: 'ELEC',
    ev_network: EA_NETWORK_NAME,
    ev_charging_level: 'dc_fast',
    status: 'E',
    access: 'public',
    country: 'US',
  });

  const response = await fetch(
    `${config.nrel.baseUrl}.json?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(`NREL API error: ${response.status} ${response.statusText}`);
  }

  const data: NRELStationResponse = await response.json();

  return data.fuel_stations.map(mapNRELStation);
}

/**
 * Map NREL station response to our Station type
 */
function mapNRELStation(nrel: NRELStation): Station {
  return {
    id: nrel.id,
    station_name: nrel.station_name,
    street_address: nrel.street_address,
    city: nrel.city,
    state: nrel.state,
    zip: nrel.zip,
    latitude: nrel.latitude,
    longitude: nrel.longitude,
    ev_dc_fast_num: nrel.ev_dc_fast_num ?? 0,
    ev_connector_types: nrel.ev_connector_types ?? [],
    facility_type: normalizeFacilityType(nrel.facility_type),
    status_code: nrel.status_code as 'E' | 'P' | 'T',
    ev_pricing: nrel.ev_pricing,
    access_days_time: nrel.access_days_time,
  };
}

/**
 * Normalize facility type strings from NREL to our FacilityType enum
 */
function normalizeFacilityType(facilityType: string | null): string {
  if (!facilityType) return 'OTHER';

  const normalized = facilityType.toUpperCase().replace(/[^A-Z]/g, '_');

  // Map common variations
  const mappings: Record<string, string> = {
    CONVENIENCE_STORE: 'CONVENIENCE_STORE',
    CONV_STORE: 'CONVENIENCE_STORE',
    GROCERY_STORE: 'GROCERY',
    GROCERY: 'GROCERY',
    HOTEL: 'HOTEL',
    CAR_DEALER: 'CAR_DEALER',
    AUTO_DEALER: 'CAR_DEALER',
    SHOPPING_CTR: 'SHOPPING_CENTER',
    SHOPPING_CENTER: 'SHOPPING_CENTER',
    TRAVEL_CENTER: 'TRAVEL_CENTER',
    TRUCK_STOP: 'TRUCK_STOP',
    REST_AREA: 'REST_AREA',
    GAS_STATION: 'GAS_STATION',
    FUEL_RESELLER: 'GAS_STATION',
  };

  // Check for specific store names
  if (normalized.includes('WALMART')) return 'WALMART';
  if (normalized.includes('TARGET')) return 'TARGET';
  if (normalized.includes('COSTCO')) return 'COSTCO';
  if (normalized.includes('MALL')) return 'MALL';

  return mappings[normalized] || 'OTHER';
}
