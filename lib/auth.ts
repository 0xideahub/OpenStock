import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';

export interface AuthResult {
  userId: string;
  method: 'api-key' | 'jwt';
}

/**
 * Dual authentication: Supports both API key (legacy) and JWT tokens
 *
 * MIGRATION PLAN:
 * 1. Phase 1: Support both API key and JWT (current)
 * 2. Phase 2: Mobile apps switch to JWT only
 * 3. Phase 3: Remove API key support after all clients updated
 * 4. Phase 4: Rotate/delete old API key
 */
export async function authenticate(request: Request): Promise<AuthResult | NextResponse> {
  const apiKey = request.headers.get('x-api-key');
  const authHeader = request.headers.get('authorization');

  // Method 1: Legacy API key (TEMPORARY - will be removed)
  if (apiKey) {
    const validApiKey = process.env.INTERNAL_API_KEY;
    if (!validApiKey) {
      return NextResponse.json(
        { error: 'API key authentication not configured' },
        { status: 500 }
      );
    }

    if (apiKey === validApiKey) {
      return {
        userId: 'legacy-api-key',
        method: 'api-key',
      };
    }

    // Invalid API key
    return NextResponse.json(
      { error: 'Invalid API key' },
      { status: 401 }
    );
  }

  // Method 2: JWT token (PREFERRED)
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');

    try {
      const client = await clerkClient();
      const verified = await client.verifyToken(token);

      return {
        userId: verified.sub,
        method: 'jwt',
      };
    } catch (error) {
      console.error('[auth] JWT verification failed:', error);
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }
  }

  // No authentication provided
  return NextResponse.json(
    { error: 'Missing authentication. Provide X-API-Key or Authorization header.' },
    { status: 401 }
  );
}
