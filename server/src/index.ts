import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { verifyDbConnection } from './db.js';
import { runMigrations } from './migrations.js';
import stationsRouter from './routes/stations.js';
import routeRouter from './routes/route.js';

const app = express();
const PORT = config.port;

// Middleware
app.use(cors({
  origin: config.corsOrigin,
}));
app.use(express.json());

// Routes
app.use('/api/stations', stationsRouter);
app.use('/api/route', routeRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database schema and start server
async function start() {
  try {
    await verifyDbConnection();
    console.log('Database connected');
    await runMigrations();

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
