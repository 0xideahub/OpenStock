import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

/**
 * Stripe Webhook Handler
 *
 * This endpoint is PUBLIC (no auth required) to receive Stripe webhook events.
 * Stripe will send POST requests here for payment events like:
 * - checkout.session.completed
 * - payment_intent.succeeded
 * - customer.subscription.created
 * etc.
 *
 * POST /api/stripe/webhook
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    // Verify the webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      const error = err as Error;
      console.error('Webhook signature verification failed:', error.message);
      return NextResponse.json(
        { error: 'Webhook signature verification failed' },
        { status: 400 }
      );
    }

    // Handle the event
    console.log('Received Stripe event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object as Stripe.Checkout.Session;
        console.log('Checkout completed:', session.id);
        // TODO: Fulfill the order, grant access, etc.
        await handleCheckoutCompleted(session);
        break;

      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log('Payment succeeded:', paymentIntent.id);
        // Create subscription after successful payment
        await handlePaymentIntentSucceeded(paymentIntent);
        break;

      case 'customer.subscription.created':
        const subscription = event.data.object as Stripe.Subscription;
        console.log('Subscription created:', subscription.id);
        // TODO: Grant subscription access
        await handleSubscriptionCreated(subscription);
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object as Stripe.Subscription;
        console.log('Subscription deleted:', deletedSubscription.id);
        // TODO: Revoke subscription access
        await handleSubscriptionDeleted(deletedSubscription);
        break;

      case 'customer.subscription.updated':
        const updatedSubscription = event.data.object as Stripe.Subscription;
        console.log('Subscription updated:', updatedSubscription.id);
        // TODO: Update subscription status
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

// Helper functions
async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent
) {
  const { customer, metadata, payment_method } = paymentIntent;
  const { priceId, userId } = metadata;

  if (!customer || !priceId) {
    console.error('[webhook] Missing customer or priceId in payment intent');
    return;
  }

  console.log('[webhook] Creating subscription for customer:', customer);

  try {
    // Attach payment method to customer if not already attached
    if (payment_method) {
      console.log('[webhook] Attaching payment method to customer:', payment_method);
      await stripe.paymentMethods.attach(payment_method as string, {
        customer: customer as string,
      });

      // Set as default payment method for subscriptions
      await stripe.customers.update(customer as string, {
        invoice_settings: {
          default_payment_method: payment_method as string,
        },
      });

      console.log('[webhook] ✅ Payment method attached and set as default');
    }

    // Create subscription for this customer
    const subscription = await stripe.subscriptions.create({
      customer: customer as string,
      items: [{ price: priceId }],
      metadata: { userId },
      default_payment_method: payment_method as string,
    });

    console.log('[webhook] ✅ Subscription created:', subscription.id);
  } catch (error) {
    console.error('[webhook] Failed to create subscription:', error);
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  // TODO: Implement your logic here
  // Example: Update user's subscription status in database
  console.log('TODO: Handle checkout completed', session.customer);
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  // TODO: Implement your logic here
  // Example: Grant user access to premium features
  console.log('TODO: Handle subscription created', subscription.customer);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  // TODO: Implement your logic here
  // Example: Revoke user's premium access
  console.log('TODO: Handle subscription deleted', subscription.customer);
}
