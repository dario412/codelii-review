import { getCore, getProjectStore, saveProjectStore, findProject, isMember } from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';

const ACTIVE_MS = 3 * 60 * 1000;

export async function OPTIONS() {
  return corsOptions('GET, POST, OPTIONS');
}

function clampPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}

function normalizePage(page) {
  if (page == null || page === '') return null;
  let p = String(page).trim().replace(/^\//, '');
  if (!p || p.endsWith('/')) p = `${p}index.html`.replace(/^\//, '');
  return p || 'index.html';
}

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) return json({ error: 'projectId required' }, 400);

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  const store = await getProjectStore(projectId);
  const now = Date.now();
  const online = [];

  for (const entry of Object.values(store.presence || {})) {
    if (!entry?.lastSeen) continue;
    if (now - new Date(entry.lastSeen).getTime() > ACTIVE_MS) continue;
    if (entry.email === user.email.toLowerCase()) continue;
    online.push({
      id: entry.id,
      name: entry.name,
      email: entry.email,
      lastSeen: entry.lastSeen,
      page: entry.page || null,
      x: typeof entry.x === 'number' ? entry.x : null,
      y: typeof entry.y === 'number' ? entry.y : null,
    });
  }

  online.sort((a, b) => a.name.localeCompare(b.name));
  return json({ online });
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => ({}));
  const projectId = body.projectId;
  if (!projectId) return json({ error: 'projectId required' }, 400);

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  const store = await getProjectStore(projectId);
  if (!store.presence) store.presence = {};

  const email = user.email.toLowerCase();
  const prev = store.presence[email] || {};
  const page = normalizePage(body.page);
  const x = clampPct(body.x);
  const y = clampPct(body.y);

  store.presence[email] = {
    id: user.id,
    name: user.name,
    email,
    lastSeen: new Date().toISOString(),
    page: page != null ? page : prev.page || null,
    x: x != null ? x : prev.x ?? null,
    y: y != null ? y : prev.y ?? null,
  };

  const now = Date.now();
  for (const [key, entry] of Object.entries(store.presence)) {
    if (now - new Date(entry.lastSeen).getTime() > ACTIVE_MS * 2) {
      delete store.presence[key];
    }
  }

  await saveProjectStore(projectId, store);
  return json({ ok: true });
}
