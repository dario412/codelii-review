/**
 * Slack Incoming Webhook helpers + OAuth install (one-click Connect).
 * Resolution order: project override → client → project owner's account Slack.
 */
import { SignJWT, jwtVerify } from 'jose';

const SLACK_HOOK_RE = /^https:\/\/hooks\.slack\.com\/services\//i;
const OAUTH_STATE_TTL = '10m';
const SLACK_AUTHORIZE = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN = 'https://slack.com/api/oauth.v2.access';
const SCOPES = 'incoming-webhook';

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    if (process.env.VERCEL) throw new Error('JWT_SECRET must be set');
    return new TextEncoder().encode('dev-only-secret-change-me!!');
  }
  return new TextEncoder().encode(s);
}

export function isSlackOAuthConfigured() {
  return Boolean(
    (process.env.SLACK_CLIENT_ID || '').trim()
    && (process.env.SLACK_CLIENT_SECRET || '').trim()
  );
}

export function slackRedirectUri() {
  const explicit = (process.env.SLACK_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const site = (process.env.SITE_URL || '').replace(/\/+$/, '')
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (!site) return 'http://localhost:3010/api/slack-callback';
  return `${site}/api/slack-callback`;
}

export function isValidSlackWebhook(url) {
  const u = String(url || '').trim();
  return SLACK_HOOK_RE.test(u);
}

export function normalizeSlackWebhook(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  if (!isValidSlackWebhook(u)) {
    throw new Error('Slack webhook must be a hooks.slack.com incoming webhook URL');
  }
  return u;
}

export async function createSlackOAuthState(userId) {
  return new SignJWT({ purpose: 'slack_oauth', uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(OAUTH_STATE_TTL)
    .sign(jwtSecret());
}

export async function verifySlackOAuthState(state) {
  if (!state) return null;
  try {
    const { payload } = await jwtVerify(state, jwtSecret());
    if (payload.purpose !== 'slack_oauth' || !payload.uid) return null;
    return String(payload.uid);
  } catch {
    return null;
  }
}

export function buildSlackAuthorizeUrl(state) {
  const clientId = (process.env.SLACK_CLIENT_ID || '').trim();
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: slackRedirectUri(),
    state,
  });
  return `${SLACK_AUTHORIZE}?${params.toString()}`;
}

export async function exchangeSlackCode(code) {
  const clientId = (process.env.SLACK_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SLACK_CLIENT_SECRET || '').trim();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: slackRedirectUri(),
  });

  const res = await fetch(SLACK_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(data.error || 'Slack OAuth failed');
  }
  const hook = data.incoming_webhook;
  if (!hook?.url) {
    throw new Error('Slack did not return an incoming webhook. Ensure the app requests the incoming-webhook scope.');
  }
  return {
    webhookUrl: hook.url,
    channel: hook.channel || null,
    channelId: hook.channel_id || null,
    configurationUrl: hook.configuration_url || null,
    teamName: data.team?.name || null,
    teamId: data.team?.id || null,
    accessToken: data.access_token || null,
    botUserId: data.bot_user_id || null,
  };
}

/**
 * Resolve which webhook to use for a project.
 * project override → client → project owner's connected Slack.
 */
export function resolveSlackWebhook(core, project) {
  if (!project) return null;
  if (project.slackWebhookUrl) return project.slackWebhookUrl;
  if (project.clientId) {
    const client = (core.clients || []).find((c) => c.id === project.clientId);
    if (client?.slackWebhookUrl) return client.slackWebhookUrl;
  }
  const owner = (core.users || []).find((u) => u.id === project.ownerId);
  if (owner?.slack?.webhookUrl) return owner.slack.webhookUrl;
  return null;
}

export function publicSlackStatus(user) {
  const s = user?.slack;
  if (!s?.webhookUrl) {
    return { connected: false };
  }
  return {
    connected: true,
    channel: s.channel || null,
    teamName: s.teamName || null,
    connectedAt: s.connectedAt || null,
  };
}

function siteBase() {
  return (process.env.SITE_URL || '').replace(/\/+$/, '')
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
}

export function projectReviewUrl(project, page = '') {
  const site = siteBase();
  const prefix = project.type === 'github' ? `/s/${project.id}` : `/p/${project.id}`;
  const pagePath = String(page || '').replace(/^\//, '');
  const path = `${prefix}/${pagePath}`;
  return site ? `${site}${path}` : path;
}

export async function postSlack(webhookUrl, { text, blocks } = {}) {
  if (!webhookUrl) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text || 'Codelii Review update',
        ...(blocks ? { blocks } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[slack]', res.status, body.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[slack]', err.message);
    return false;
  }
}

/**
 * Notify Slack about a review event. Safe to call without awaiting.
 */
export function notifySlack(core, project, {
  title,
  body,
  page,
  actorName,
  commentId,
} = {}) {
  const webhook = resolveSlackWebhook(core, project);
  if (!webhook) return;

  const url = projectReviewUrl(project, page);
  const deep = commentId ? `${url}${url.includes('?') ? '&' : '?'}comment=${commentId}` : url;
  const lines = [
    `*${title || 'Update'}* · ${project.name}`,
    body ? `>${String(body).replace(/\n/g, ' ').slice(0, 280)}` : null,
    actorName ? `_by ${actorName}_` : null,
    `<${deep}|Open in Codelii>`,
  ].filter(Boolean);

  postSlack(webhook, {
    text: `${title || 'Update'} on ${project.name}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') },
      },
    ],
  }).catch(() => {});
}
