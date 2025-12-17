import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { verifyDbConnection } from './db.js';
import { runMigrations } from './migrations.js';
import stationsRouter from './routes/stations.js';
import routeRouter from './routes/route.js';
import savedRoutesRouter from './routes/savedRoutes.js';
import authRouter from './routes/auth.js';
import { attachAuth } from './middleware/auth.js';

const app = express();
const PORT = config.port;

// Middleware
app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
}));
app.use(express.json());
app.use(attachAuth);

// Routes
app.use('/api/stations', stationsRouter);
app.use('/api/route', routeRouter);
app.use('/api/saved-routes', savedRoutesRouter);
app.use('/api/auth', authRouter);

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
