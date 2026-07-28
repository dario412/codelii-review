/**
 * Subscription entitlement.
 *
 * Who pays: only people who create their own projects. Invited collaborators
 * and share-link guests keep a free account forever — the gate lives on
 * project creation and nowhere else.
 *
 * The billing state on a user record is a cache of Stripe's truth, written by
 * the webhook and by explicit post-checkout syncs. Nothing the browser sends
 * can change it, so the worst a hostile client can do is ask us to re-read
 * Stripe and get told "no".
 */
import { stripe, TRIAL_DAYS } from './stripe.js';

/** Statuses that may create projects. Everything else is blocked. */
const ENTITLED = new Set(['trialing', 'active']);

export const EMPTY_BILLING = {
  customerId: null,
  subscriptionId: null,
  status: 'none',
  priceId: null,
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialUsed: false,
  updatedAt: null,
  // Stripe event timestamp the cache was built from, so an out-of-order
  // webhook can never overwrite newer state with older state.
  syncedAt: 0,
};

export function billingOf(user) {
  return { ...EMPTY_BILLING, ...(user?.billing || {}) };
}

/** Server-side answer to "may this user create a project?" */
export function canCreateProjects(user) {
  if (!user) return false;
  // Share-link guests never have their own workspace; they can't buy one either.
  if (user.guest === true) return false;
  return ENTITLED.has(billingOf(user).status);
}

/** A short, honest sentence for the UI when creation is blocked. */
export function blockedReason(user) {
  const { status } = billingOf(user);
  if (user?.guest === true) {
    return 'Guests who joined through a share link cannot create projects. Sign up for an account first.';
  }
  switch (status) {
    case 'past_due':
    case 'unpaid':
      return 'Your last payment failed. Update your payment method to keep creating projects.';
    case 'canceled':
    case 'incomplete_expired':
      return 'Your subscription has ended. Resubscribe to create new projects.';
    case 'paused':
      return 'Your subscription is paused. Resume it to create new projects.';
    case 'incomplete':
      return 'Your payment is still being confirmed. Refresh in a moment.';
    default:
      return `Start your ${TRIAL_DAYS}-day free trial to create your first project.`;
  }
}

/**
 * Whether this user still has their one free trial. Checked server-side before
 * every checkout so cancelling and resubscribing can't farm endless trials.
 */
export function trialAvailable(user) {
  return billingOf(user).trialUsed !== true;
}

function toIso(seconds) {
  return typeof seconds === 'number' && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;
}

/**
 * The renewal date. As of API version 2025-03-31 the period lives on the
 * subscription item, not the subscription, so read both.
 */
function periodEnd(subscription) {
  const item = subscription?.items?.data?.[0];
  return toIso(item?.current_period_end ?? subscription?.current_period_end);
}

function subscriptionPriceId(subscription) {
  return subscription?.items?.data?.[0]?.price?.id || null;
}

/**
 * Fold a Stripe subscription into the user's cached billing state.
 *
 * `eventTs` is the Stripe event's `created` timestamp (seconds). Writes from an
 * older event than the one already applied are dropped, which is what keeps
 * webhook retries and out-of-order delivery from resurrecting stale state.
 *
 * Returns true when the user record actually changed.
 */
export function applySubscription(user, subscription, eventTs = Math.floor(Date.now() / 1000)) {
  const current = billingOf(user);
  if (eventTs < current.syncedAt) return false;

  // Once a subscription belongs to a different customer than the one we linked,
  // something is wrong upstream — refuse rather than silently re-point the user.
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (current.customerId && customerId && current.customerId !== customerId) {
    throw new Error(
      `Subscription ${subscription.id} belongs to ${customerId}, not ${current.customerId}`
    );
  }

  const status = subscription.status || 'none';
  const next = {
    ...current,
    customerId: customerId || current.customerId,
    subscriptionId: subscription.id,
    status,
    priceId: subscriptionPriceId(subscription) || current.priceId,
    trialEnd: toIso(subscription.trial_end),
    currentPeriodEnd: periodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    // Sticky: entering a trial burns the free trial permanently.
    trialUsed: current.trialUsed || Boolean(subscription.trial_end) || status === 'trialing',
    updatedAt: new Date().toISOString(),
    syncedAt: eventTs,
  };

  const changed = JSON.stringify({ ...current, updatedAt: null })
    !== JSON.stringify({ ...next, updatedAt: null });
  user.billing = next;
  return changed;
}

/** Mark a subscription gone without needing the full object. */
export function applyCanceled(user, subscriptionId, eventTs = Math.floor(Date.now() / 1000)) {
  const current = billingOf(user);
  if (eventTs < current.syncedAt) return false;
  if (current.subscriptionId && current.subscriptionId !== subscriptionId) return false;

  user.billing = {
    ...current,
    status: 'canceled',
    subscriptionId,
    cancelAtPeriodEnd: false,
    updatedAt: new Date().toISOString(),
    syncedAt: eventTs,
  };
  return true;
}

/**
 * Re-read the user's subscription straight from Stripe and refresh the cache.
 * Used right after checkout so the dashboard is correct even if the webhook is
 * still in flight, and as a self-heal whenever the cache looks stale.
 */
export async function syncFromStripe(user) {
  const { customerId } = billingOf(user);
  if (!customerId) return false;

  const subs = await stripe().subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });

  // Prefer a live subscription; fall back to the most recent one so a cancelled
  // account still reports "canceled" rather than drifting back to "none".
  const live = subs.data.find((s) => ENTITLED.has(s.status) || s.status === 'past_due');
  const chosen = live || subs.data[0];
  if (!chosen) return false;

  return applySubscription(user, chosen);
}

/** What the browser is allowed to know about a user's billing state. */
export function publicBilling(user) {
  const b = billingOf(user);
  return {
    status: b.status,
    entitled: canCreateProjects(user),
    trialAvailable: trialAvailable(user),
    trialDays: TRIAL_DAYS,
    trialEnd: b.trialEnd,
    renewsAt: b.currentPeriodEnd,
    cancelAtPeriodEnd: b.cancelAtPeriodEnd,
    hasCustomer: Boolean(b.customerId),
    reason: canCreateProjects(user) ? null : blockedReason(user),
  };
}
