/**
 * Agency clients — folders that group owned projects.
 * Slack incoming webhooks can be set per client (and overridden per project).
 */
import {
  getCore,
  saveCore,
  findClient,
  publicClient,
  newId,
} from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import { normalizeSlackWebhook } from './lib/slack.js';

const CLIENT_COLORS = [
  '#B8FF54',
  '#7EB8FF',
  '#FFB86C',
  '#C4A7FF',
  '#FF7A90',
  '#5EEAD4',
];

function colorForName(name) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CLIENT_COLORS[hash % CLIENT_COLORS.length];
}

function ownedClients(core, userId) {
  return (core.clients || [])
    .filter((c) => c.ownerId === userId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function clientPayload(client, { includeWebhook = false } = {}) {
  const base = publicClient(client);
  if (includeWebhook) {
    return { ...base, slackWebhookUrl: client.slackWebhookUrl || '' };
  }
  return base;
}

export async function OPTIONS() {
  return corsOptions('GET, POST, PATCH, DELETE, OPTIONS');
}

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const core = await getCore();
  const clients = ownedClients(core, user.id).map((c) => clientPayload(c));
  return json({ clients });
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);
  if (user.guest) {
    return json({ error: 'Guests cannot create clients' }, 403);
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return json({ error: 'Client name is required' }, 400);
  if (name.length > 80) return json({ error: 'Client name is too long' }, 400);

  let slackWebhookUrl = null;
  if (Object.prototype.hasOwnProperty.call(body, 'slackWebhookUrl')) {
    try {
      slackWebhookUrl = normalizeSlackWebhook(body.slackWebhookUrl);
    } catch (err) {
      return json({ error: err.message }, 400);
    }
  }

  const core = await getCore();
  const client = {
    id: newId(),
    name,
    ownerId: user.id,
    color: body.color || colorForName(name),
    slackWebhookUrl,
    createdAt: new Date().toISOString(),
  };

  if (!core.clients) core.clients = [];
  core.clients.push(client);
  await saveCore(core);

  return json({ client: clientPayload(client, { includeWebhook: true }) }, 201);
}

export async function PATCH(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => ({}));
  const id = body.id;
  if (!id) return json({ error: 'Client id required' }, 400);

  const core = await getCore();
  const client = findClient(core, id);
  if (!client) return json({ error: 'Client not found' }, 404);
  if (client.ownerId !== user.id) return json({ error: 'Forbidden' }, 403);

  if (typeof body.name === 'string' && body.name.trim()) {
    client.name = body.name.trim().slice(0, 80);
  }

  if (typeof body.color === 'string' && body.color.trim()) {
    client.color = body.color.trim().slice(0, 32);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'slackWebhookUrl')) {
    try {
      client.slackWebhookUrl = normalizeSlackWebhook(body.slackWebhookUrl);
    } catch (err) {
      return json({ error: err.message }, 400);
    }
  }

  await saveCore(core);
  return json({ client: clientPayload(client, { includeWebhook: true }) });
}

export async function DELETE(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Client id required' }, 400);

  const core = await getCore();
  const idx = (core.clients || []).findIndex((c) => c.id === id);
  if (idx === -1) return json({ error: 'Client not found' }, 404);

  const client = core.clients[idx];
  if (client.ownerId !== user.id) return json({ error: 'Forbidden' }, 403);

  // Unassign projects — never delete them with the client.
  for (const p of core.projects) {
    if (p.clientId === id) delete p.clientId;
  }

  core.clients.splice(idx, 1);
  await saveCore(core);
  return json({ ok: true });
}
