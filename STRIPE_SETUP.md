# Stripe Integration Setup Guide

## Overview
This OpenStock backend now includes Stripe payment integration for handling subscriptions and payments.

## API Endpoints Created

### 1. Webhook Handler (PUBLIC - No Auth Required)
**Endpoint:** `POST /api/stripe/webhook`

This endpoint receives Stripe webhook events. It's **intentionally public** so Stripe can send events.

**Handled Events:**
- `checkout.session.completed` - Payment completed
- `payment_intent.succeeded` - One-time payment succeeded
- `customer.subscription.created` - New subscription
- `customer.subscription.updated` - Subscription changed
- `customer.subscription.deleted` - Subscription cancelled

### 2. Create Checkout Session
**Endpoint:** `POST /api/stripe/create-checkout`

Creates a Stripe Checkout session for payment collection.

**Request Body:**
```json
{
  "priceId": "price_xxx",
  "userId": "user_123",
  "userEmail": "user@example.com"
}
```

**Response:**
```json
{
  "url": "https://checkout.stripe.com/..."
}
```

### 3. Create Customer Portal
**Endpoint:** `POST /api/stripe/create-portal`

Creates a billing portal session for subscription management.

**Request Body:**
```json
{
  "customerId": "cus_xxx"
}
```

**Response:**
```json
{
  "url": "https://billing.stripe.com/..."
}
```

## Environment Variables Required

Add these to your `.env.local` file:

```bash
# Stripe Keys (Get from https://dashboard.stripe.com/apikeys)
STRIPE_SECRET_KEY=sk_test_... # or sk_live_... for production
STRIPE_PUBLISHABLE_KEY=pk_test_... # or pk_live_... for production

# Stripe Webhook Secret (Get from https://dashboard.stripe.com/webhooks)
# Create webhook endpoint: https://YOUR_DOMAIN/api/stripe/webhook
STRIPE_WEBHOOK_SECRET=whsec_...

# App URL (for redirect URLs)
NEXT_PUBLIC_APP_URL=https://vaulk72-8bucxeo7i-0xideahubs-projects.vercel.app
```

## Vercel Environment Setup

1. Go to your Vercel project settings
2. Navigate to "Environment Variables"
3. Add all the variables above
4. Redeploy

## Stripe Dashboard Setup

### 1. Get API Keys
1. Go to https://dashboard.stripe.com/apikeys
2. Copy your **Secret key** → `STRIPE_SECRET_KEY`
3. Copy your **Publishable key** → `STRIPE_PUBLISHABLE_KEY`

### 2. Create Webhook
1. Go to https://dashboard.stripe.com/webhooks
2. Click "Add endpoint"
3. Enter URL: `https://YOUR_VERCEL_URL/api/stripe/webhook`
4. Select events to listen for:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copy the **Signing secret** → `STRIPE_WEBHOOK_SECRET`

### 3. Create Products & Prices
1. Go to https://dashboard.stripe.com/products
2. Create a product (e.g., "Premium Subscription")
3. Add a price (e.g., $9.99/month)
4. Copy the **Price ID** (starts with `price_xxx`)

## Testing the Integration

### Test Webhook Locally
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

### Test Checkout Flow
```bash
curl -X POST https://YOUR_VERCEL_URL/api/stripe/create-checkout \
  -H "Content-Type: application/json" \
  -d '{
    "priceId": "price_xxx",
    "userId": "test_user_123",
    "userEmail": "test@example.com"
  }'
```

## Stripe Test Cards

Use these test card numbers in Stripe's test mode:

- **Success:** `4242 4242 4242 4242`
- **Decline:** `4000 0000 0000 0002`
- **3D Secure:** `4000 0027 6000 3184`

Use any future expiry date, any 3-digit CVC, and any postal code.

## TODO: Implementation Tasks

In `app/api/stripe/webhook/route.ts`, implement these functions:

1. `handleCheckoutCompleted()` - Update user's subscription status in your database
2. `handleSubscriptionCreated()` - Grant user access to premium features
3. `handleSubscriptionDeleted()` - Revoke user's premium access

## Security Notes

- ✅ Webhook endpoint verifies Stripe signature for security
- ✅ Never expose `STRIPE_SECRET_KEY` in client-side code
- ✅ Always validate webhook signatures
- ⚠️ Currently, checkout/portal endpoints have no auth - add auth before production

## Next Steps

1. Install Stripe: `npm install stripe`
2. Add environment variables to Vercel
3. Create webhook in Stripe Dashboard
4. Implement the TODO handler functions
5. Test with Stripe test mode
6. Add authentication to checkout/portal endpoints
7. Switch to production keys when ready

## Useful Links

- [Stripe Dashboard](https://dashboard.stripe.com)
- [Stripe Docs](https://stripe.com/docs)
- [Webhook Events Reference](https://stripe.com/docs/api/events/types)
- [Test Cards](https://stripe.com/docs/testing#cards)
