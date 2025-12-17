import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db.js';
import { config } from '../config.js';
import { getCookie, hashSessionToken } from '../auth/session.js';

type SessionLookupRow = {
  user_id: number;
  email: string;
  session_id: number;
};

export async function attachAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = getCookie(req, config.auth.sessionCookieName);
  if (!token) return next();

  try {
    const tokenHash = hashSessionToken(token);
    const result = await pool.query<SessionLookupRow>(
      `
        SELECT u.id AS user_id, u.email, s.id AS session_id
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.expires_at > NOW()
        LIMIT 1
      `,
      [tokenHash]
    );

    const row = result.rows[0];
    if (!row) return next();

    req.user = { id: row.user_id, email: row.email };
    req.session = { id: row.session_id };

    void pool.query('UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1', [row.session_id]).catch(() => {
      // ignore last-seen update failures
    });
  } catch (error) {
    console.error('Auth lookup failed:', error);
  }

  return next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
