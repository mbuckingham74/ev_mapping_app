import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../..', '.env') });

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Test connection on startup
pool.query('SELECT NOW()')
  .then(() => console.log('Database connected'))
  .catch((err) => console.error('Database connection error:', err.message));

export async function initSchema() {
  const createTableSQL = `
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
  `;

  await pool.query(createTableSQL);
  console.log('Database schema initialized');
}
