import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { pool } from '../db.js';

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  const parts = header.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (key !== name) continue;
    const raw = trimmed.slice(equalsIndex + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  const maxAgeMs = config.auth.sessionTtlDays * 24 * 60 * 60 * 1000;

  res.cookie(config.auth.sessionCookieName, token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.auth.sessionCookieName, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export async function createSession(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);

  await pool.query(
    `
      INSERT INTO user_sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'))
    `,
    [userId, tokenHash, config.auth.sessionTtlDays]
  );

  return token;
}

export async function deleteSessionByToken(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
}
