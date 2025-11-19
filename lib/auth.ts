import { NextResponse } from 'next/server';
import { jwtVerify, createRemoteJWKSet } from 'jose';

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
    const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;

    if (!publishableKey) {
      console.error('[auth] CLERK_PUBLISHABLE_KEY not configured');
      return NextResponse.json(
        { error: 'Server authentication not configured' },
        { status: 500 }
      );
    }

    // Decode the publishable key to get the Frontend API URL
    // Clerk publishable keys are base64 encoded and contain the domain
    const decodedKey = Buffer.from(publishableKey.replace('pk_live_', '').replace('pk_test_', ''), 'base64').toString();
    const clerkDomain = decodedKey.split('$')[0]; // e.g., "clerk.vaulk72.com"

    console.log('[auth] Using Clerk domain:', clerkDomain);

    // Create JWKS endpoint URL for this specific Clerk instance
    const jwksUrl = `https://${clerkDomain}/.well-known/jwks.json`;
    console.log('[auth] JWKS URL:', jwksUrl);

    // Verify the JWT using the JWKS from the correct Clerk instance
    const JWKS = createRemoteJWKSet(new URL(jwksUrl));

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${clerkDomain}`,
    });

    console.log('[auth] ✅ JWT verified successfully for user:', payload.sub);

    return {
      userId: payload.sub as string,
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
