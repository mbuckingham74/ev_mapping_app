// API configuration
export const config = {
  nrel: {
    baseUrl: 'https://api.nrel.gov/alt-fuel-stations/v1',
    apiKey: import.meta.env.VITE_NREL_API_KEY || '',
  },
  openChargeMap: {
    baseUrl: 'https://api.openchargemap.io/v3',
    apiKey: import.meta.env.VITE_OPENCHARMAP_API_KEY || '',
  },
  openRouteService: {
    baseUrl: 'https://api.openrouteservice.org/v2',
    apiKey: import.meta.env.VITE_OPENROUTESERVICE_API_KEY || '',
  },
} as const;

// Electrify America network ID for filtering
export const EA_NETWORK_NAME = 'Electrify America';

// OpenChargeMap operator ID for Electrify America
export const EA_OPERATOR_ID = 3534;
