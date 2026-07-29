/**
 * Integrations hub — Slack / Teams / Discord / email digests + PM providers.
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
  normalizeTeamsWebhook,
  publicTeamsStatus,
  postTeams,
  postTeamsGraph,
  isTeamsOAuthConfigured,
  createTeamsOAuthState,
  buildTeamsAuthorizeUrl,
  ensureTeamsAccessToken,
  listTeamsDestinations,
} from './lib/teams.js';
import {
  normalizeDiscordWebhook,
  publicDiscordStatus,
  postDiscord,
} from './lib/discord.js';
import {
  DIGEST_FREQUENCIES,
  publicDigestStatus,
} from './lib/digest.js';
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

  const digest = publicDigestStatus(account);

  return json({
    integrations: {
      slack: {
        available: isSlackOAuthConfigured(),
        ...publicSlackStatus(account),
        category: 'notify',
        name: 'Slack',
        blurb: 'Get review comments, assignments, and page approvals in a Slack channel.',
      },
      teams: {
        available: true,
        oauth: isTeamsOAuthConfigured(),
        ...publicTeamsStatus(account),
        category: 'notify',
        name: 'Microsoft Teams',
        blurb: 'One-click Microsoft sign-in, then pick a Team channel for review updates.',
      },
      discord: {
        available: true,
        ...publicDiscordStatus(account),
        category: 'notify',
        name: 'Discord',
        blurb: 'Dev-friendly channel alerts for comments, assignments, and approvals.',
      },
      digest: {
        ...digest,
        category: 'notify',
        name: 'Email digest',
        blurb: 'Daily or weekly summary of open comments across your projects.',
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

  if (provider === 'teams' && action === 'connect') {
    // OAuth (preferred) — same pattern as Slack
    if (!body.webhookUrl && isTeamsOAuthConfigured()) {
      const state = await createTeamsOAuthState(account.id);
      return json({ url: buildTeamsAuthorizeUrl(state) });
    }
    // Webhook fallback
    let webhookUrl;
    try {
      webhookUrl = normalizeTeamsWebhook(body.webhookUrl);
    } catch (err) {
      return json({ error: err.message }, 400);
    }
    if (!webhookUrl) {
      if (!isTeamsOAuthConfigured()) {
        return json({
          error: 'Add TEAMS_CLIENT_ID and TEAMS_CLIENT_SECRET for one-click connect, or paste a webhook URL.',
        }, 400);
      }
      return json({ error: 'Webhook URL required' }, 400);
    }
    account.teams = {
      ...(account.teams || {}),
      webhookUrl,
      label: (body.label || '').trim().slice(0, 80) || null,
      teamId: null,
      channelId: null,
      connectedAt: new Date().toISOString(),
    };
    await saveCore(core);
    return json({ ok: true, teams: publicTeamsStatus(account) });
  }

  if (provider === 'teams' && action === 'list_channels') {
    if (!account.teams?.accessToken && !account.teams?.refreshToken) {
      return json({ error: 'Connect Microsoft first' }, 400);
    }
    try {
      const token = await ensureTeamsAccessToken(account);
      await saveCore(core);
      const teams = await listTeamsDestinations(token);
      return json({ teams });
    } catch (err) {
      return json({ error: err.message || 'Could not list Teams channels' }, 502);
    }
  }

  if (provider === 'teams' && action === 'select_channel') {
    const teamId = String(body.teamId || '').trim();
    const channelId = String(body.channelId || '').trim();
    const teamName = String(body.teamName || '').trim().slice(0, 120) || null;
    const channelName = String(body.channelName || '').trim().slice(0, 120) || null;
    if (!teamId || !channelId) {
      return json({ error: 'teamId and channelId required' }, 400);
    }
    if (!account.teams?.accessToken && !account.teams?.refreshToken) {
      return json({ error: 'Connect Microsoft first' }, 400);
    }
    account.teams = {
      ...account.teams,
      teamId,
      teamName,
      channelId,
      channelName,
      webhookUrl: null,
      connectedAt: new Date().toISOString(),
    };
    await saveCore(core);
    return json({ ok: true, teams: publicTeamsStatus(account) });
  }

  if (provider === 'teams' && action === 'test') {
    const status = publicTeamsStatus(account);
    if (!status.connected) {
      return json({ error: status.pendingChannel ? 'Pick a Teams channel first' : 'Connect Teams first' }, 400);
    }
    const payload = {
      title: 'Codelii Review is connected',
      body: `You'll get notifications here for comments, assignments, and page approvals. Sent as a test by ${account.name || account.email}`,
      projectName: 'Integrations',
      link: `${(process.env.SITE_URL || '').replace(/\/+$/, '')}/integrations.html`,
    };
    let ok = false;
    if (account.teams?.teamId && account.teams?.channelId) {
      ok = await postTeamsGraph(account, payload);
      await saveCore(core);
    } else if (account.teams?.webhookUrl) {
      ok = await postTeams(account.teams.webhookUrl, payload);
    }
    if (!ok) return json({ error: 'Teams rejected the test message. Try reconnecting.' }, 502);
    return json({ ok: true });
  }

  if (provider === 'discord' && action === 'connect') {
    let webhookUrl;
    try {
      webhookUrl = normalizeDiscordWebhook(body.webhookUrl);
    } catch (err) {
      return json({ error: err.message }, 400);
    }
    if (!webhookUrl) return json({ error: 'Webhook URL required' }, 400);
    account.discord = {
      webhookUrl,
      label: (body.label || '').trim().slice(0, 80) || null,
      connectedAt: new Date().toISOString(),
    };
    await saveCore(core);
    return json({ ok: true, discord: publicDiscordStatus(account) });
  }

  if (provider === 'discord' && action === 'test') {
    if (!account.discord?.webhookUrl) return json({ error: 'Connect Discord first' }, 400);
    const ok = await postDiscord(account.discord.webhookUrl, {
      title: 'Codelii Review is connected',
      body: `You'll get notifications here for comments, assignments, and page approvals. Sent as a test by ${account.name || account.email}`,
      projectName: 'Integrations',
      link: (process.env.SITE_URL || '').replace(/\/+$/, '') + '/integrations.html',
    });
    if (!ok) return json({ error: 'Discord rejected the test message. Check the webhook URL.' }, 502);
    return json({ ok: true });
  }

  if (provider === 'digest' && action === 'save') {
    const frequency = String(body.frequency || 'off').toLowerCase();
    if (!DIGEST_FREQUENCIES.includes(frequency)) {
      return json({ error: 'frequency must be off, daily, or weekly' }, 400);
    }
    if (frequency !== 'off' && !(process.env.RESEND_API_KEY || '').trim()) {
      return json({ error: 'Email is not configured (RESEND_API_KEY)' }, 503);
    }
    account.emailDigest = {
      ...(account.emailDigest || {}),
      frequency,
    };
    await saveCore(core);
    return json({ ok: true, digest: publicDigestStatus(account) });
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

  if (provider === 'teams') {
    delete account.teams;
    await saveCore(core);
    return json({ ok: true, teams: { connected: false } });
  }

  if (provider === 'discord') {
    delete account.discord;
    await saveCore(core);
    return json({ ok: true, discord: { connected: false } });
  }

  if (provider === 'digest') {
    account.emailDigest = { ...(account.emailDigest || {}), frequency: 'off' };
    await saveCore(core);
    return json({ ok: true, digest: publicDigestStatus(account) });
  }

  if (PM_PROVIDERS[provider]) {
    clearPmConnection(account, provider);
    await saveCore(core);
    return json({ ok: true, [provider]: { connected: false } });
  }

  return json({ error: 'Unknown provider' }, 400);
}
