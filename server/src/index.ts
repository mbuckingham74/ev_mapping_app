import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { verifyDbConnection } from './db.js';
import { runMigrations } from './migrations.js';
import stationsRouter from './routes/stations.js';
import routeRouter from './routes/route.js';
import savedRoutesRouter from './routes/savedRoutes.js';
import authRouter from './routes/auth.js';
import { attachAuth } from './middleware/auth.js';
import { logger } from './logger.js';

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

// Request logging
app.use(pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url?.startsWith('/api/health') ?? false,
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
  },
  // Redact sensitive headers while preserving request correlation
  serializers: {
    res: (res) => ({
      statusCode: res.statusCode,
    }),
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
  },
}));

// CORS
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
  logger.error({ err }, 'Unhandled error');
  return res.status(status).json({ error: message });
});

// Initialize database schema and start server
async function start() {
  try {
    await verifyDbConnection();
    logger.info('Database connected');
    await runMigrations();

    app.listen(PORT, () => {
      logger.info({ port: PORT }, `Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
