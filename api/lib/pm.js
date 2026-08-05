/**
 * Project-management integrations — Comment → task.
 * Live: Linear, Asana, ClickUp, Jira, Monday, Notion.
 */
import { createHash, randomBytes } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';

const OAUTH_STATE_TTL = '15m';
const NOTION_VERSION = '2022-06-28';
const MONDAY_API_VERSION = '2024-10';

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    if (process.env.VERCEL) throw new Error('JWT_SECRET must be set');
    return new TextEncoder().encode('dev-only-secret-change-me!!');
  }
  return new TextEncoder().encode(s);
}

function siteBase() {
  return (process.env.SITE_URL || '').replace(/\/+$/, '')
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    || 'http://localhost:3010';
}

export function pmCallbackUri() {
  const explicit = (process.env.PM_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  return `${siteBase()}/api/pm-callback`;
}

/** Catalog shown on Integrations + used for gating Create task. */
export const PM_PROVIDERS = {
  asana: {
    id: 'asana',
    name: 'Asana',
    category: 'pm',
    blurb: 'Send review comments into Asana as tasks — keep delivery where your team already plans work.',
    color: '#F06A6A',
    comingSoon: false,
    envId: 'ASANA_CLIENT_ID',
    envSecret: 'ASANA_CLIENT_SECRET',
  },
  clickup: {
    id: 'clickup',
    name: 'ClickUp',
    category: 'pm',
    blurb: 'Drop comments into a ClickUp list as tasks your team already works from.',
    color: '#7B68EE',
    comingSoon: false,
    envId: 'CLICKUP_CLIENT_ID',
    envSecret: 'CLICKUP_CLIENT_SECRET',
  },
  linear: {
    id: 'linear',
    name: 'Linear',
    category: 'pm',
    blurb: 'Turn review comments into Linear issues your eng team can pick up immediately.',
    color: '#5E6AD2',
    comingSoon: false,
    envId: 'LINEAR_CLIENT_ID',
    envSecret: 'LINEAR_CLIENT_SECRET',
  },
  monday: {
    id: 'monday',
    name: 'Monday.com',
    category: 'pm',
    blurb: 'Push feedback onto Monday boards as clear, actionable items.',
    color: '#FF3D57',
    comingSoon: false,
    envId: 'MONDAY_CLIENT_ID',
    envSecret: 'MONDAY_CLIENT_SECRET',
  },
  jira: {
    id: 'jira',
    name: 'Jira',
    category: 'pm',
    blurb: 'Open Jira issues from review pins for teams that live in Atlassian.',
    color: '#2684FF',
    comingSoon: false,
    envId: 'JIRA_CLIENT_ID',
    envSecret: 'JIRA_CLIENT_SECRET',
  },
  notion: {
    id: 'notion',
    name: 'Notion',
    category: 'pm',
    blurb: 'Add review comments as Notion database tasks or pages — with context attached.',
    color: '#FFFFFF',
    comingSoon: false,
    envId: 'NOTION_CLIENT_ID',
    envSecret: 'NOTION_CLIENT_SECRET',
  },
};

export function listPmProviders() {
  return Object.values(PM_PROVIDERS);
}

export function isPmConfigured(providerId) {
  const p = PM_PROVIDERS[providerId];
  if (!p || p.comingSoon) return false;
  return Boolean(
    (process.env[p.envId] || '').trim()
    && (process.env[p.envSecret] || '').trim()
  );
}

export function getPmConnection(account, providerId) {
  return account?.pm?.[providerId] || null;
}

export function publicPmStatus(account, providerId) {
  const meta = PM_PROVIDERS[providerId];
  if (!meta) return null;
  if (meta.comingSoon) {
    return {
      id: providerId,
      name: meta.name,
      blurb: meta.blurb,
      color: meta.color,
      category: 'pm',
      comingSoon: true,
      available: false,
      connected: false,
    };
  }
  const conn = getPmConnection(account, providerId);
  const available = isPmConfigured(providerId);
  return {
    id: providerId,
    name: meta.name,
    blurb: meta.blurb,
    color: meta.color,
    category: 'pm',
    comingSoon: false,
    available,
    connected: Boolean(conn?.accessToken),
    destination: conn?.destinationLabel || null,
    connectedAt: conn?.connectedAt || null,
  };
}

export function connectedPmProviders(account) {
  return listPmProviders()
    .filter((p) => !p.comingSoon && getPmConnection(account, p.id)?.accessToken)
    .map((p) => ({
      id: p.id,
      name: p.name,
      destination: getPmConnection(account, p.id)?.destinationLabel || null,
    }));
}

export async function createPmOAuthState(userId, providerId, extra = {}) {
  const payload = {
    purpose: 'pm_oauth',
    uid: userId,
    provider: providerId,
  };
  if (extra.codeVerifier) payload.cv = String(extra.codeVerifier);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(OAUTH_STATE_TTL)
    .sign(jwtSecret());
}

export async function verifyPmOAuthState(state) {
  if (!state) return null;
  try {
    const { payload } = await jwtVerify(state, jwtSecret());
    if (payload.purpose !== 'pm_oauth' || !payload.uid || !payload.provider) return null;
    return {
      userId: String(payload.uid),
      provider: String(payload.provider),
      codeVerifier: payload.cv ? String(payload.cv) : null,
    };
  } catch {
    return null;
  }
}

/** PKCE pair for Monday OAuth 2.1 (S256). */
export function createPkcePair() {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function buildPmAuthorizeUrl(providerId, state, opts = {}) {
  const redirectUri = pmCallbackUri();
  if (providerId === 'linear') {
    const clientId = (process.env.LINEAR_CLIENT_ID || '').trim();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'read,write,issues:create',
      state,
      prompt: 'consent',
    });
    return `https://linear.app/oauth/authorize?${params}`;
  }
  if (providerId === 'asana') {
    const clientId = (process.env.ASANA_CLIENT_ID || '').trim();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return `https://app.asana.com/-/oauth_authorize?${params}`;
  }
  if (providerId === 'clickup') {
    const clientId = (process.env.CLICKUP_CLIENT_ID || '').trim();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    });
    return `https://app.clickup.com/api?${params}`;
  }
  if (providerId === 'monday') {
    const clientId = (process.env.MONDAY_CLIENT_ID || '').trim();
    if (!opts.codeChallenge) {
      throw new Error('Monday OAuth requires PKCE code_challenge');
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
      // Must match scopes enabled on the Monday app (OAuth & Permissions).
      scope: 'boards:read boards:write me:read',
      code_challenge: opts.codeChallenge,
      code_challenge_method: 'S256',
      // If the app isn't installed on the account yet, send the user to install first.
      force_install_if_needed: 'true',
    });
    return `https://auth.monday.com/oauth2/authorize?${params}`;
  }
  if (providerId === 'jira') {
    const clientId = (process.env.JIRA_CLIENT_ID || '').trim();
    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: clientId,
      scope: 'read:jira-work write:jira-work read:jira-user offline_access',
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
    });
    return `https://auth.atlassian.com/authorize?${params}`;
  }
  if (providerId === 'notion') {
    const clientId = (process.env.NOTION_CLIENT_ID || '').trim();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      owner: 'user',
      state,
    });
    return `https://api.notion.com/v1/oauth/authorize?${params}`;
  }
  throw new Error(`OAuth not available for ${providerId}`);
}

