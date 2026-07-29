/**
 * Microsoft Teams OAuth callback — store tokens, then pick a channel in Integrations.
 */
import { getCore, saveCore } from './lib/store.js';
import { corsOptions } from './lib/http.js';
import {
  isTeamsOAuthConfigured,
  verifyTeamsOAuthState,
  exchangeTeamsCode,
} from './lib/teams.js';

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
    headers: {
      Location: `${siteBase()}${path}`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!isTeamsOAuthConfigured()) {
    return redirect('/integrations.html?teams=not_configured');
  }

  if (error) {
    return redirect(
      `/integrations.html?teams=denied&reason=${encodeURIComponent(errorDesc || error)}`
    );
  }

  if (!code || !state) {
    return redirect('/integrations.html?teams=error');
  }

  const userId = await verifyTeamsOAuthState(state);
  if (!userId) {
    return redirect('/integrations.html?teams=invalid_state');
  }

  try {
    const tokens = await exchangeTeamsCode(code);
    const core = await getCore();
    const account = core.users.find((u) => u.id === userId);
    if (!account || account.guest) {
      return redirect('/integrations.html?teams=forbidden');
    }

    account.teams = {
      ...(account.teams || {}),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      // Clear previous destination until user picks again
      teamId: null,
      teamName: null,
      channelId: null,
      channelName: null,
      webhookUrl: account.teams?.webhookUrl || null,
      connectedAt: new Date().toISOString(),
    };
    await saveCore(core);

    return redirect('/integrations.html?teams=pick');
  } catch (err) {
    console.error('[teams-callback]', err);
    return redirect(
      `/integrations.html?teams=error&reason=${encodeURIComponent(err.message || 'failed')}`
    );
  }
}
