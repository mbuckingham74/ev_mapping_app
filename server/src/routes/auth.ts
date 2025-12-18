import { Router, Request } from 'express';
import { pool } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { clearSessionCookie, createSession, deleteSessionByToken, getCookie, setSessionCookie } from '../auth/session.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { loginLimiter, signupLimiter } from '../middleware/rateLimiter.js';
import { createLogger } from '../logger.js';

const router = Router();
const fallbackLog = createLogger('auth');

// Use request-bound logger (with correlation ID) when available, fall back to module logger
function getLog(req: Request) {
  return req.log ?? fallbackLog;
}

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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
};

type ConnectorType = 'CCS' | 'CHADEMO' | 'NACS';

type PreferencesRow = {
  user_id: number;
  vehicle_name: string | null;
  range_miles: number;
  efficiency_mi_per_kwh: number | null;
  battery_kwh: number | null;
  min_arrival_percent: number;
  default_corridor_miles: number;
  default_preference: 'fastest' | 'charger_optimized';
  max_detour_factor: number;
  max_charging_speed_kw: number | null;
  connector_type: ConnectorType | null;
  created_at: string;
  updated_at: string;
};

async function ensurePreferencesRow(userId: number): Promise<PreferencesRow> {
  await pool.query('INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  const result = await pool.query<PreferencesRow>('SELECT * FROM user_preferences WHERE user_id = $1', [userId]);
  const row = result.rows[0];
  if (!row) throw new Error('Failed to load user preferences');
  return row;
}

router.get('/me', async (req, res) => {
  if (!req.user) {
    return res.json({ user: null, preferences: null });
  }

  try {
    const preferences = await ensurePreferencesRow(req.user.id);
    return res.json({ user: req.user, preferences });
  } catch (error) {
    getLog(req).error({ err: error, userId: req.user?.id }, 'Error loading current user');
    return res.status(500).json({ error: 'Failed to load current user' });
  }
});

router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const emailRaw = ensureString((req.body as { email?: unknown } | undefined)?.email);
    const password = ensureString((req.body as { password?: unknown } | undefined)?.password);

    if (!emailRaw || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const email = normalizeEmail(emailRaw);
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const passwordHash = await hashPassword(password);

    let created: { id: number; email: string };
    try {
      const result = await pool.query<{ id: number; email: string }>(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passwordHash]
      );
      created = result.rows[0]!;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === '23505') {
        return res.status(409).json({ error: 'Email already registered' });
      }
      throw error;
    }

    const preferences = await ensurePreferencesRow(created.id);
    const token = await createSession(created.id);
    setSessionCookie(res, token);

    return res.status(201).json({ user: { id: created.id, email: created.email }, preferences });
  } catch (error) {
    getLog(req).error({ err: error }, 'Signup error');
    return res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const emailRaw = ensureString((req.body as { email?: unknown } | undefined)?.email);
    const password = ensureString((req.body as { password?: unknown } | undefined)?.password);

    if (!emailRaw || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const email = normalizeEmail(emailRaw);
    const result = await pool.query<UserRow>('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const preferences = await ensurePreferencesRow(user.id);
    const token = await createSession(user.id);
    setSessionCookie(res, token);

    return res.json({ user: { id: user.id, email: user.email }, preferences });
  } catch (error) {
    getLog(req).error({ err: error }, 'Login error');
    return res.status(500).json({ error: 'Failed to log in' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const token = getCookie(req, config.auth.sessionCookieName);
    if (token) {
      await deleteSessionByToken(token);
    }
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    getLog(req).error({ err: error }, 'Logout error');
    clearSessionCookie(res);
    return res.status(500).json({ error: 'Failed to log out' });
  }
});

router.patch('/preferences', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const existing = await ensurePreferencesRow(userId);

    const body = (req.body && typeof req.body === 'object') ? (req.body as Record<string, unknown>) : {};

    const rawRangeMiles = hasOwn(body, 'rangeMiles') ? body.rangeMiles : hasOwn(body, 'range_miles') ? body.range_miles : undefined;
    const rawEfficiency = hasOwn(body, 'efficiencyMiPerKwh') ? body.efficiencyMiPerKwh : hasOwn(body, 'efficiency_mi_per_kwh') ? body.efficiency_mi_per_kwh : undefined;
    const rawBatteryKwh = hasOwn(body, 'batteryKwh') ? body.batteryKwh : hasOwn(body, 'battery_kwh') ? body.battery_kwh : undefined;
    const rawMinArrivalPercent = hasOwn(body, 'minArrivalPercent') ? body.minArrivalPercent : hasOwn(body, 'min_arrival_percent') ? body.min_arrival_percent : undefined;
    const rawDefaultCorridorMiles = hasOwn(body, 'defaultCorridorMiles') ? body.defaultCorridorMiles : hasOwn(body, 'default_corridor_miles') ? body.default_corridor_miles : undefined;
    const rawDefaultPreference = hasOwn(body, 'defaultPreference') ? body.defaultPreference : hasOwn(body, 'default_preference') ? body.default_preference : undefined;
    const rawMaxDetourFactor = hasOwn(body, 'maxDetourFactor') ? body.maxDetourFactor : hasOwn(body, 'max_detour_factor') ? body.max_detour_factor : undefined;
    const rawMaxChargingSpeedKw = hasOwn(body, 'maxChargingSpeedKw') ? body.maxChargingSpeedKw : hasOwn(body, 'max_charging_speed_kw') ? body.max_charging_speed_kw : undefined;
    const rawConnectorType = hasOwn(body, 'connectorType') ? body.connectorType : hasOwn(body, 'connector_type') ? body.connector_type : undefined;

    const next: Omit<PreferencesRow, 'created_at' | 'updated_at'> = {
      user_id: userId,
      vehicle_name: existing.vehicle_name,
      range_miles: existing.range_miles,
      efficiency_mi_per_kwh: existing.efficiency_mi_per_kwh,
      battery_kwh: existing.battery_kwh,
      min_arrival_percent: existing.min_arrival_percent,
      default_corridor_miles: existing.default_corridor_miles,
      default_preference: existing.default_preference,
      max_detour_factor: existing.max_detour_factor,
      max_charging_speed_kw: existing.max_charging_speed_kw,
      connector_type: existing.connector_type,
    };

    if (hasOwn(body, 'vehicleName') || hasOwn(body, 'vehicle_name')) {
      const rawVehicleName = hasOwn(body, 'vehicleName') ? body.vehicleName : body.vehicle_name;
      if (rawVehicleName === null) {
        next.vehicle_name = null;
      } else if (typeof rawVehicleName === 'string') {
        const trimmed = rawVehicleName.trim();
        next.vehicle_name = trimmed ? trimmed : null;
      } else if (rawVehicleName !== undefined) {
        return res.status(400).json({ error: 'vehicleName must be a string or null' });
      }
    }

    const rangeMiles = ensureNumber(rawRangeMiles);
    if (rangeMiles !== null) {
      const rounded = Math.round(rangeMiles);
      if (rounded < 0 || rounded > 2000) {
        return res.status(400).json({ error: 'rangeMiles must be between 0 and 2000' });
      }
      next.range_miles = rounded;
    } else if (rawRangeMiles === null) {
      return res.status(400).json({ error: 'rangeMiles cannot be null' });
    }

    if (rawEfficiency === null) {
      next.efficiency_mi_per_kwh = null;
    } else {
      const efficiency = ensureNumber(rawEfficiency);
      if (efficiency !== null) {
        if (efficiency <= 0 || efficiency > 20) {
          return res.status(400).json({ error: 'efficiencyMiPerKwh must be between 0 and 20' });
        }
        next.efficiency_mi_per_kwh = efficiency;
      }
    }

    if (rawBatteryKwh === null) {
      next.battery_kwh = null;
    } else {
      const batteryKwh = ensureNumber(rawBatteryKwh);
      if (batteryKwh !== null) {
        if (batteryKwh <= 0 || batteryKwh > 250) {
          return res.status(400).json({ error: 'batteryKwh must be between 0 and 250' });
        }
        next.battery_kwh = batteryKwh;
      }
    }

    const minArrivalPercent = ensureNumber(rawMinArrivalPercent);
    if (minArrivalPercent !== null) {
      const rounded = Math.round(minArrivalPercent);
      if (rounded < 0 || rounded > 100) {
        return res.status(400).json({ error: 'minArrivalPercent must be between 0 and 100' });
      }
      next.min_arrival_percent = rounded;
    } else if (rawMinArrivalPercent === null) {
      return res.status(400).json({ error: 'minArrivalPercent cannot be null' });
    }

    const defaultCorridorMiles = ensureNumber(rawDefaultCorridorMiles);
    if (defaultCorridorMiles !== null) {
      const rounded = Math.round(defaultCorridorMiles);
      if (rounded < 0 || rounded > 200) {
        return res.status(400).json({ error: 'defaultCorridorMiles must be between 0 and 200' });
      }
      next.default_corridor_miles = rounded;
    } else if (rawDefaultCorridorMiles === null) {
      return res.status(400).json({ error: 'defaultCorridorMiles cannot be null' });
    }

    const defaultPreferenceRaw = ensureString(rawDefaultPreference);
    if (defaultPreferenceRaw) {
      if (defaultPreferenceRaw !== 'fastest' && defaultPreferenceRaw !== 'charger_optimized') {
        return res.status(400).json({ error: 'defaultPreference must be "fastest" or "charger_optimized"' });
      }
      next.default_preference = defaultPreferenceRaw;
    } else if (rawDefaultPreference === null) {
      return res.status(400).json({ error: 'defaultPreference cannot be null' });
    }

    const maxDetourFactor = ensureNumber(rawMaxDetourFactor);
    if (maxDetourFactor !== null) {
      if (maxDetourFactor < 1 || maxDetourFactor > 5) {
        return res.status(400).json({ error: 'maxDetourFactor must be between 1 and 5' });
      }
      next.max_detour_factor = maxDetourFactor;
    } else if (rawMaxDetourFactor === null) {
      return res.status(400).json({ error: 'maxDetourFactor cannot be null' });
    }

    if (rawMaxChargingSpeedKw === null) {
      next.max_charging_speed_kw = null;
    } else {
      const maxChargingSpeedKw = ensureNumber(rawMaxChargingSpeedKw);
      if (maxChargingSpeedKw !== null) {
        const rounded = Math.round(maxChargingSpeedKw);
        if (rounded < 0 || rounded > 1000) {
          return res.status(400).json({ error: 'maxChargingSpeedKw must be between 0 and 1000' });
        }
        next.max_charging_speed_kw = rounded;
      }
    }

    if (rawConnectorType === null) {
      next.connector_type = null;
    } else {
      const connectorTypeRaw = ensureString(rawConnectorType);
      if (connectorTypeRaw) {
        const normalized = connectorTypeRaw.trim().toUpperCase();
        if (normalized !== 'CCS' && normalized !== 'CHADEMO' && normalized !== 'NACS') {
          return res.status(400).json({ error: 'connectorType must be "CCS", "CHADEMO", "NACS", or null' });
        }
        next.connector_type = normalized as ConnectorType;
      }
    }

    const updated = await pool.query<PreferencesRow>(
      `
        INSERT INTO user_preferences (
          user_id,
          vehicle_name,
          range_miles,
          efficiency_mi_per_kwh,
          battery_kwh,
          min_arrival_percent,
          default_corridor_miles,
          default_preference,
          max_detour_factor,
          max_charging_speed_kw,
          connector_type,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          vehicle_name = EXCLUDED.vehicle_name,
          range_miles = EXCLUDED.range_miles,
          efficiency_mi_per_kwh = EXCLUDED.efficiency_mi_per_kwh,
          battery_kwh = EXCLUDED.battery_kwh,
          min_arrival_percent = EXCLUDED.min_arrival_percent,
          default_corridor_miles = EXCLUDED.default_corridor_miles,
          default_preference = EXCLUDED.default_preference,
          max_detour_factor = EXCLUDED.max_detour_factor,
          max_charging_speed_kw = EXCLUDED.max_charging_speed_kw,
          connector_type = EXCLUDED.connector_type,
          updated_at = NOW()
        RETURNING *
      `,
      [
        next.user_id,
        next.vehicle_name,
        next.range_miles,
        next.efficiency_mi_per_kwh,
        next.battery_kwh,
        next.min_arrival_percent,
        next.default_corridor_miles,
        next.default_preference,
        next.max_detour_factor,
        next.max_charging_speed_kw,
        next.connector_type,
      ]
    );

    return res.json(updated.rows[0]);
  } catch (error) {
    getLog(req).error({ err: error, userId: req.user?.id }, 'Error updating preferences');
    return res.status(500).json({ error: 'Failed to update preferences' });
  }
});

export default router;
