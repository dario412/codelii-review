# Codelii Review

Multi-project visual site review: paste a live URL or public GitHub repo, invite collaborators, pin comments on the page.

## Local development

```bash
npm install
npm run dev
```

App runs at **http://localhost:3010** (override with `PORT=…`).

## Env vars

Copy `.env.example` to `.env.local` (and set the same on Vercel):

- `JWT_SECRET` — required
- `BLOB_READ_WRITE_TOKEN` — required on Vercel (Blob store)
- `SITE_URL` — public app URL
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL` — invite + @mention emails
- `GOOGLE_CLIENT_ID` — optional Google Sign-In
- `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` — billing (see below)

## Flow

1. Landing → sign up / sign in
2. Dashboard → **My projects** / **Invited**
3. New project → live URL (proxied at `/p/:id/…`) or GitHub repo (snapshot at `/s/:id/…`)
4. Invite by email or shareable link (`/join.html?token=…`)
5. In review: **Cursor prompt** (copy) or **Fix with Cursor** (starts a Cursor SDK cloud/local agent)

## Billing

**$49/month with a 7-day free trial, charged on the same date every month.**

Only creating your *own* project is paid. Everyone you invite — by email or share
link — reviews and comments for free and is never asked for a card. The paywall
lives on `POST /api/projects` and nowhere else, so an expired subscription blocks
new projects but leaves existing ones fully usable.

### Setup

1. Put your keys in `.env.local`:
   ```
   STRIPE_SECRET_KEY=sk_test_…
   ```
2. Create the product, price and portal config:
   ```bash
   npm run stripe:setup
   ```
   Copy the printed `STRIPE_PRICE_ID` into `.env.local` and Vercel. Re-running is safe.
3. Add the webhook:
   - **Production** — the setup script creates it automatically once `SITE_URL` is a
     public `https://` URL. Otherwise add `SITE_URL/api/stripe-webhook` at
     [dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks).
   - **Local** — `stripe listen --forward-to localhost:3010/api/stripe-webhook`
   
   Either way, put the `whsec_…` in `STRIPE_WEBHOOK_SECRET`.
4. Going live: swap in `sk_live_…`, re-run `npm run stripe:setup` to create the live
   product and price, and add a live-mode webhook with its own signing secret.

Leaving `STRIPE_SECRET_KEY` or `STRIPE_PRICE_ID` empty disables billing entirely and
everyone can create projects — useful for self-hosting.

### How it holds up

- The secret key is server-only; the browser never sees a key, a price or an amount.
  A checkout is *requested* by the client and *described* entirely by the server.
- `POST /api/stripe-webhook` verifies every request's signature against the raw body
  and refuses outright when no signing secret is configured. Event ids are remembered,
  so retries and replays are no-ops, and events older than the state we hold are dropped.
- Entitlement is re-checked server-side on every project create, and re-read from
  Stripe before anyone is turned away, so a lagging webhook never blocks a paying user.
- One trial per account, tracked server-side — cancelling and resubscribing does not
  hand out a second free week.
- Stripe customers are matched to accounts by stored id and metadata, never by email.

## Cursor SDK (Fix with Cursor)

1. Create an API key at [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations)
2. Add to `.env.local` / Vercel: `CURSOR_API_KEY=…`
3. For a project, set **GitHub repo URL** in Settings (auto for GitHub projects), or a **local folder path** for local agents
4. In the review sidebar, click **Fix** / **Fix with Cursor**

Cloud agents clone the repo and can open a PR. Watch them in Cursor → Filter → Source → SDK.
