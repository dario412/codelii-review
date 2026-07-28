/**
 * Billing endpoints.
 *
 *   GET  /api/billing                     → this user's subscription state
 *   GET  /api/billing?session_id=cs_…     → same, after verifying + syncing a checkout
 *   POST /api/billing {action:'checkout'} → Stripe Checkout URL (starts the trial)
 *   POST /api/billing {action:'portal'}   → Stripe Billing Portal URL
 *   POST /api/billing {action:'sync'}     → force a re-read from Stripe
 *
 * Every response is derived from Stripe or from webhook-written state. The
 * browser can request a checkout, never describe one: no price, no amount, no
 * trial length and no customer id is read from the request body.
 */
import { getCore, saveCore } from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import { stripe, priceId, siteUrl, isStripeConfigured, isTestMode, TRIAL_DAYS } from './lib/stripe.js';
import {
  billingOf,
  canCreateProjects,
  publicBilling,
  syncFromStripe,
  trialAvailable,
  applySubscription,
} from './lib/billing.js';

export async function OPTIONS() {
  return corsOptions('GET, POST, OPTIONS');
}

/**
 * Coarse per-user throttle. Serverless instances are short-lived so this is a
 * speed bump, not a wall — its job is to stop a loop from minting hundreds of
 * Checkout Sessions, and Stripe's own limits catch the rest.
 */
const lastCall = new Map();
function throttled(key, ms) {
  const now = Date.now();
  const prev = lastCall.get(key) || 0;
  if (now - prev < ms) return true;
  lastCall.set(key, now);
  if (lastCall.size > 500) lastCall.clear();
  return false;
}

function notConfigured() {
  return json(
    { error: 'Billing is not configured on this deployment.', configured: false },
    503
  );
}

/** Load the persisted account behind a session token. */
async function loadAccount(request) {
  const session = await getUser(request);
  if (!session) return { error: json({ error: 'Not authenticated' }, 401) };

  const core = await getCore();
  const account = core.users.find((u) => u.id === session.id);
  if (!account) return { error: json({ error: 'Account not found' }, 401) };

  return { core, account };
}

/**
 * Find or create this user's Stripe customer.
 *
 * The link is one-directional and stored on our side: we create the customer
 * with the user id in metadata and remember the id. We never look a customer up
 * by email, because two people can claim the same address in different systems
 * and email is not an authentication factor.
 */
async function ensureCustomer(core, account) {
  const existing = billingOf(account).customerId;
  if (existing) {
    try {
      const customer = await stripe().customers.retrieve(existing);
      if (!customer.deleted) return existing;
    } catch (err) {
      if (err?.statusCode !== 404) throw err;
    }
  }

  const customer = await stripe().customers.create(
    {
      email: account.email,
      name: account.name || undefined,
      metadata: { userId: account.id, app: 'codelii-review' },
    },
    { idempotencyKey: `customer:${account.id}` }
  );

  account.billing = { ...billingOf(account), customerId: customer.id };
  await saveCore(core);
  return customer.id;
}

export async function GET(request) {
  if (!isStripeConfigured()) {
    const loaded = await loadAccount(request);
    if (loaded.error) return loaded.error;
    // With billing switched off nobody is blocked — useful for self-hosting.
    return json({ configured: false, billing: { ...publicBilling(loaded.account), entitled: true } });
  }

  const { core, account, error } = await loadAccount(request);
  if (error) return error;

  const sessionId = new URL(request.url).searchParams.get('session_id');
  let changed = false;

  if (sessionId) {
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      return json({ error: 'Invalid session id' }, 400);
    }
    try {
      const session = await stripe().checkout.sessions.retrieve(sessionId, {
        expand: ['subscription.items'],
      });
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;

      // Bind the session to the caller. A stolen or guessed id is useless
      // unless it was created for this exact account.
      const ours =
        session.client_reference_id === account.id
        || session.metadata?.userId === account.id
        || (customerId && customerId === billingOf(account).customerId);
      if (!ours) return json({ error: 'This checkout session is not yours' }, 403);

      if (session.subscription && typeof session.subscription === 'object') {
        changed = applySubscription(account, session.subscription);
      } else {
        changed = await syncFromStripe(account);
      }
    } catch (err) {
      console.error('[billing GET session]', err.message);
      // Fall through: the webhook is the authority and may already have landed.
      changed = await syncFromStripe(account).catch(() => false);
    }
  }

  if (changed) await saveCore(core);

  return json({
    configured: true,
    testMode: isTestMode(),
    billing: publicBilling(account),
  });
}