async function formPost(url, fields) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || data.message || `Token exchange failed (${res.status})`);
  }
  return data;
}

export async function exchangePmCode(providerId, code, opts = {}) {
  const redirectUri = pmCallbackUri();
  if (providerId === 'linear') {
    const data = await formPost('https://api.linear.app/oauth/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: (process.env.LINEAR_CLIENT_ID || '').trim(),
      client_secret: (process.env.LINEAR_CLIENT_SECRET || '').trim(),
    });
    if (!data.access_token) throw new Error('Linear did not return an access token');
    const dest = await resolveLinearDestination(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
      ...dest,
    };
  }
  if (providerId === 'asana') {
    const data = await formPost('https://app.asana.com/-/oauth_token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: (process.env.ASANA_CLIENT_ID || '').trim(),
      client_secret: (process.env.ASANA_CLIENT_SECRET || '').trim(),
    });
    if (!data.access_token) throw new Error('Asana did not return an access token');
    const dest = await resolveAsanaDestination(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
      ...dest,
    };
  }
  if (providerId === 'clickup') {
    const clientId = (process.env.CLICKUP_CLIENT_ID || '').trim();
    const clientSecret = (process.env.CLICKUP_CLIENT_SECRET || '').trim();
    const url = `https://api.clickup.com/api/v2/oauth/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&code=${encodeURIComponent(code)}`;
    const res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(data.error || data.err || 'ClickUp did not return an access token');
    }
    const dest = await resolveClickUpDestination(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: null,
      expiresIn: null,
      ...dest,
    };
  }
  if (providerId === 'monday') {
    if (!opts.codeVerifier) {
      throw new Error('Monday OAuth requires PKCE code_verifier — reconnect from Integrations');
    }
    const res = await fetch('https://auth.monday.com/oauth_ms/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: (process.env.MONDAY_CLIENT_ID || '').trim(),
        client_secret: (process.env.MONDAY_CLIENT_SECRET || '').trim(),
        code_verifier: opts.codeVerifier,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(
        data.error_description || data.error || data.message || `Monday token exchange failed (${res.status})`
      );
    }
    const dest = await resolveMondayDestination(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
      ...dest,
    };
  }
  if (providerId === 'jira') {
    const data = await formPost('https://auth.atlassian.com/oauth/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: (process.env.JIRA_CLIENT_ID || '').trim(),
      client_secret: (process.env.JIRA_CLIENT_SECRET || '').trim(),
    });
    if (!data.access_token) throw new Error('Jira did not return an access token');
    const dest = await resolveJiraDestination(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
      ...dest,
    };
  }
  if (providerId === 'notion') {
    const clientId = (process.env.NOTION_CLIENT_ID || '').trim();
    const clientSecret = (process.env.NOTION_CLIENT_SECRET || '').trim();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(data.message || data.error || 'Notion did not return an access token');
    }
    const dest = await resolveNotionDestination(data.access_token, data);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
      ...dest,
    };
  }
  throw new Error(`OAuth not available for ${providerId}`);
}

