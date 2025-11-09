import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { authenticate } from '@/lib/auth';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';

interface SubscriptionUpdateBody {
  tier: 'free' | 'premium';
  status: 'none' | 'active' | 'trial' | 'canceled' | 'past_due';
  stripeCustomerId?: string;
}

/**
 * Update user subscription information
 * Called by mobile app after successful Stripe payment
 */
export async function PUT(request: Request) {
  // Authenticate user
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { userId } = authResult;

  let body: SubscriptionUpdateBody;
  try {
    body = (await request.json()) as SubscriptionUpdateBody;
  } catch (_error) {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const { tier, status, stripeCustomerId } = body;

  if (!tier || !status) {
    return NextResponse.json(
      { error: 'tier and status are required' },
      { status: 400 },
    );
  }

  if (!['free', 'premium'].includes(tier)) {
    return NextResponse.json(
      { error: 'tier must be "free" or "premium"' },
      { status: 400 },
    );
  }

  if (!['none', 'active', 'trial', 'canceled', 'past_due'].includes(status)) {
    return NextResponse.json(
      { error: 'Invalid subscription status' },
      { status: 400 },
    );
  }

  try {
    // Map our tier/status to Stripe subscription status
    const stripeStatus = tier === 'premium' && (status === 'active' || status === 'trial')
      ? 'active'
      : 'canceled';

    // Update user in database
    await db
      .update(user)
      .set({
        stripeCustomerId: stripeCustomerId || null,
        stripeSubscriptionStatus: stripeStatus,
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId));

    console.log(`[subscription] Updated subscription for user ${userId}: ${tier} (${status})`);

    return NextResponse.json(
      {
        success: true,
        message: 'Subscription updated successfully',
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[subscription] Failed to update subscription:', error);
    return NextResponse.json(
      { error: 'Failed to update subscription' },
      { status: 500 },
    );
  }
}

/**
 * Get user subscription information
 */
export async function GET(request: Request) {
  // Authenticate user
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { userId } = authResult;

  try {
    // Query user from database
    const userRecord = await db.query.user.findFirst({
      where: eq(user.id, userId),
      columns: {
        stripeCustomerId: true,
        stripeSubscriptionStatus: true,
        subscriptionEndsAt: true,
      },
    });

    if (!userRecord) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 },
      );
    }

    // Map Stripe status to our tier/status
    const isPremium = userRecord.stripeSubscriptionStatus === 'active';
    const tier = isPremium ? 'premium' : 'free';
    const status = userRecord.stripeSubscriptionStatus === 'active'
      ? 'active'
      : userRecord.stripeSubscriptionStatus === 'trialing'
        ? 'trial'
        : userRecord.stripeSubscriptionStatus === 'past_due'
          ? 'past_due'
          : userRecord.stripeSubscriptionStatus === 'canceled'
            ? 'canceled'
            : 'none';

    return NextResponse.json(
      {
        tier,
        status,
        stripeCustomerId: userRecord.stripeCustomerId,
        currentPeriodEnd: userRecord.subscriptionEndsAt,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[subscription] Failed to fetch subscription:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscription' },
      { status: 500 },
    );
  }
}
