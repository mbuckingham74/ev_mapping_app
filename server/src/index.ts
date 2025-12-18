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

// Remove Express version disclosure
app.disable('x-powered-by');

// Trust proxy for correct client IP behind reverse proxy (Nginx Proxy Manager)
// Required for rate limiting to work correctly
app.set('trust proxy', 1);

// Security headers (API-relevant only; CSP/COOP/COEP omitted as they apply to HTML documents)
app.use((_req, res, next) => {
  // Prevent MIME-sniffing (relevant for any response)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent this API from being embedded in frames
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// CORS
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
