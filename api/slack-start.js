/**
 * Start Slack OAuth — redirects the browser to Slack's authorize screen.
 */
import { getCore } from './lib/store.js';
import { getUser } from './lib/auth.js';
import { corsOptions } from './lib/http.js';
import {
  isSlackOAuthConfigured,
  createSlackOAuthState,
  buildSlackAuthorizeUrl,
} from './lib/slack.js';

export async function OPTIONS() {
  return corsOptions('GET, OPTIONS');
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
    },
  });
}

function siteBase() {
  return (process.env.SITE_URL || '').replace(/\/+$/, '')
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    || 'http://localhost:3010';
}

export async function GET(request) {
  const site = siteBase();

  if (!isSlackOAuthConfigured()) {
    return redirect(`${site}/integrations.html?slack=not_configured`);
  }

  const user = await getUser(request);
  if (!user) {
    return redirect(`${site}/login.html?redirect=${encodeURIComponent('/integrations.html')}`);
  }

  const core = await getCore();
  const account = core.users.find((u) => u.id === user.id);
  if (!account || account.guest) {
    return redirect(`${site}/integrations.html?slack=forbidden`);
  }

  try {
    const state = await createSlackOAuthState(user.id);
    return redirect(buildSlackAuthorizeUrl(state));
  } catch (err) {
    console.error('[slack-start]', err);
    return redirect(`${site}/integrations.html?slack=error`);
  }
}
