/**
 * Microsoft Teams notifications — OAuth (Graph) + optional incoming webhook fallback.
 * Resolution: project override webhook → client webhook → owner OAuth/Graph or webhook.
 */
import { SignJWT, jwtVerify } from 'jose';

const TEAMS_HOST_RE =
  /(^|\.)webhook\.office\.com$|(^|\.)office\.com$|(^|\.)logic\.azure\.com$|(^|\.)powerplatform\.com$|(^|\.)powerautomate\.com$/i;

const OAUTH_STATE_TTL = '15m';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const SCOPES = [
  'offline_access',
  'User.Read',
  'Team.ReadBasic.All',
  'Channel.ReadBasic.All',
  'ChannelMessage.Send',
].join(' ');

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    if (process.env.VERCEL) throw new Error('JWT_SECRET must be set');
    return new TextEncoder().encode('dev-only-secret-change-me!!');
  }
  return new TextEncoder().encode(s);
}

export function isTeamsOAuthConfigured() {
  return Boolean(
    (process.env.TEAMS_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || '').trim()
    && (process.env.TEAMS_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || '').trim()
  );
}

function teamsClientId() {
  return (process.env.TEAMS_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || '').trim();
}

function teamsClientSecret() {
  return (process.env.TEAMS_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || '').trim();
}

export function teamsRedirectUri() {
  const explicit = (process.env.TEAMS_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const site = (process.env.SITE_URL || '').replace(/\/+$/, '')
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (!site) return 'http://localhost:3010/api/teams-callback';
  return `${site}/api/teams-callback`;
}

export async function createTeamsOAuthState(userId) {
  return new SignJWT({ purpose: 'teams_oauth', uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(OAUTH_STATE_TTL)
    .sign(jwtSecret());
}

export async function verifyTeamsOAuthState(state) {
  if (!state) return null;
  try {
    const { payload } = await jwtVerify(state, jwtSecret());
    if (payload.purpose !== 'teams_oauth' || !payload.uid) return null;
    return String(payload.uid);
  } catch {
    return null;
  }
}

export function buildTeamsAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: teamsClientId(),
    response_type: 'code',
    redirect_uri: teamsRedirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    state,
    prompt: 'select_account',
  });
  return `${AUTH}/authorize?${params}`;
}

export async function exchangeTeamsCode(code) {
  const body = new URLSearchParams({
    client_id: teamsClientId(),
    client_secret: teamsClientSecret(),
    code,
    redirect_uri: teamsRedirectUri(),
    grant_type: 'authorization_code',
    scope: SCOPES,
  });
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Microsoft token exchange failed');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in || 3600,
    scope: data.scope || null,
  };
}

async function refreshTeamsToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: teamsClientId(),
    client_secret: teamsClientSecret(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPES,
  });
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Microsoft token refresh failed');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in || 3600,
  };
}

/** Ensure account.teams has a valid access token; may mutate account. */
export async function ensureTeamsAccessToken(account) {
  const t = account?.teams;
  if (!t?.accessToken && !t?.refreshToken) return null;
  const expiresAt = t.expiresAt ? Date.parse(t.expiresAt) : 0;
  if (t.accessToken && expiresAt && expiresAt > Date.now() + 60_000) {
    return t.accessToken;
  }
  if (!t.refreshToken) return t.accessToken || null;
  const next = await refreshTeamsToken(t.refreshToken);
  t.accessToken = next.accessToken;
  t.refreshToken = next.refreshToken;
  t.expiresAt = new Date(Date.now() + next.expiresIn * 1000).toISOString();
  return t.accessToken;
}

