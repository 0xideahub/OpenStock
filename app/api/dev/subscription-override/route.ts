import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { authenticate } from '@/lib/auth';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';

/**
 * Development-only endpoint for testing premium features
 * Allows toggling subscription status without Stripe
 *
 * SECURITY: Only available in non-production environments
 */

interface DevOverrideBody {
  tier: 'free' | 'premium';
}

export async function POST(request: Request) {
  // Block in production
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development' },
      { status: 403 },
    );
  }

  // Authenticate user
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { userId } = authResult;

  let body: DevOverrideBody;
  try {
    body = (await request.json()) as DevOverrideBody;
  } catch (_error) {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const { tier } = body;

  if (!tier || !['free', 'premium'].includes(tier)) {
    return NextResponse.json(
      { error: 'tier must be "free" or "premium"' },
      { status: 400 },
    );
  }

  try {
    // Update user subscription status in database
    const stripeStatus = tier === 'premium' ? 'active' : null;

    await db
      .update(user)
      .set({
        stripeSubscriptionStatus: stripeStatus,
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId));

    console.log(`[dev-override] 🔧 Set ${userId} to ${tier} tier (status: ${stripeStatus})`);

    return NextResponse.json(
      {
        success: true,
        tier,
        status: tier === 'premium' ? 'active' : 'none',
        message: `Development override: User set to ${tier} tier`,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[dev-override] Failed to update subscription:', error);
    return NextResponse.json(
      { error: 'Failed to update subscription' },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  // Block in production
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development' },
      { status: 403 },
    );
  }

  // Authenticate user
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { userId } = authResult;

  try {
    const userRecord = await db.query.user.findFirst({
      where: eq(user.id, userId),
      columns: {
        stripeSubscriptionStatus: true,
      },
    });

    if (!userRecord) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 },
      );
    }

    const isPremium = userRecord.stripeSubscriptionStatus === 'active';
    const tier = isPremium ? 'premium' : 'free';

    return NextResponse.json(
      {
        tier,
        status: isPremium ? 'active' : 'none',
        isDev: true,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[dev-override] Failed to fetch subscription:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscription' },
      { status: 500 },
    );
  }
}
