/**
 * Stripe client + configuration.
 *
 * The secret key never leaves the server. Nothing in this file is importable
 * from the browser bundle — every caller is an /api route.
 */
import Stripe from 'stripe';

// Pinned so a Stripe-side upgrade can never silently reshape the objects the
// webhook and entitlement code read.
export const STRIPE_API_VERSION = '2026-06-24.dahlia';

export const TRIAL_DAYS = 7;

let client = null;

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

export function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Billing is not configured (STRIPE_SECRET_KEY missing)');
  if (!key.startsWith('sk_') && !key.startsWith('rk_')) {
    throw new Error('STRIPE_SECRET_KEY looks wrong — it must be a secret or restricted key');
  }
  if (!client) {
    client = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      appInfo: { name: 'Codelii Review', version: '1.0.0' },
      maxNetworkRetries: 2,
      timeout: 20000,
    });
  }
  return client;
}

/**
 * The one price customers can ever be put on. Read from the environment, never
 * from the request body — a client-supplied price is a client-supplied amount.
 */
export function priceId() {
  const id = (process.env.STRIPE_PRICE_ID || '').trim();
  if (!id.startsWith('price_')) {
    throw new Error('Billing is not configured (STRIPE_PRICE_ID missing or invalid)');
  }
  return id;
}

export function siteUrl() {
  const raw = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('SITE_URL must be set to build Stripe redirect URLs');
  return raw;
}

/** True when the configured key is a test-mode key. Surfaced in the UI banner. */
export function isTestMode() {
  return (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')
    || (process.env.STRIPE_SECRET_KEY || '').startsWith('rk_test_');
}