async function graphGet(accessToken, path) {
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Graph ${res.status}`);
  }
  return data;
}

export async function listTeamsDestinations(accessToken) {
  const teamsData = await graphGet(accessToken, '/me/joinedTeams?$select=id,displayName');
  const teams = teamsData.value || [];
  const out = [];
  for (const team of teams.slice(0, 40)) {
    try {
      const ch = await graphGet(
        accessToken,
        `/teams/${encodeURIComponent(team.id)}/channels?$select=id,displayName,membershipType`
      );
      const channels = (ch.value || [])
        .filter((c) => c.membershipType === 'standard' || !c.membershipType)
        .map((c) => ({ id: c.id, name: c.displayName }));
      if (channels.length) {
        out.push({ id: team.id, name: team.displayName, channels });
      }
    } catch (err) {
      console.error('[teams] channels', team.id, err.message);
    }
  }
  return out;
}

export function isValidTeamsWebhook(url) {
  const u = String(url || '').trim();
  if (!/^https:\/\//i.test(u)) return false;
  try {
    const host = new URL(u).hostname;
    return TEAMS_HOST_RE.test(host);
  } catch {
    return false;
  }
}

export function normalizeTeamsWebhook(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  if (!isValidTeamsWebhook(u)) {
    throw new Error(
      'Teams webhook must be an Outlook/Office, Power Automate, or logic.azure.com HTTPS URL'
    );
  }
  return u;
}

export function resolveTeamsConnection(core, project) {
  if (!project) return null;
  if (project.teamsWebhookUrl) {
    return { mode: 'webhook', webhookUrl: project.teamsWebhookUrl };
  }
  if (project.clientId) {
    const client = (core.clients || []).find((c) => c.id === project.clientId);
    if (client?.teamsWebhookUrl) {
      return { mode: 'webhook', webhookUrl: client.teamsWebhookUrl };
    }
  }
  const owner = (core.users || []).find((u) => u.id === project.ownerId);
  if (!owner?.teams) return null;
  if (owner.teams.teamId && owner.teams.channelId && (owner.teams.accessToken || owner.teams.refreshToken)) {
    return { mode: 'oauth', account: owner };
  }
  if (owner.teams.webhookUrl) {
    return { mode: 'webhook', webhookUrl: owner.teams.webhookUrl };
  }
  return null;
}

/** @deprecated use resolveTeamsConnection — kept for older imports */
export function resolveTeamsWebhook(core, project) {
  const c = resolveTeamsConnection(core, project);
  return c?.mode === 'webhook' ? c.webhookUrl : null;
}

export function publicTeamsStatus(user) {
  const t = user?.teams;
  const oauthReady = Boolean(t?.teamId && t?.channelId && (t.accessToken || t.refreshToken));
  const webhookReady = Boolean(t?.webhookUrl);
  const pendingChannel = Boolean(
    (t?.accessToken || t?.refreshToken) && !oauthReady && !webhookReady
  );
  if (!oauthReady && !webhookReady && !pendingChannel) {
    return { connected: false, pendingChannel: false };
  }
  const label = oauthReady
    ? [t.teamName, t.channelName ? `#${t.channelName}` : null].filter(Boolean).join(' · ')
    : (t.label || null);
  return {
    connected: oauthReady || webhookReady,
    pendingChannel,
    mode: oauthReady ? 'oauth' : webhookReady ? 'webhook' : 'pending',
    label,
    teamName: t.teamName || null,
    channelName: t.channelName || null,
    connectedAt: t.connectedAt || null,
  };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function postTeamsWebhook(webhookUrl, { title, body, link, actorName, projectName } = {}) {
  if (!webhookUrl) return false;
  const headline = title || 'Codelii Review update';
  const textLines = [
    `**${headline}** · ${projectName || 'Project'}`,
    body ? String(body).replace(/\n/g, ' ').slice(0, 280) : null,
    actorName ? `_by ${actorName}_` : null,
    link || null,
  ].filter(Boolean);

  const payload = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: `${headline} on ${projectName || 'project'}`,
    themeColor: '002B2B',
    title: headline,
    text: textLines.join('\n\n'),
    potentialAction: link
      ? [
          {
            '@type': 'OpenUri',
            name: 'Open in Codelii',
            targets: [{ os: 'default', uri: link }],
          },
        ]
      : undefined,
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('[teams]', res.status, errBody.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[teams]', err.message);
    return false;
  }
}

/** Alias used by integrations test */
export const postTeams = postTeamsWebhook;

export async function postTeamsGraph(account, { title, body, link, actorName, projectName } = {}) {
  const token = await ensureTeamsAccessToken(account);
  if (!token || !account.teams?.teamId || !account.teams?.channelId) return false;

  const headline = title || 'Codelii Review update';
  const parts = [
    `<b>${escapeHtml(headline)}</b> · ${escapeHtml(projectName || 'Project')}`,
    body ? escapeHtml(String(body).replace(/\n/g, ' ').slice(0, 280)) : null,
    actorName ? `<i>by ${escapeHtml(actorName)}</i>` : null,
    link ? `<a href="${escapeHtml(link)}">Open in Codelii</a>` : null,
  ].filter(Boolean);

  const res = await fetch(
    `${GRAPH}/teams/${encodeURIComponent(account.teams.teamId)}/channels/${encodeURIComponent(account.teams.channelId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: {
          contentType: 'html',
          content: parts.join('<br/>'),
        },
      }),
    }
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('[teams-graph]', res.status, errBody.slice(0, 300));
    return false;
  }
  return true;
}

/**
 * Notify Teams for a project (Graph OAuth or webhook). Mutates owner tokens if refreshed.
 * Caller should saveCore if account tokens may have changed.
 */
export async function notifyTeamsConnection(core, project, payload) {
  const conn = resolveTeamsConnection(core, project);
  if (!conn) return { ok: false, saved: false };
  if (conn.mode === 'webhook') {
    const ok = await postTeamsWebhook(conn.webhookUrl, payload);
    return { ok, saved: false };
  }
  const ok = await postTeamsGraph(conn.account, payload);
  return { ok, saved: true };
}