async function resolveLinearDestination(accessToken) {
  const data = await linearGraph(accessToken, `{
    viewer { name }
    teams { nodes { id name } }
  }`);
  const team = data?.teams?.nodes?.[0];
  if (!team) throw new Error('No Linear teams found on this account');
  return {
    teamId: team.id,
    teamName: team.name,
    destinationLabel: team.name,
    workspaceName: data?.viewer?.name || null,
  };
}

async function resolveAsanaDestination(accessToken) {
  const wsRes = await fetch('https://app.asana.com/api/1.0/workspaces?limit=10', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const wsData = await wsRes.json().catch(() => ({}));
  if (!wsRes.ok) throw new Error(wsData?.errors?.[0]?.message || 'Could not list Asana workspaces');
  const workspace = wsData.data?.[0];
  if (!workspace) throw new Error('No Asana workspaces found');

  // Prefer first project in the workspace when available; otherwise My Tasks (workspace only).
  const pRes = await fetch(
    `https://app.asana.com/api/1.0/projects?workspace=${encodeURIComponent(workspace.gid)}&archived=false&limit=20`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }
  );
  const pData = await pRes.json().catch(() => ({}));
  const project = pRes.ok ? pData.data?.[0] : null;

  return {
    workspaceGid: workspace.gid,
    workspaceName: workspace.name,
    projectGid: project?.gid || null,
    projectName: project?.name || null,
    destinationLabel: project
      ? `${workspace.name} · ${project.name}`
      : `${workspace.name} · My Tasks`,
  };
}

