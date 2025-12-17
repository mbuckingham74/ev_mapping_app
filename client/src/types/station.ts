export interface Station {
  id: number;
  station_name: string;
  street_address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  ev_dc_fast_num: number;
  ev_connector_types: string[];
  facility_type: string;
  status_code: string;
  ev_pricing: string | null;
  access_days_time: string | null;
  max_power_kw: number | null;
  distance_miles?: number;
}
