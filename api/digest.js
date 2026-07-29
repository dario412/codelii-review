/**
 * Cron + manual trigger for email digests.
 * Vercel Cron: GET /api/digest daily (handles daily + Monday weekly).
 */
import { getCore, saveCore } from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import { runEmailDigests } from './lib/digest.js';

export async function OPTIONS() {
  return corsOptions('GET, POST, OPTIONS');
}

function isCronAuthorized(request) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret) {
    const auth = request.headers.get('authorization') || '';
    if (auth === `Bearer ${secret}`) return true;
  }
  if (request.headers.get('x-vercel-cron') === '1') return true;
  if (!process.env.VERCEL) return true;
  return false;
}

/** Cron runner */
export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const core = await getCore();
  const results = await runEmailDigests(core);
  await saveCore(core);
  return json({ ok: true, results });
}

/** Manual “Send digest now” from Integrations (logged-in user). */
export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  if (!(process.env.RESEND_API_KEY || '').trim()) {
    return json({ error: 'Email is not configured (RESEND_API_KEY)' }, 503);
  }

  const core = await getCore();
  const account = core.users.find((u) => u.id === user.id);
  if (!account || account.guest) return json({ error: 'Forbidden' }, 403);

  const results = await runEmailDigests(core, { forceUserId: account.id });
  await saveCore(core);
  const mine = results[0];
  if (mine?.error) return json({ error: mine.error }, 502);
  if (mine?.skipped === 'empty') {
    return json({ ok: true, empty: true, message: 'No open comments to summarize.' });
  }
  return json({ ok: true, total: mine?.total || 0 });
}
