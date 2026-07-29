/**
 * Start PM OAuth — returns authorize URL (JSON) so Bearer auth works from the browser.
 * Also supports GET redirect for cookie sessions: /api/pm-start?provider=linear
 */
import { getCore } from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import {
  PM_PROVIDERS,
  isPmConfigured,
  createPmOAuthState,
  createPkcePair,
  buildPmAuthorizeUrl,
} from './lib/pm.js';

export async function OPTIONS() {
  return corsOptions('GET, POST, OPTIONS');
}

function siteBase() {
  return (process.env.SITE_URL || '').replace(/\/+$/, '')
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    || 'http://localhost:3010';
}

async function startForUser(user, providerId) {
  const meta = PM_PROVIDERS[providerId];
  if (!meta) throw Object.assign(new Error('Unknown provider'), { status: 400 });
  if (meta.comingSoon) throw Object.assign(new Error(`${meta.name} is coming soon`), { status: 503 });
  if (!isPmConfigured(providerId)) {
    throw Object.assign(new Error(`${meta.name} OAuth is not configured on this server`), { status: 503 });
  }

  const core = await getCore();
  const account = core.users.find((u) => u.id === user.id);
  if (!account || account.guest) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }

  const pkce = providerId === 'monday' ? createPkcePair() : null;
  const state = await createPmOAuthState(
    user.id,
    providerId,
    pkce ? { codeVerifier: pkce.codeVerifier } : {}
  );
  return buildPmAuthorizeUrl(
    providerId,
    state,
    pkce ? { codeChallenge: pkce.codeChallenge } : {}
  );
}

export async function GET(request) {
  const url = new URL(request.url);
  const provider = (url.searchParams.get('provider') || '').toLowerCase();
  const site = siteBase();
  const user = await getUser(request);
  if (!user) {
    return Response.redirect(
      `${site}/login.html?redirect=${encodeURIComponent('/integrations.html')}`,
      302
    );
  }
  try {
    const authorizeUrl = await startForUser(user, provider);
    return Response.redirect(authorizeUrl, 302);
  } catch (err) {
    const reason = encodeURIComponent(err.message || 'error');
    return Response.redirect(`${site}/integrations.html?pm=error&reason=${reason}`, 302);
  }
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);
  const body = await request.json().catch(() => ({}));
  const provider = (body.provider || '').toLowerCase();
  try {
    const authorizeUrl = await startForUser(user, provider);
    return json({ url: authorizeUrl });
  } catch (err) {
    return json({ error: err.message || 'Could not start OAuth' }, err.status || 500);
  }
}
