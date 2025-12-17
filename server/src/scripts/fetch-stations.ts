/**
 * Fetch EA stations from OpenChargeMap and upsert into Postgres.
 *
 * Run with: npm run fetch:stations (from server directory or repo root)
 */

import { pool } from '../db.js';
import { runMigrations } from '../migrations.js';
import { config } from '../config.js';

const OPEN_CHARGE_MAP_BASE_URL = 'https://api.openchargemap.io/v3/poi';
const ELECTRIFY_AMERICA_OPERATOR_ID = '3318';

type OcmConnection = {
  ConnectionType?: { Title?: string | null } | null;
  Level?: { IsFastChargeCapable?: boolean | null } | null;
  PowerKW?: number | null;
  Quantity?: number | null;
};

type OcmPoi = {
  ID: number;
  AddressInfo?: {
    Title?: string | null;
    AddressLine1?: string | null;
    Town?: string | null;
    StateOrProvince?: string | null;
    Postcode?: string | null;
    Latitude?: number | null;
    Longitude?: number | null;
    AccessComments?: string | null;
  } | null;
  Connections?: OcmConnection[] | null;
  StatusType?: { IsOperational?: boolean | null } | null;
  UsageCost?: string | null;
};

type StationRow = {
  id: number;
  station_name: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number;
  longitude: number;
  ev_dc_fast_num: number;
  ev_connector_types: string[];
  facility_type: string;
  status_code: string;
  ev_pricing: string | null;
  access_days_time: string | null;
  max_power_kw: number | null;
};

function normalizeConnectorType(title: string | null | undefined): string | null {
  if (!title) return null;
  const upper = title.toUpperCase();
  if (upper.includes('CCS')) return 'CCS';
  if (upper.includes('CHADEMO')) return 'CHADEMO';
  if (upper.includes('NACS') || upper.includes('TESLA')) return 'NACS';
  if (upper.includes('J1772')) return 'J1772';
  return upper.trim().replace(/\s+/g, '_');
}

function inferFacilityType(stationName: string): string {
  const upper = stationName.toUpperCase();
  if (upper.includes('WALMART')) return 'WALMART';
  if (upper.includes('TARGET')) return 'TARGET';
  if (upper.includes('COSTCO')) return 'COSTCO';
  if (upper.includes('MALL')) return 'MALL';
  if (upper.includes("SAM'S CLUB") || upper.includes('SAMS CLUB')) return 'SAMS_CLUB';
  return 'OTHER';
}

function isDcFastConnection(conn: OcmConnection): boolean {
  if (conn.Level?.IsFastChargeCapable === true) return true;
  if (typeof conn.PowerKW === 'number' && conn.PowerKW >= 50) return true;
  return false;
}

function sumQuantities(connections: OcmConnection[]): number {
  return connections.reduce((sum, conn) => sum + (conn.Quantity && conn.Quantity > 0 ? conn.Quantity : 1), 0);
}

function maxPowerKw(connections: OcmConnection[]): number | null {
  const values = connections
    .map((conn) => conn.PowerKW)
    .filter((kw): kw is number => typeof kw === 'number' && Number.isFinite(kw));
  if (values.length === 0) return null;
  return Math.max(...values);
}

function asStationRow(poi: OcmPoi): StationRow | null {
  const address = poi.AddressInfo ?? null;
  const latitude = address?.Latitude;
  const longitude = address?.Longitude;

  if (typeof poi.ID !== 'number' || !Number.isFinite(poi.ID)) return null;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) return null;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) return null;

  const stationName = address?.Title?.trim() || `Station ${poi.ID}`;
  const connections = (poi.Connections ?? []).filter(Boolean);
  const dcConnections = connections.filter(isDcFastConnection);

  const connectorTypes = Array.from(new Set(
    dcConnections
      .map((conn) => normalizeConnectorType(conn.ConnectionType?.Title))
      .filter((t): t is string => Boolean(t))
  )).sort();

  return {
    id: poi.ID,
    station_name: stationName,
    street_address: address?.AddressLine1?.trim() || null,
    city: address?.Town?.trim() || null,
    state: address?.StateOrProvince?.trim() || null,
    zip: address?.Postcode?.trim() || null,
    latitude,
    longitude,
    ev_dc_fast_num: dcConnections.length === 0 ? 0 : sumQuantities(dcConnections),
    ev_connector_types: connectorTypes,
    facility_type: inferFacilityType(stationName),
    status_code: poi.StatusType?.IsOperational === false ? 'T' : 'E',
    ev_pricing: poi.UsageCost?.trim() || null,
    access_days_time: address?.AccessComments?.trim() || null,
    max_power_kw: maxPowerKw(dcConnections),
  };
}

