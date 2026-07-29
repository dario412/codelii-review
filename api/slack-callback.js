/**
 * Slack OAuth callback — exchange code, store webhook on the user, redirect back.
 */
import { getCore, saveCore } from './lib/store.js';
import { corsOptions } from './lib/http.js';
import {
  isSlackOAuthConfigured,
  verifySlackOAuthState,
  exchangeSlackCode,
} from './lib/slack.js';

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
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!isSlackOAuthConfigured()) {
    return redirect('/integrations.html?slack=not_configured');
  }

  if (error) {
    return redirect(`/integrations.html?slack=denied&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return redirect('/integrations.html?slack=error');
  }

  const userId = await verifySlackOAuthState(state);
  if (!userId) {
    return redirect('/integrations.html?slack=invalid_state');
  }

  try {
    const installed = await exchangeSlackCode(code);
    const core = await getCore();
    const account = core.users.find((u) => u.id === userId);
    if (!account || account.guest) {
      return redirect('/integrations.html?slack=forbidden');
    }

    account.slack = {
      webhookUrl: installed.webhookUrl,
      channel: installed.channel,
      channelId: installed.channelId,
      configurationUrl: installed.configurationUrl,
      teamName: installed.teamName,
      teamId: installed.teamId,
      accessToken: installed.accessToken || null,
      botUserId: installed.botUserId || null,
      connectedAt: new Date().toISOString(),
    };
    await saveCore(core);

    return redirect('/integrations.html?slack=connected');
  } catch (err) {
    console.error('[slack-callback]', err);
    return redirect(`/integrations.html?slack=error&reason=${encodeURIComponent(err.message || 'failed')}`);
  }
}
