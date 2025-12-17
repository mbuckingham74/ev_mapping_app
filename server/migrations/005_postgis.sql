CREATE EXTENSION IF NOT EXISTS postgis;

-- Accelerate “stations near polyline” queries (used by /api/route).
CREATE INDEX IF NOT EXISTS stations_location_geog_gist_idx
  ON stations
  USING GIST ((ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography));

