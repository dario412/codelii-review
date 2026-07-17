import { getCore, getProjectStore, saveProjectStore, findProject, isMember } from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';

export async function OPTIONS() {
  return corsOptions('GET, PATCH, OPTIONS');
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
  const email = user.email.toLowerCase();
  const notifications = (store.notifications || [])
    .filter((n) => n.userEmail === email)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const unread = notifications.filter((n) => !n.read).length;
  return json({ notifications, unread });
}

export async function PATCH(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json();
  const projectId = body.projectId;
  if (!projectId) return json({ error: 'projectId required' }, 400);

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  const store = await getProjectStore(projectId);
  const email = user.email.toLowerCase();

  if (body.markAllRead) {
    for (const n of store.notifications || []) {
      if (n.userEmail === email) n.read = true;
    }
  } else if (body.id) {
    const n = (store.notifications || []).find((x) => x.id === body.id && x.userEmail === email);
    if (n) n.read = true;
  }

  await saveProjectStore(projectId, store);
  return json({ ok: true });
}
