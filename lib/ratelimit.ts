/**
 * Rate Limiting Configuration
 *
 * Implements request rate limiting using Upstash Redis to prevent API abuse
 * and control costs for downstream API providers (Tiingo, Yahoo Finance).
 *
 * Architecture:
 * - Uses sliding window algorithm for accurate rate limiting
 * - Limits per IP address (via X-Forwarded-For header)
 * - Configurable limits via environment variables
 * - Graceful degradation if Redis is unavailable
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Rate limit configuration from environment or defaults
const RATE_LIMIT_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS || '60', 10);
const RATE_LIMIT_WINDOW = (process.env.RATE_LIMIT_WINDOW || '60 s') as `${number} ${'ms' | 's' | 'm' | 'h' | 'd'}`;

/**
 * Initialize Upstash Redis client
 * Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables
 */
let redis: Redis | null = null;
let ratelimitInstance: Ratelimit | null = null;

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = Redis.fromEnv();

    ratelimitInstance = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW),
      analytics: true, // Enable analytics for monitoring
      prefix: 'ratelimit:fundamentals', // Namespace for this rate limiter
    });

    console.info(`[ratelimit] Initialized with ${RATE_LIMIT_REQUESTS} requests per ${RATE_LIMIT_WINDOW}`);
  } else {
    console.warn('[ratelimit] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set - rate limiting disabled');
  }
} catch (error) {
  console.error('[ratelimit] Failed to initialize Upstash Redis:', error);
}

// Export the ratelimit instance
export const ratelimit = ratelimitInstance;

/**
 * Rate limit check for incoming requests
 *
 * @param request - The incoming Next.js request
 * @returns Object with success status and rate limit metadata
 */
export async function checkRateLimit(request: Request) {
  // If rate limiting is not configured, allow all requests
  if (!ratelimitInstance) {
    return {
      success: true,
      limit: RATE_LIMIT_REQUESTS,
      remaining: RATE_LIMIT_REQUESTS,
      reset: Date.now() + 60000,
      pending: Promise.resolve(),
    };
  }

  // Extract IP address from request headers
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || '127.0.0.1';

  try {
    // Check rate limit for this IP
    const result = await ratelimitInstance.limit(ip);

    if (!result.success) {
      console.warn(`[ratelimit] Rate limit exceeded for IP: ${ip}`);
    }

    return result;
  } catch (error) {
    console.error('[ratelimit] Error checking rate limit:', error);

    // On error, fail open (allow request) to prevent blocking legitimate traffic
    return {
      success: true,
      limit: RATE_LIMIT_REQUESTS,
      remaining: RATE_LIMIT_REQUESTS,
      reset: Date.now() + 60000,
      pending: Promise.resolve(),
    };
  }
}

/**
 * Get rate limit headers for response
 * Follows standard RateLimit header fields (draft RFC)
 */
export function getRateLimitHeaders(result: {
  limit: number;
  remaining: number;
  reset: number;
}) {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': new Date(result.reset).toISOString(),
  };
}

/**
 * Check if rate limiting is enabled
 */
export function isRateLimitEnabled(): boolean {
  return ratelimitInstance !== null;
}
