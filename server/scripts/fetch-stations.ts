/**
 * One-time fetch script to populate Postgres with EA station data
 *
 * Run with: npm run fetch:stations (from server directory)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../..', '.env') });

import { pool, initSchema } from '../src/db.js';

const NREL_API_KEY = process.env.NREL_API_KEY;
const NREL_BASE_URL = 'https://api.nrel.gov/alt-fuel-stations/v1';

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

async function fetchEAStations(): Promise<NRELStation[]> {
  if (!NREL_API_KEY) {
    throw new Error('NREL_API_KEY not set in environment');
  }

  console.log('Fetching EA stations from NREL API...');

  const params = new URLSearchParams({
    api_key: NREL_API_KEY,
    fuel_type: 'ELEC',
    ev_network: 'Electrify America',
    ev_charging_level: 'dc_fast',
    status: 'E',
    access: 'public',
    country: 'US',
  });

  const url = `${NREL_BASE_URL}.json?${params.toString()}`;
  console.log('Request URL:', url.replace(NREL_API_KEY, '[REDACTED]'));

  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`NREL API error: ${response.status} ${response.statusText}\n${text}`);
  }

  const data = await response.json();
  console.log(`Received ${data.total_results} stations from NREL`);

  return data.fuel_stations;
}

function normalizeFacilityType(facilityType: string | null): string {
  if (!facilityType) return 'OTHER';

  const normalized = facilityType.toUpperCase().replace(/[^A-Z]/g, '_');

  if (normalized.includes('WALMART')) return 'WALMART';
  if (normalized.includes('TARGET')) return 'TARGET';
  if (normalized.includes('COSTCO')) return 'COSTCO';
  if (normalized.includes('MALL')) return 'MALL';

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

  return mappings[normalized] || 'OTHER';
}

async function insertStations(stations: NRELStation[]) {
  console.log(`Inserting ${stations.length} stations into database...`);

  // Clear existing data
  await pool.query('DELETE FROM stations');

  // Insert in batches
  const batchSize = 100;
  let inserted = 0;

  for (let i = 0; i < stations.length; i += batchSize) {
    const batch = stations.slice(i, i + batchSize);

    const values: unknown[] = [];
    const placeholders: string[] = [];

    batch.forEach((station, idx) => {
      const offset = idx * 14;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14})`);

      values.push(
        station.id,
        station.station_name,
        station.street_address,
        station.city,
        station.state,
        station.zip,
        station.latitude,
        station.longitude,
        station.ev_dc_fast_num ?? 0,
        station.ev_connector_types ?? [],
        normalizeFacilityType(station.facility_type),
        station.status_code,
        station.ev_pricing,
        station.access_days_time
      );
    });

    const query = `
      INSERT INTO stations (id, station_name, street_address, city, state, zip, latitude, longitude, ev_dc_fast_num, ev_connector_types, facility_type, status_code, ev_pricing, access_days_time)
      VALUES ${placeholders.join(', ')}
    `;

    await pool.query(query, values);
    inserted += batch.length;
    console.log(`Inserted ${inserted}/${stations.length} stations`);
  }

  console.log('Done inserting stations');
}

async function main() {
  try {
    // Initialize schema first
    await initSchema();

    // Fetch from NREL API
    const stations = await fetchEAStations();

    // Insert into database
    await insertStations(stations);

    // Print stats
    const result = await pool.query(`
      SELECT state, COUNT(*) as count
      FROM stations
      GROUP BY state
      ORDER BY count DESC
      LIMIT 10
    `);

    console.log('\nTop 10 states by station count:');
    result.rows.forEach((row) => {
      console.log(`  ${row.state}: ${row.count}`);
    });

    const totalResult = await pool.query('SELECT COUNT(*) as total FROM stations');
    console.log(`\nTotal stations in database: ${totalResult.rows[0].total}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