async function resolveClickUpDestination(accessToken) {
  const headers = {
    Authorization: accessToken.startsWith('pk_') ? accessToken : `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  const tRes = await fetch('https://api.clickup.com/api/v2/team', { headers });
  const tData = await tRes.json().catch(() => ({}));
  if (!tRes.ok) throw new Error(tData?.err || 'Could not list ClickUp workspaces');
  const team = tData.teams?.[0];
  if (!team) throw new Error('No ClickUp workspaces authorized');

  const sRes = await fetch(`https://api.clickup.com/api/v2/team/${team.id}/space?archived=false`, { headers });
  const sData = await sRes.json().catch(() => ({}));
  const space = sData.spaces?.[0];
  if (!space) throw new Error('No ClickUp spaces found — create a space first');

  // Prefer a folder list; fall back to folderless lists.
  let list = null;
  let listLabel = null;
  const fRes = await fetch(`https://api.clickup.com/api/v2/space/${space.id}/folder?archived=false`, { headers });
  const fData = await fRes.json().catch(() => ({}));
  for (const folder of fData.folders || []) {
    if (folder.lists?.[0]) {
      list = folder.lists[0];
      listLabel = `${space.name} · ${folder.name} · ${list.name}`;
      break;
    }
  }
  if (!list) {
    const lRes = await fetch(`https://api.clickup.com/api/v2/space/${space.id}/list?archived=false`, { headers });
    const lData = await lRes.json().catch(() => ({}));
    list = lData.lists?.[0];
    if (list) listLabel = `${space.name} · ${list.name}`;
  }
  if (!list) throw new Error('No ClickUp lists found — create a list to receive tasks');

  return {
    teamId: String(team.id),
    teamName: team.name,
    spaceId: String(space.id),
    spaceName: space.name,
    listId: String(list.id),
    listName: list.name,
    destinationLabel: listLabel,
  };
}

async function mondayGraph(accessToken, query, variables) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      Authorization: accessToken,
      'Content-Type': 'application/json',
      'API-Version': MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors?.length) {
    throw new Error(data.errors?.[0]?.message || `Monday GraphQL error (${res.status})`);
  }
  return data.data;
}

async function resolveMondayDestination(accessToken) {
  const data = await mondayGraph(accessToken, `{
    me { name }
    boards(limit: 10, order_by: used_at) { id name }
  }`);
  const board = data?.boards?.[0];
  if (!board) throw new Error('No Monday.com boards found — create a board first');
  return {
    boardId: String(board.id),
    boardName: board.name,
    workspaceName: data?.me?.name || null,
    destinationLabel: board.name,
  };
}

async function resolveJiraDestination(accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
  const rRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', { headers });
  const resources = await rRes.json().catch(() => []);
  if (!rRes.ok || !Array.isArray(resources) || !resources.length) {
    throw new Error('No Atlassian sites accessible — grant Jira access during connect');
  }
  const site = resources.find((r) => (r.scopes || []).some((s) => String(s).includes('jira'))) || resources[0];
  const cloudId = site.id;
  const siteName = site.name || site.url || 'Jira';

  const pRes = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search?maxResults=20&orderBy=name`,
    { headers }
  );
  const pData = await pRes.json().catch(() => ({}));
  if (!pRes.ok) throw new Error(pData?.errorMessages?.[0] || 'Could not list Jira projects');
  const project = pData.values?.[0] || (Array.isArray(pData) ? pData[0] : null);
  if (!project) throw new Error('No Jira projects found on this site');

  const itRes = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issuetype/project?projectId=${encodeURIComponent(project.id)}`,
    { headers }
  );
  const issueTypes = await itRes.json().catch(() => []);
  const issueType = Array.isArray(issueTypes)
    ? (issueTypes.find((t) => !t.subtask && /task/i.test(t.name || ''))
      || issueTypes.find((t) => !t.subtask)
      || issueTypes[0])
    : null;
  if (!issueType?.id) throw new Error('No creatable Jira issue type found on this project');

  return {
    cloudId,
    siteName,
    siteUrl: site.url || null,
    projectId: String(project.id),
    projectKey: project.key,
    projectName: project.name,
    issueTypeId: String(issueType.id),
    issueTypeName: issueType.name,
    destinationLabel: `${siteName} · ${project.key}`,
  };
}

function notionHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function notionTitleProp(properties) {
  if (!properties || typeof properties !== 'object') return 'Name';
  const entry = Object.entries(properties).find(([, v]) => v?.type === 'title');
  return entry?.[0] || 'Name';
}

async function resolveNotionDestination(accessToken, oauthMeta = {}) {
  const headers = notionHeaders(accessToken);
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filter: { value: 'database', property: 'object' },
      page_size: 20,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Could not search Notion databases');
  const db = (data.results || []).find((r) => r.object === 'database');
  if (!db) {
    throw new Error(
      'No Notion databases shared with Codelii — open Notion, share a database with the integration, then reconnect'
    );
  }
  const title = Array.isArray(db.title)
    ? db.title.map((t) => t.plain_text || '').join('').trim()
    : 'Database';
  const titleProp = notionTitleProp(db.properties);
  return {
    databaseId: db.id,
    databaseName: title || 'Database',
    titleProperty: titleProp,
    workspaceName: oauthMeta.workspace_name || oauthMeta.workspace_id || null,
    destinationLabel: title || 'Notion database',
  };
}

async function linearGraph(accessToken, query, variables) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors?.length) {
    throw new Error(data.errors?.[0]?.message || `Linear GraphQL error (${res.status})`);
  }
  return data.data;
}

function taskPayload({ title, description, deepLink, projectName, page, authorName }) {
  const lines = [
    description || '',
    '',
    '---',
    `**Project:** ${projectName || 'Codelii Review'}`,
    page ? `**Page:** \`${page}\`` : null,
    authorName ? `**Author:** ${authorName}` : null,
    deepLink ? `**Open in Codelii:** ${deepLink}` : null,
    '',
    '_Created from Codelii Review_',
  ].filter((l) => l !== null);
  return {
    title: String(title || 'Review feedback').replace(/\s+/g, ' ').trim().slice(0, 200),
    body: lines.join('\n').trim(),
  };
}

/**
 * Create a task/issue in the connected PM tool.
 * @returns {{ id, url, title, provider }}
 */
