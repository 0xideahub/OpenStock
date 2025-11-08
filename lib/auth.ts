import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';

export interface AuthResult {
  userId: string;
  method: 'api-key' | 'jwt';
}

/**
 * JWT authentication for all API endpoints
 *
 * MIGRATION COMPLETE:
 * ✅ Phase 1: Backend supported both API key and JWT
 * ✅ Phase 2: Mobile apps switched to JWT only
 * ✅ Phase 3: Removed API key from mobile app bundle
 * ✅ Phase 4: Removed API key support from backend (current)
 */
export async function authenticate(request: Request): Promise<AuthResult | NextResponse> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Missing or invalid Authorization header. JWT token required.' },
      { status: 401 }
    );
  }

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
      { error: 'Invalid or expired JWT token' },
      { status: 401 }
    );
  }
}
