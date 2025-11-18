import { NextResponse } from 'next/server';
import { verifyToken } from '@clerk/backend';

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
    const secretKey = process.env.CLERK_SECRET_KEY;
    const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;

    console.log('[auth] ========== CLERK KEY DEBUG ==========');
    console.log('[auth] Secret key exists:', !!secretKey);
    console.log('[auth] Secret key preview:', secretKey?.substring(0, 20) + '...' + secretKey?.slice(-8));
    console.log('[auth] Publishable key exists:', !!publishableKey);
    console.log('[auth] Publishable key preview:', publishableKey?.substring(0, 20) + '...' + publishableKey?.slice(-8));
    console.log('[auth] Publishable key FULL:', publishableKey);
    console.log('[auth] ========================================');

    if (!secretKey) {
      console.error('[auth] CLERK_SECRET_KEY not configured');
      return NextResponse.json(
        { error: 'Server authentication not configured' },
        { status: 500 }
      );
    }

    const verifyOptions = {
      secretKey,
      ...(publishableKey && { publishableKey }),
    };

    console.log('[auth] Calling verifyToken with options:', Object.keys(verifyOptions));

    const verified = await verifyToken(token, verifyOptions);

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