export async function createPmTask(account, providerId, input) {
  const conn = getPmConnection(account, providerId);
  if (!conn?.accessToken) throw new Error(`Connect ${PM_PROVIDERS[providerId]?.name || providerId} first`);

  const { title, body } = taskPayload(input);

  if (providerId === 'linear') {
    const data = await linearGraph(
      conn.accessToken,
      `mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title url }
        }
      }`,
      {
        input: {
          teamId: conn.teamId,
          title,
          description: body,
        },
      }
    );
    const issue = data?.issueCreate?.issue;
    if (!data?.issueCreate?.success || !issue) throw new Error('Linear did not create the issue');
    return {
      provider: 'linear',
      id: issue.id,
      key: issue.identifier,
      title: issue.title,
      url: issue.url,
    };
  }

  if (providerId === 'asana') {
    const payload = {
      data: {
        name: title,
        notes: body,
        workspace: conn.workspaceGid,
        ...(conn.projectGid ? { projects: [conn.projectGid] } : {}),
      },
    };
    const res = await fetch('https://app.asana.com/api/1.0/tasks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.errors?.[0]?.message || 'Asana task create failed');
    const task = data.data;
    return {
      provider: 'asana',
      id: task.gid,
      key: null,
      title: task.name,
      url: task.permalink_url || `https://app.asana.com/0/0/${task.gid}`,
    };
  }

  if (providerId === 'clickup') {
    if (!conn.listId) throw new Error('ClickUp list not configured — reconnect ClickUp');
    const headers = {
      Authorization: conn.accessToken.startsWith('pk_') ? conn.accessToken : `Bearer ${conn.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const res = await fetch(`https://api.clickup.com/api/v2/list/${conn.listId}/task`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: title,
        markdown_description: body,
        status: 'to do',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.err || data?.error || 'ClickUp task create failed');
    return {
      provider: 'clickup',
      id: String(data.id),
      key: data.custom_id || null,
      title: data.name,
      url: data.url || `https://app.clickup.com/t/${data.id}`,
    };
  }

  if (providerId === 'monday') {
    if (!conn.boardId) throw new Error('Monday board not configured — reconnect Monday.com');
    const data = await mondayGraph(
      conn.accessToken,
      `mutation ($boardId: ID!, $itemName: String!) {
        create_item(board_id: $boardId, item_name: $itemName) {
          id
          name
          url
        }
      }`,
      {
        boardId: conn.boardId,
        itemName: title.slice(0, 255),
      }
    );
    const item = data?.create_item;
    if (!item?.id) throw new Error('Monday.com did not create the item');
    // Attach description via update when possible (boards vary; ignore failures).
    try {
      await mondayGraph(
        conn.accessToken,
        `mutation ($itemId: ID!, $body: String!) {
          create_update(item_id: $itemId, body: $body) { id }
        }`,
        { itemId: String(item.id), body: body.slice(0, 4000) }
      );
    } catch {
      /* optional */
    }
    return {
      provider: 'monday',
      id: String(item.id),
      key: null,
      title: item.name || title,
      url: item.url || `https://monday.com`,
    };
  }

  if (providerId === 'jira') {
    if (!conn.cloudId || !conn.projectKey || !conn.issueTypeId) {
      throw new Error('Jira project not configured — reconnect Jira');
    }
    const headers = {
      Authorization: `Bearer ${conn.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const descriptionDoc = {
      type: 'doc',
      version: 1,
      content: String(body || '')
        .split('\n')
        .map((line) => ({
          type: 'paragraph',
          content: line ? [{ type: 'text', text: line }] : [],
        })),
    };
    const res = await fetch(
      `https://api.atlassian.com/ex/jira/${conn.cloudId}/rest/api/3/issue`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fields: {
            project: { key: conn.projectKey },
            summary: title.slice(0, 255),
            description: descriptionDoc,
            issuetype: { id: conn.issueTypeId },
          },
        }),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        data?.errors?.summary
        || data?.errorMessages?.[0]
        || Object.values(data?.errors || {})[0]
        || 'Jira issue create failed'
      );
    }
    const key = data.key;
    const base = (conn.siteUrl || '').replace(/\/+$/, '');
    return {
      provider: 'jira',
      id: data.id || key,
      key,
      title,
      url: key && base ? `${base}/browse/${key}` : (key ? `https://jira.atlassian.com/browse/${key}` : null),
    };
  }

  if (providerId === 'notion') {
    if (!conn.databaseId) throw new Error('Notion database not configured — reconnect Notion');
    const titleProp = conn.titleProperty || 'Name';
    const children = String(body || '')
      .split('\n')
      .filter(Boolean)
      .slice(0, 40)
      .map((line) => ({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: line.slice(0, 2000) } }],
        },
      }));
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders(conn.accessToken),
      body: JSON.stringify({
        parent: { database_id: conn.databaseId },
        properties: {
          [titleProp]: {
            title: [{ type: 'text', text: { content: title.slice(0, 2000) } }],
          },
        },
        children,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || 'Notion page create failed');
    return {
      provider: 'notion',
      id: data.id,
      key: null,
      title,
      url: data.url || null,
    };
  }

  throw new Error(`${PM_PROVIDERS[providerId]?.name || providerId} is not available yet`);
}

export function storePmConnection(account, providerId, connection) {
  if (!account.pm) account.pm = {};
  account.pm[providerId] = {
    ...connection,
    connectedAt: new Date().toISOString(),
  };
}

export function clearPmConnection(account, providerId) {
  if (!account.pm) return;
  delete account.pm[providerId];
  if (!Object.keys(account.pm).length) delete account.pm;
}
