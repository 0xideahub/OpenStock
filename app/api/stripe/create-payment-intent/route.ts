import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

/**
 * Create Stripe Payment Intent for Mobile SDK
 *
 * Creates a PaymentIntent for subscription payment via Stripe React Native SDK.
 * Returns client secret for Payment Sheet initialization.
 *
 * POST /api/stripe/create-payment-intent
 * Body: { priceId: string, userId: string, userEmail: string }
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

export async function POST(req: NextRequest) {
  try {
    const { priceId, userId, userEmail } = await req.json();

    if (!priceId || !userId || !userEmail) {
      return NextResponse.json(
        { error: 'Missing required fields: priceId, userId, userEmail' },
        { status: 400 }
      );
    }

    console.log('[stripe] Creating payment intent for mobile SDK:', {
      priceId,
      userId,
      userEmail,
    });

    // Get or create customer
    const customers = await stripe.customers.list({
      email: userEmail,
      limit: 1,
    });

    let customer: Stripe.Customer;
    if (customers.data.length > 0) {
      customer = customers.data[0];
      console.log('[stripe] Found existing customer:', customer.id);
    } else {
      customer = await stripe.customers.create({
        email: userEmail,
        metadata: { userId },
      });
      console.log('[stripe] Created new customer:', customer.id);
    }

    // Get price details to determine amount
    const price = await stripe.prices.retrieve(priceId);

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: price.unit_amount!,
      currency: price.currency,
      customer: customer.id,
      metadata: {
        userId,
        priceId,
      },
      // This will be used to create subscription after successful payment
      setup_future_usage: 'off_session',
    });

    console.log('[stripe] ✅ Payment intent created:', {
      paymentIntentId: paymentIntent.id,
      customerId: customer.id,
      amount: paymentIntent.amount,
    });

    return NextResponse.json(
      {
        paymentIntent: paymentIntent.client_secret,
        customerId: customer.id,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[stripe] Create payment intent error:', error);
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}
