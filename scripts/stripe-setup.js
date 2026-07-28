/**
 * One-time Stripe bootstrap: creates the product, the $49/month price, and
 * (when SITE_URL is public) the webhook endpoint.
 *
 * Safe to re-run — everything is looked up before it is created.
 *
 *   npm run stripe:setup
 *
 * Prints the environment variables to copy into .env.local and Vercel.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const PRICE_LOOKUP_KEY = 'codelii_review_monthly_49';
const UNIT_AMOUNT = 4900; // $49.00, in cents
const CURRENCY = 'usd';
const TRIAL_DAYS = 7;

const WEBHOOK_EVENTS = [
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
];

function loadEnvFile(filename) {
  const path = join(ROOT, filename);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set. Add it to .env.local first.');
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: '2026-06-24.dahlia' });
const live = key.startsWith('sk_live_') || key.startsWith('rk_live_');

async function ensureProduct() {
  const search = await stripe.products.search({
    query: `metadata['app']:'codelii-review' AND active:'true'`,
    limit: 1,
  });
  if (search.data[0]) return search.data[0];

  return stripe.products.create({
    name: 'Codelii Review',
    description:
      'Collect visual feedback on live sites and turn it into Cursor fixes. Unlimited projects and collaborators.',
    metadata: { app: 'codelii-review' },
  });
}

async function ensurePrice(product) {
  const existing = await stripe.prices.list({
    lookup_keys: [PRICE_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  const found = existing.data[0];
  if (found) {
    if (found.unit_amount !== UNIT_AMOUNT || found.currency !== CURRENCY) {
      console.warn(
        `Existing price ${found.id} is ${found.unit_amount / 100} ${found.currency.toUpperCase()}, `
        + `not ${UNIT_AMOUNT / 100} ${CURRENCY.toUpperCase()}. Prices are immutable — `
        + 'archive it in the dashboard and re-run to change the amount.'
      );
    }
    return found;
  }

  return stripe.prices.create({
    product: product.id,
    unit_amount: UNIT_AMOUNT,
    currency: CURRENCY,
    // Monthly on the same calendar date as the subscription start, which is
    // when the trial ends.
    recurring: { interval: 'month', interval_count: 1 },
    lookup_key: PRICE_LOOKUP_KEY,
    nickname: 'Codelii Review — $49/month',
    metadata: { app: 'codelii-review', trial_days: String(TRIAL_DAYS) },
  });
}

async function ensureWebhook() {
  const site = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (!site.startsWith('https://')) {
    return { skipped: 'SITE_URL is not a public https URL' };
  }
  const url = `${site}/api/stripe-webhook`;

  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const found = list.data.find((w) => w.url === url);
  if (found) {
    const missing = WEBHOOK_EVENTS.filter((e) => !found.enabled_events.includes(e));
    if (missing.length) {
      await stripe.webhookEndpoints.update(found.id, { enabled_events: WEBHOOK_EVENTS });
    }
    // The signing secret is only returned at creation time.
    return { endpoint: found, secretAvailable: false };
  }

  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: 'Codelii Review subscription state',
  });
  return { endpoint: created, secretAvailable: true };
}

async function ensurePortal(product, price) {
  const list = await stripe.billingPortal.configurations.list({ limit: 10 });
  const existing = list.data.find((c) => c.metadata?.app === 'codelii-review');
  if (existing) return existing;

  return stripe.billingPortal.configurations.create({
    business_profile: { headline: 'Codelii Review — manage your subscription' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name', 'tax_id'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        cancellation_reason: {
          enabled: true,
          options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'],
        },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['promotion_code'],
        products: [{ product: product.id, prices: [price.id] }],
      },
    },
    metadata: { app: 'codelii-review' },
  });
}

async function main() {
  console.log(`\nStripe setup — ${live ? 'LIVE' : 'TEST'} mode\n`);

  const product = await ensureProduct();
  console.log(`  product  ${product.id}  ${product.name}`);

  const price = await ensurePrice(product);
  console.log(
    `  price    ${price.id}  ${(price.unit_amount / 100).toFixed(2)} `
    + `${price.currency.toUpperCase()}/${price.recurring.interval}`
  );

  let portalNote = '';
  try {
    const portal = await ensurePortal(product, price);
    console.log(`  portal   ${portal.id}`);
  } catch (err) {
    portalNote = `  portal   skipped — ${err.message}`;
    console.log(portalNote);
  }

  const webhook = await ensureWebhook();
  if (webhook.skipped) {
    console.log(`  webhook  skipped — ${webhook.skipped}`);
  } else {
    console.log(`  webhook  ${webhook.endpoint.id}  ${webhook.endpoint.url}`);
  }

  console.log('\nAdd to .env.local and to Vercel → Settings → Environment Variables:\n');
  console.log(`  STRIPE_SECRET_KEY=${key.slice(0, 12)}…   (already set)`);
  console.log(`  STRIPE_PRICE_ID=${price.id}`);
  if (webhook.endpoint?.secret) {
    console.log(`  STRIPE_WEBHOOK_SECRET=${webhook.endpoint.secret}`);
  } else if (webhook.endpoint) {
    console.log(
      '  STRIPE_WEBHOOK_SECRET=  → reveal it at '
      + `https://dashboard.stripe.com/${live ? '' : 'test/'}webhooks/${webhook.endpoint.id}`
    );
  } else {
    console.log('  STRIPE_WEBHOOK_SECRET=  → for local dev run: stripe listen --forward-to localhost:3010/api/stripe-webhook');
  }
  console.log('');
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
