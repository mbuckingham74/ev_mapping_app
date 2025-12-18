import rateLimit from 'express-rate-limit';

/**
 * Rate limiting middleware.
 *
 * Limitations to be aware of:
 * - Uses in-memory store (resets on restart, not shared across instances)
 * - For horizontal scaling, consider a shared store (Redis, etc.)
 * - Requires 'trust proxy' to be set for correct client IP behind reverse proxy
 * - Counts all requests (successful and failed), not just failures
 * - RateLimit-* headers are set but not exposed via CORS (visible in devtools only)
 */

// Login rate limit: 10 requests per 15 minutes per IP
// Separate from signup to avoid one affecting the other
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Signup rate limit: 5 requests per 15 minutes per IP
// More restrictive since signup is less frequent
export const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many signup attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limit: 100 requests per minute per IP
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Route planning rate limit: 20 requests per minute per IP
// More restrictive since route planning is expensive (external API calls)
export const routeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many route requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