export async function POST(request) {
  if (!isStripeConfigured()) return notConfigured();

  const { core, account, error } = await loadAccount(request);
  if (error) return error;

  if (account.guest === true) {
    return json(
      { error: 'Guests who joined through a share link cannot subscribe. Sign up for an account first.' },
      403
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine for sync */
  }
  const action = body.action || 'sync';

  try {
    if (action === 'sync') {
      if (throttled(`sync:${account.id}`, 2000)) {
        return json({ configured: true, billing: publicBilling(account) });
      }
      const changed = await syncFromStripe(account);
      if (changed) await saveCore(core);
      return json({ configured: true, billing: publicBilling(account) });
    }

    if (action === 'checkout') {
      if (throttled(`checkout:${account.id}`, 3000)) {
        return json({ error: 'Please wait a moment and try again.' }, 429);
      }

      // Already paying? Send them to manage, never to a second subscription.
      await syncFromStripe(account).catch(() => false);
      if (canCreateProjects(account)) {
        await saveCore(core);
        return json({ alreadyActive: true, billing: publicBilling(account) });
      }

      const customerId = await ensureCustomer(core, account);
      const withTrial = trialAvailable(account);
      const site = siteUrl();

      const session = await stripe().checkout.sessions.create(
        {
          mode: 'subscription',
          customer: customerId,
          client_reference_id: account.id,
          line_items: [{ price: priceId(), quantity: 1 }],
          subscription_data: {
            // One trial per account, ever. `trialUsed` is sticky server-side.
            ...(withTrial ? { trial_period_days: TRIAL_DAYS } : {}),
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
            metadata: { userId: account.id },
          },
          // Card up front, so the trial converts to a charge on day 7 by itself.
          payment_method_collection: 'always',
          billing_address_collection: 'auto',
          allow_promotion_codes: true,
          customer_update: { name: 'auto', address: 'auto' },
          metadata: { userId: account.id },
          success_url: `${site}/dashboard.html?billing=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${site}/dashboard.html?billing=cancelled`,
        },
        // Collapses double-clicks into one session without pinning a user to a
        // stale URL forever.
        { idempotencyKey: `checkout:${account.id}:${Math.floor(Date.now() / 60000)}` }
      );

      return json({ url: session.url, trial: withTrial, trialDays: TRIAL_DAYS });
    }

    if (action === 'portal') {
      if (throttled(`portal:${account.id}`, 2000)) {
        return json({ error: 'Please wait a moment and try again.' }, 429);
      }
      const customerId = billingOf(account).customerId;
      if (!customerId) return json({ error: 'You do not have a subscription yet.' }, 400);

      try {
        const portal = await stripe().billingPortal.sessions.create({
          customer: customerId,
          return_url: `${siteUrl()}/dashboard.html?billing=return`,
        });
        return json({ url: portal.url });
      } catch (err) {
        if (/no configuration/i.test(err?.message || '')) {
          return json(
            {
              error:
                'The Stripe customer portal has not been set up yet. Enable it at '
                + 'https://dashboard.stripe.com/settings/billing/portal',
            },
            503
          );
        }
        throw err;
      }
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('[billing POST]', action, err);
    // Stripe error messages are safe to show; anything else stays generic.
    const message = err?.type?.startsWith('Stripe') ? err.message : 'Billing request failed';
    return json({ error: message }, 500);
  }
}
