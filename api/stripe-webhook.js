/**
 * Stripe webhook — the only writer of authoritative subscription state.
 *
 * Trust model: this endpoint is unauthenticated by necessity, so the signature
 * *is* the authentication. Three rules, in order:
 *
 *   1. Reject anything whose signature does not verify against the raw body
 *      with STRIPE_WEBHOOK_SECRET. No secret configured means reject, never
 *      "accept and hope".
 *   2. Ignore an event id we have already applied, so retries and replays are
 *      no-ops rather than double writes.
 *   3. Re-read objects from Stripe by id instead of trusting the payload's
 *      nested copies, and drop writes older than the state we already hold.
 *
 * Never parse the body before verifying it, and never widen this to accept an
 * unsigned request in development — use `stripe listen` instead.
 */
import { getCore, saveCore } from './lib/store.js';
import { json } from './lib/http.js';
import { stripe } from './lib/stripe.js';
import { applySubscription, applyCanceled, billingOf } from './lib/billing.js';

const MAX_REMEMBERED_EVENTS = 1000;

const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
]);

function idOf(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

/**
 * Pull a subscription id out of an invoice. Stripe moved this from
 * `invoice.subscription` onto `invoice.parent` in 2025-04-30.basil, so read
 * both shapes rather than pinning to one.
 */
function invoiceSubscriptionId(invoice) {
  return (
    idOf(invoice?.parent?.subscription_details?.subscription)
    || idOf(invoice?.subscription)
    || idOf(invoice?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription)
    || null
  );
}

/**
 * Map a Stripe object back to a local account.
 *
 * Metadata first (we wrote it when creating the checkout), then the stored
 * customer id. Deliberately never by email — an email match would let anyone
 * who can create a Stripe customer with someone else's address take over their
 * entitlement.
 */
function findAccount(core, { userId, customerId }) {
  if (userId) {
    const byId = core.users.find((u) => u.id === userId);
    if (byId) {
      const linked = billingOf(byId).customerId;
      if (!linked || !customerId || linked === customerId) return byId;
      console.error(`[stripe-webhook] metadata userId ${userId} does not match customer ${customerId}`);
    }
  }
  if (customerId) {
    return core.users.find((u) => billingOf(u).customerId === customerId) || null;
  }
  return null;
}

/** Always fetch the subscription fresh; payload copies can be stale or partial. */
async function loadSubscription(subscriptionId) {
  return stripe().subscriptions.retrieve(subscriptionId, { expand: ['items'] });
}

export async function POST(request) {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set — rejecting');
    return json({ error: 'Webhook not configured' }, 503);
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ error: 'Missing signature' }, 400);

  // Raw text, before any JSON parsing — the signature covers these exact bytes.
  const raw = await request.text();

  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return json({ error: 'Invalid signature' }, 400);
  }

  if (!HANDLED.has(event.type)) {
    return json({ received: true, ignored: event.type });
  }

  try {
    const core = await getCore();

    // Replay protection. Stripe retries on any non-2xx, and at-least-once
    // delivery means the same event can legitimately arrive twice.
    if (core.stripeEvents.includes(event.id)) {
      return json({ received: true, duplicate: true });
    }

    const changed = await handleEvent(core, event);

    core.stripeEvents.push(event.id);
    if (core.stripeEvents.length > MAX_REMEMBERED_EVENTS) {
      core.stripeEvents = core.stripeEvents.slice(-MAX_REMEMBERED_EVENTS);
    }
    await saveCore(core);

    return json({ received: true, applied: changed });
  } catch (err) {
    console.error('[stripe-webhook]', event.type, err);
    // 500 tells Stripe to retry, which is what we want for a transient failure.
    return json({ error: 'Webhook handling failed' }, 500);
  }
}

async function handleEvent(core, event) {
  const object = event.data.object;
  const eventTs = event.created || Math.floor(Date.now() / 1000);

  if (event.type.startsWith('checkout.session.')) {
    if (object.mode !== 'subscription') return false;
    const subscriptionId = idOf(object.subscription);
    if (!subscriptionId) return false;

    const subscription = await loadSubscription(subscriptionId);
    const account = findAccount(core, {
      userId: object.client_reference_id || object.metadata?.userId || subscription.metadata?.userId,
      customerId: idOf(object.customer),
    });
    if (!account) {
      console.error(`[stripe-webhook] no account for checkout ${object.id}`);
      return false;
    }
    return applySubscription(account, subscription, eventTs);
  }

  if (event.type === 'customer.subscription.deleted') {
    const account = findAccount(core, {
      userId: object.metadata?.userId,
      customerId: idOf(object.customer),
    });
    if (!account) return false;
    return applyCanceled(account, object.id, eventTs);
  }

  if (event.type.startsWith('customer.subscription.')) {
    const account = findAccount(core, {
      userId: object.metadata?.userId,
      customerId: idOf(object.customer),
    });
    if (!account) {
      console.error(`[stripe-webhook] no account for subscription ${object.id}`);
      return false;
    }
    const subscription = await loadSubscription(object.id);
    return applySubscription(account, subscription, eventTs);
  }

  if (event.type.startsWith('invoice.')) {
    const subscriptionId = invoiceSubscriptionId(object);
    if (!subscriptionId) return false;

    const account = findAccount(core, {
      userId: object.subscription_details?.metadata?.userId,
      customerId: idOf(object.customer),
    });
    if (!account) return false;

    // The invoice tells us something moved; the subscription tells us to what.
    const subscription = await loadSubscription(subscriptionId);
    return applySubscription(account, subscription, eventTs);
  }

  return false;
}
