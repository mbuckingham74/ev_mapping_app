import { pool } from '../db.js';
import { runMigrations } from '../migrations.js';

async function main() {
  await runMigrations();
}

main()
  .then(() => {
    console.log('Migration run finished');
  })
  .catch((error) => {
    console.error('Migration run failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

