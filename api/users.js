import { getCore, getProjectStore, findProject, isMember } from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';

export async function OPTIONS() {
  return corsOptions('GET, OPTIONS');
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

  const users = (project.memberIds || [])
    .map((id) => {
      const u = core.users.find((x) => x.id === id);
      if (!u) return null;
      return { id: u.id, email: u.email, name: u.name, avatar: u.avatar || null };
    })
    .filter(Boolean);

  return json({ users });
}
