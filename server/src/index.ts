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
// JSON-only API; explicit limit (matches Express default, here for visibility)
app.use(express.json({ limit: '100kb' }));
app.use(attachAuth);

// Routes
app.use('/api/stations', stationsRouter);
app.use('/api/route', routeRouter);
app.use('/api/saved-routes', savedRoutesRouter);
app.use('/api/auth', authRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler (returns JSON instead of HTML for all errors)
app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Avoid double-write if headers already sent
  if (res.headersSent) {
    return next(err);
  }

  // Body-parser specific errors
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Generic error fallback (avoids Express HTML error page)
  const status = err.status ?? 500;
  const message = status === 500 ? 'Internal server error' : err.message;
  console.error('Unhandled error:', err);
  return res.status(status).json({ error: message });
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
