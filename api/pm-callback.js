/**
 * Shared OAuth callback for all PM providers.
 * Redirect URI: SITE_URL/api/pm-callback
 */
import { getCore, saveCore } from './lib/store.js';
import { corsOptions } from './lib/http.js';
import {
  verifyPmOAuthState,
  exchangePmCode,
  storePmConnection,
  PM_PROVIDERS,
} from './lib/pm.js';

export async function OPTIONS() {
  return corsOptions('GET, OPTIONS');
}

function siteBase() {
  return (process.env.SITE_URL || '').replace(/\/+$/, '')
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    || 'http://localhost:3010';
}

function redirect(path) {
  return new Response(null, {
    status: 302,
    headers: { Location: `${siteBase()}${path}`, 'Cache-Control': 'no-store' },
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (error) {
    return redirect(`/integrations.html?pm=denied&reason=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return redirect('/integrations.html?pm=error');
  }

  const parsed = await verifyPmOAuthState(state);
  if (!parsed) return redirect('/integrations.html?pm=invalid_state');

  const { userId, provider, codeVerifier } = parsed;
  const meta = PM_PROVIDERS[provider];
  if (!meta || meta.comingSoon) {
    return redirect('/integrations.html?pm=error');
  }

  try {
    const connection = await exchangePmCode(provider, code, { codeVerifier });
    const core = await getCore();
    const account = core.users.find((u) => u.id === userId);
    if (!account || account.guest) return redirect('/integrations.html?pm=forbidden');

    storePmConnection(account, provider, connection);
    await saveCore(core);

    return redirect(`/integrations.html?pm=connected&provider=${encodeURIComponent(provider)}`);
  } catch (err) {
    console.error('[pm-callback]', provider, err);
    return redirect(
      `/integrations.html?pm=error&reason=${encodeURIComponent(err.message || 'failed')}`
    );
  }
}
