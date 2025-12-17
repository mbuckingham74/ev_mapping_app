import crypto from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_DEFAULTS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
} as const;

function scryptAsync(password: string, salt: Buffer, keylen: number, params: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, params, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_DEFAULTS);
  return [
    'scrypt',
    String(SCRYPT_DEFAULTS.N),
    String(SCRYPT_DEFAULTS.r),
    String(SCRYPT_DEFAULTS.p),
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number.parseInt(parts[1] ?? '', 10);
  const r = Number.parseInt(parts[2] ?? '', 10);
  const p = Number.parseInt(parts[3] ?? '', 10);
  const saltB64 = parts[4] ?? '';
  const hashB64 = parts[5] ?? '';

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scryptAsync(password, salt, expected.length, { N, r, p, maxmem: SCRYPT_DEFAULTS.maxmem });
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

