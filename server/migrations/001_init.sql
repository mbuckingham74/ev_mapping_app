CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY,
  station_name TEXT NOT NULL,
  street_address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  ev_dc_fast_num INTEGER DEFAULT 0,
  ev_connector_types TEXT[],
  facility_type TEXT,
  status_code TEXT,
  ev_pricing TEXT,
  access_days_time TEXT,
  max_power_kw INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stations_state ON stations(state);
CREATE INDEX IF NOT EXISTS idx_stations_coords ON stations(latitude, longitude);

