/**
 * Integrations hub — Slack + project-management providers.
 */
import { getCore, saveCore } from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import {
  isSlackOAuthConfigured,
  publicSlackStatus,
  postSlack,
  createSlackOAuthState,
  buildSlackAuthorizeUrl,
} from './lib/slack.js';
import {
  listPmProviders,
  publicPmStatus,
  clearPmConnection,
  isPmConfigured,
  createPmOAuthState,
  createPkcePair,
  buildPmAuthorizeUrl,
  PM_PROVIDERS,
} from './lib/pm.js';

export async function OPTIONS() {
  return corsOptions('GET, POST, DELETE, OPTIONS');
}

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const core = await getCore();
  const account = core.users.find((u) => u.id === user.id);
  if (!account) return json({ error: 'Account not found' }, 401);
  if (account.guest) return json({ error: 'Guests cannot manage integrations' }, 403);

  const pm = {};
  for (const p of listPmProviders()) {
    pm[p.id] = publicPmStatus(account, p.id);
  }

  return json({
    integrations: {
      slack: {
        available: isSlackOAuthConfigured(),
        ...publicSlackStatus(account),
        category: 'notify',
        name: 'Slack',
        blurb: 'Get review comments, assignments, and page approvals in a Slack channel.',
      },
      ...pm,
      github: {
        id: 'github',
        name: 'GitHub Issues',
        blurb: 'Comment → GitHub issue is available from the review toolbar when a repo is linked.',
        category: 'pm',
        available: true,
        connected: false,
        comingSoon: false,
        note: 'Uses GITHUB_TOKEN on the server — create issues from any comment in review mode.',
      },
    },
  });
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => ({}));
  const action = body.action || 'test';
  const provider = (body.provider || 'slack').toLowerCase();

  const core = await getCore();
  const account = core.users.find((u) => u.id === user.id);
  if (!account) return json({ error: 'Account not found' }, 401);
  if (account.guest) return json({ error: 'Guests cannot manage integrations' }, 403);

  if (provider === 'slack' && action === 'connect') {
    if (!isSlackOAuthConfigured()) {
      return json({ error: 'Slack OAuth is not configured on this server' }, 503);
    }
    const state = await createSlackOAuthState(account.id);
    return json({ url: buildSlackAuthorizeUrl(state) });
  }

  if (provider === 'slack' && action === 'test') {
    if (!account.slack?.webhookUrl) {
      return json({ error: 'Connect Slack first' }, 400);
    }
    const ok = await postSlack(account.slack.webhookUrl, {
      text: 'Codelii Review is connected',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Codelii Review is connected*\nYou'll get notifications here for comments, assignments, and page approvals on your projects.\n_Sent as a test by ${account.name || account.email}_`,
          },
        },
      ],
    });
    if (!ok) return json({ error: 'Slack rejected the test message. Try reconnecting.' }, 502);
    return json({ ok: true });
  }

  // PM connect
  if (action === 'connect' && PM_PROVIDERS[provider]) {
    const meta = PM_PROVIDERS[provider];
    if (meta.comingSoon) return json({ error: `${meta.name} is coming soon` }, 503);
    if (!isPmConfigured(provider)) {
      return json({ error: `${meta.name} OAuth is not configured on this server` }, 503);
    }
    const pkce = provider === 'monday' ? createPkcePair() : null;
    const state = await createPmOAuthState(
      account.id,
      provider,
      pkce ? { codeVerifier: pkce.codeVerifier } : {}
    );
    return json({
      url: buildPmAuthorizeUrl(
        provider,
        state,
        pkce ? { codeChallenge: pkce.codeChallenge } : {}
      ),
    });
  }

  return json({ error: 'Unknown action' }, 400);
}

export async function DELETE(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const provider = (url.searchParams.get('provider') || 'slack').toLowerCase();

  const core = await getCore();
  const account = core.users.find((u) => u.id === user.id);
  if (!account) return json({ error: 'Account not found' }, 401);
  if (account.guest) return json({ error: 'Guests cannot manage integrations' }, 403);

  if (provider === 'slack') {
    delete account.slack;
    await saveCore(core);
    return json({ ok: true, slack: { connected: false } });
  }

  if (PM_PROVIDERS[provider]) {
    clearPmConnection(account, provider);
    await saveCore(core);
    return json({ ok: true, [provider]: { connected: false } });
  }

  return json({ error: 'Unknown provider' }, 400);
}
