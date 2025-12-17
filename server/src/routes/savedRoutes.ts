import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function ensureString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function ensureNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type SavedRouteRow = {
  id: number;
  user_id: number | null;
  name: string | null;
  start_query: string;
  end_query: string;
  waypoints: string[];
  corridor_miles: number;
  preference: 'fastest' | 'charger_optimized';
  created_at: string;
};

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query<SavedRouteRow>(
      `
        SELECT *
        FROM saved_routes
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `,
      [req.user!.id]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Error listing saved routes:', error);
    return res.status(500).json({ error: 'Failed to list saved routes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const rawId = req.params.id;
    const id = Number.parseInt(rawId, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid route id' });
    }

    const result = await pool.query<SavedRouteRow>('SELECT * FROM saved_routes WHERE id = $1', [id]);
    const route = result.rows[0];
    if (!route) {
      return res.status(404).json({ error: 'Saved route not found' });
    }

    if (route.user_id === null) {
      return res.json(route);
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Sign in to access this saved route' });
    }

    if (route.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.json(route);
  } catch (error) {
    console.error('Error fetching saved route:', error);
    return res.status(500).json({ error: 'Failed to fetch saved route' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const start = ensureString((req.body as { start?: unknown; start_query?: unknown } | undefined)?.start)
      ?? ensureString((req.body as { start_query?: unknown } | undefined)?.start_query);
    const end = ensureString((req.body as { end?: unknown; end_query?: unknown } | undefined)?.end)
      ?? ensureString((req.body as { end_query?: unknown } | undefined)?.end_query);
    const name = ensureString((req.body as { name?: unknown } | undefined)?.name);
    const rawWaypoints = (req.body as { waypoints?: unknown } | undefined)?.waypoints;
    const rawCorridorMiles = (req.body as { corridorMiles?: unknown; corridor_miles?: unknown } | undefined)?.corridorMiles
      ?? (req.body as { corridorMiles?: unknown; corridor_miles?: unknown } | undefined)?.corridor_miles;
    const preferenceRaw = ensureString((req.body as { preference?: unknown } | undefined)?.preference);

    if (!start || !end) {
      return res.status(400).json({ error: 'start and end are required' });
    }

    let waypoints: string[] = [];
    if (rawWaypoints !== undefined) {
      if (!Array.isArray(rawWaypoints)) {
        return res.status(400).json({ error: 'waypoints must be an array of strings' });
      }
      waypoints = rawWaypoints
        .map((w) => ensureString(w))
        .filter((w): w is string => Boolean(w));
    }

    if (waypoints.length > 10) {
      return res.status(400).json({ error: 'Too many waypoints (max 10)' });
    }

    const corridorMiles = Math.round(Math.max(0, ensureNumber(rawCorridorMiles) ?? 30));
    const preference = preferenceRaw === 'charger_optimized' ? 'charger_optimized' : 'fastest';

    const result = await pool.query<SavedRouteRow>(
      `
        INSERT INTO saved_routes (user_id, name, start_query, end_query, waypoints, corridor_miles, preference)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [req.user!.id, name ?? null, start, end, waypoints, corridorMiles, preference]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating saved route:', error);
    return res.status(500).json({ error: 'Failed to create saved route' });
  }
});

export default router;
