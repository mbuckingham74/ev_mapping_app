import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

// Build SSL config based on DB_SSL and DB_SSL_MODE
function buildSslConfig(): false | pg.PoolConfig['ssl'] {
  if (!config.db.ssl) return false;

  // 'verify' = require valid cert chain (production default)
  // 'no-verify' = allow self-signed/private CA (for internal/dev environments)
  return {
    rejectUnauthorized: config.db.sslMode !== 'no-verify',
  };
}

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: buildSslConfig(),
  // Connection pool settings (configurable via env)
  connectionTimeoutMillis: config.db.poolConnectionTimeoutMs,
  idleTimeoutMillis: config.db.poolIdleTimeoutMs,
  max: config.db.poolMax,
});

// Handle unexpected errors on idle clients to prevent process crash
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err);
  // Don't crash - the pool will remove the bad client
});

export async function verifyDbConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
