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

## Flow

1. Landing → sign up / sign in
2. Dashboard → **My projects** / **Invited**
3. New project → live URL (proxied at `/p/:id/…`) or GitHub repo (snapshot at `/s/:id/…`)
4. Invite by email or shareable link (`/join.html?token=…`)
5. In review: **Cursor prompt** (copy) or **Fix with Cursor** (starts a Cursor SDK cloud/local agent)

## Cursor SDK (Fix with Cursor)

1. Create an API key at [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations)
2. Add to `.env.local` / Vercel: `CURSOR_API_KEY=…`
3. For a project, set **GitHub repo URL** in Settings (auto for GitHub projects), or a **local folder path** for local agents
4. In the review sidebar, click **Fix** / **Fix with Cursor**

Cloud agents clone the repo and can open a PR. Watch them in Cursor → Filter → Source → SDK.
