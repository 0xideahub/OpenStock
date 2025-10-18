/**
 * Redis Cache Utility
 *
 * Provides a centralized caching layer using Upstash Redis for:
 * - Yahoo Finance session management (cookie + crumb)
 * - Stock fundamentals data
 * - Future: Price data, metadata, etc.
 *
 * Benefits:
 * - Persistent across server restarts
 * - Shared across multiple instances (horizontal scaling)
 * - Automatic TTL expiration
 */

import { Redis } from '@upstash/redis';

/**
 * Initialize Upstash Redis client
 * Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables
 */
let redis: Redis | null = null;

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = Redis.fromEnv();
    console.info('[cache] Redis cache initialized successfully');
  } else {
    console.warn(
      '[cache] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set - caching disabled'
    );
  }
} catch (error) {
  console.error('[cache] Failed to initialize Redis:', error);
}

/**
 * Check if Redis caching is enabled
 */
export function isCacheEnabled(): boolean {
  return redis !== null;
}

/**
 * Get a value from Redis cache
 *
 * @param key - Cache key
 * @returns Cached value or null if not found/expired
 */
export async function getCached<T>(key: string): Promise<T | null> {
  if (!redis) {
    return null;
  }

  try {
    const value = await redis.get<T>(key);
    return value;
  } catch (error) {
    console.error(`[cache] Error getting key "${key}":`, error);
    return null;
  }
}

/**
 * Set a value in Redis cache with TTL
 *
 * @param key - Cache key
 * @param value - Value to cache (must be JSON-serializable)
 * @param ttlSeconds - Time to live in seconds
 */
export async function setCached<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  if (!redis) {
    return;
  }

  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (error) {
    console.error(`[cache] Error setting key "${key}":`, error);
  }
}

/**
 * Delete a value from Redis cache
 *
 * @param key - Cache key to delete
 */
export async function deleteCached(key: string): Promise<void> {
  if (!redis) {
    return;
  }

  try {
    await redis.del(key);
  } catch (error) {
    console.error(`[cache] Error deleting key "${key}":`, error);
  }
}

/**
 * Check if a key exists in cache
 *
 * @param key - Cache key
 * @returns true if key exists and hasn't expired
 */
export async function hasCached(key: string): Promise<boolean> {
  if (!redis) {
    return false;
  }

  try {
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (error) {
    console.error(`[cache] Error checking key "${key}":`, error);
    return false;
  }
}

/**
 * Get multiple values from cache in a single call
 *
 * @param keys - Array of cache keys
 * @returns Array of values (null for missing keys)
 */
export async function getManyCached<T>(keys: string[]): Promise<(T | null)[]> {
  if (!redis || keys.length === 0) {
    return keys.map(() => null);
  }

  try {
    // Use pipeline for efficient batch operations
    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.get(key));
    const results = await pipeline.exec();
    return results as (T | null)[];
  } catch (error) {
    console.error('[cache] Error getting multiple keys:', error);
    return keys.map(() => null);
  }
}

/**
 * Clear all cache keys matching a pattern
 *
 * @param pattern - Redis key pattern (e.g., "fundamentals:*")
 */
export async function clearCachePattern(pattern: string): Promise<void> {
  if (!redis) {
    return;
  }

  try {
    // Note: SCAN is more efficient than KEYS for large datasets
    // but @upstash/redis doesn't support scan yet, so we use a simple approach
    console.warn(
      `[cache] clearCachePattern("${pattern}") - manual implementation required`
    );
    // For now, this is a no-op. Pattern clearing would require iterating keys
    // which is not recommended for production Redis usage
  } catch (error) {
    console.error(`[cache] Error clearing pattern "${pattern}":`, error);
  }
}

/**
 * Get cache statistics (if Redis is configured)
 */
export async function getCacheStats(): Promise<{
  enabled: boolean;
  connected: boolean;
}> {
  if (!redis) {
    return { enabled: false, connected: false };
  }

  try {
    // Simple ping to check connection
    await redis.ping();
    return { enabled: true, connected: true };
  } catch (error) {
    console.error('[cache] Error getting cache stats:', error);
    return { enabled: true, connected: false };
  }
}