async function fetchEAStationsFromOpenChargeMap(): Promise<OcmPoi[]> {
  const apiKey = config.apiKeys.openChargeMap;
  if (!apiKey) {
    throw new Error('OPENCHARMAP_API_KEY not set in environment');
  }

  const params = new URLSearchParams({
    key: apiKey,
    operatorid: ELECTRIFY_AMERICA_OPERATOR_ID,
    countrycode: 'US',
    maxresults: '5000',
  });

  const url = `${OPEN_CHARGE_MAP_BASE_URL}/?${params.toString()}`;
  console.log('Fetching EA stations from OpenChargeMap...');
  console.log('Request URL:', url.replace(apiKey, '[REDACTED]'));

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenChargeMap API error: ${response.status} ${response.statusText}\n${text}`);
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error('Unexpected OpenChargeMap response: expected an array');
  }

  return data as OcmPoi[];
}

async function upsertStations(stations: StationRow[]): Promise<void> {
  console.log(`Upserting ${stations.length} stations into database...`);

  const client = await pool.connect();
  const batchSize = 200;
  let processed = 0;

  try {
    for (let i = 0; i < stations.length; i += batchSize) {
      const batch = stations.slice(i, i + batchSize);

      const values: unknown[] = [];
      const placeholders: string[] = [];

      batch.forEach((station, idx) => {
        const offset = idx * 15;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15})`
        );

        values.push(
          station.id,
          station.station_name,
          station.street_address,
          station.city,
          station.state,
          station.zip,
          station.latitude,
          station.longitude,
          station.ev_dc_fast_num,
          station.ev_connector_types,
          station.facility_type,
          station.status_code,
          station.ev_pricing,
          station.access_days_time,
          station.max_power_kw
        );
      });

      const query = `
        INSERT INTO stations (
          id,
          station_name,
          street_address,
          city,
          state,
          zip,
          latitude,
          longitude,
          ev_dc_fast_num,
          ev_connector_types,
          facility_type,
          status_code,
          ev_pricing,
          access_days_time,
          max_power_kw
        )
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (id) DO UPDATE SET
          station_name = EXCLUDED.station_name,
          street_address = EXCLUDED.street_address,
          city = EXCLUDED.city,
          state = EXCLUDED.state,
          zip = EXCLUDED.zip,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          ev_dc_fast_num = EXCLUDED.ev_dc_fast_num,
          ev_connector_types = EXCLUDED.ev_connector_types,
          facility_type = EXCLUDED.facility_type,
          status_code = EXCLUDED.status_code,
          ev_pricing = EXCLUDED.ev_pricing,
          access_days_time = EXCLUDED.access_days_time,
          max_power_kw = EXCLUDED.max_power_kw,
          updated_at = CURRENT_TIMESTAMP
      `;

      await client.query(query, values);
      processed += batch.length;
      console.log(`Upserted ${processed}/${stations.length}`);
    }
  } finally {
    client.release();
  }
}

async function pruneMissingStations(keepIds: number[]): Promise<void> {
  console.log('Pruning stations not returned by OpenChargeMap...');
  await pool.query('DELETE FROM stations WHERE NOT (id = ANY($1::int[]))', [keepIds]);
}

async function main() {
  await runMigrations();

  const pois = await fetchEAStationsFromOpenChargeMap();
  const stations = pois
    .map(asStationRow)
    .filter((row): row is StationRow => row !== null)
    .filter((row) => row.state !== null && row.state.length > 0);

  await upsertStations(stations);
  await pruneMissingStations(stations.map((s) => s.id));

  const totalResult = await pool.query<{ total: string }>('SELECT COUNT(*) as total FROM stations');
  console.log(`\nTotal stations in database: ${totalResult.rows[0]?.total ?? '0'}`);
}

main()
  .catch((error) => {
    console.error('Error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
