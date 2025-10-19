import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const limitMock = vi.fn();
const slidingWindowMock = vi.fn();
const constructorMock = vi.fn();
const redisFromEnvMock = vi.fn();

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow = slidingWindowMock;
    limit = limitMock;

    constructor(config: unknown) {
      constructorMock(config);
    }
  },
}));

vi.mock('@upstash/redis', () => ({
  Redis: {
    fromEnv: redisFromEnvMock,
  },
}));

const resetEnv = () => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.RATE_LIMIT_REQUESTS;
  delete process.env.RATE_LIMIT_WINDOW;
};

describe('ratelimit helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnv();
    limitMock.mockReset();
    slidingWindowMock.mockReset();
    constructorMock.mockReset();
    redisFromEnvMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows all requests when rate limiting is disabled', async () => {
    const rateLimitModule = await import('@/lib/ratelimit');

    expect(rateLimitModule.isRateLimitEnabled()).toBe(false);

    const request = new Request('http://example.com');
    const result = await rateLimitModule.checkRateLimit(request);

    expect(result.success).toBe(true);
    expect(result.limit).toBe(60);
    expect(result.remaining).toBe(60);
    expect(limitMock).not.toHaveBeenCalled();
    expect(redisFromEnvMock).not.toHaveBeenCalled();
  });

  it('initializes redis rate limiting when environment variables are set', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    process.env.RATE_LIMIT_REQUESTS = '42';
    process.env.RATE_LIMIT_WINDOW = '120 s';

    slidingWindowMock.mockReturnValue('mockLimiter');
    redisFromEnvMock.mockReturnValue({ client: true });
    limitMock.mockResolvedValue({
      success: false,
      limit: 42,
      remaining: 0,
      reset: 1700000000000,
      pending: Promise.resolve(),
    });

    const rateLimitModule = await import('@/lib/ratelimit');

    expect(rateLimitModule.isRateLimitEnabled()).toBe(true);
    expect(slidingWindowMock).toHaveBeenCalledWith(42, '120 s');
    expect(constructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        redis: { client: true },
        limiter: 'mockLimiter',
        analytics: true,
        prefix: 'ratelimit:fundamentals',
      }),
    );

    const request = new Request('http://example.com', {
      headers: {
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
        'x-real-ip': '9.9.9.9',
      },
    });

    const result = await rateLimitModule.checkRateLimit(request);

    expect(limitMock).toHaveBeenCalledWith('1.2.3.4');
    expect(result.success).toBe(false);
    expect(result.limit).toBe(42);
    expect(result.remaining).toBe(0);
  });

  it('fails open when redis check throws an error', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    slidingWindowMock.mockReturnValue('mockLimiter');
    redisFromEnvMock.mockReturnValue({ client: true });
    limitMock.mockRejectedValue(new Error('redis down'));

    const rateLimitModule = await import('@/lib/ratelimit');

    const request = new Request('http://example.com', {
      headers: { 'x-real-ip': '10.0.0.1' },
    });

    const result = await rateLimitModule.checkRateLimit(request);

    expect(limitMock).toHaveBeenCalledWith('10.0.0.1');
    expect(result.success).toBe(true);
    expect(result.limit).toBe(60);
    expect(result.remaining).toBe(60);
  });

  it('formats rate limit headers correctly', async () => {
    const { getRateLimitHeaders } = await import('@/lib/ratelimit');

    const headers = getRateLimitHeaders({
      limit: 100,
      remaining: 50,
      reset: Date.UTC(2025, 0, 1, 0, 0, 0),
    });

    expect(headers).toEqual({
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '50',
      'X-RateLimit-Reset': '2025-01-01T00:00:00.000Z',
    });
  });
});
