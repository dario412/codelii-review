import {
  getCore,
  saveCore,
  findProject,
  isMember,
  isOwner,
  publicProject,
  newId,
  saveProjectStore,
  deleteProjectStore,
} from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import { ingestGitHubRepo, parseGitHubUrl } from './lib/github.js';

function detectSource(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  const gh = parseGitHubUrl(raw);
  if (gh) {
    return {
      type: 'github',
      source: `https://github.com/${gh.owner}/${gh.repo}`,
      gh,
    };
  }
  try {
    let url = raw;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    return {
      type: 'url',
      source: parsed.href,
      origin: parsed.origin,
      startPath: parsed.pathname || '/',
    };
  } catch {
    return null;
  }
}

function projectViewUrl(project) {
  if (project.type === 'github') return `/s/${project.id}/`;
  return `/p/${project.id}/`;
}

export async function OPTIONS() {
  return corsOptions();
}

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const core = await getCore();
  const owned = [];
  const invited = [];

  for (const p of core.projects) {
    const card = { ...publicProject(p, core.users), viewUrl: projectViewUrl(p) };
    if (p.ownerId === user.id) owned.push(card);
    else if (isMember(p, user.id)) invited.push(card);
  }

  owned.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  invited.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return json({ owned, invited });
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    const detected = detectSource(body.source || body.url || body.repo);
    if (!detected) return json({ error: 'Enter a valid URL or GitHub repository' }, 400);

    let projectName = name;
    if (!projectName) {
      if (detected.type === 'github') {
        projectName = `${detected.gh.owner}/${detected.gh.repo}`;
      } else {
        projectName = new URL(detected.origin).hostname;
      }
    }

    const project = {
      id: newId(),
      name: projectName,
      type: detected.type,
      source: detected.type === 'github' ? detected.source : detected.origin,
      baseUrl: detected.type === 'url' ? detected.origin : null,
      startPath: detected.type === 'url' ? detected.startPath : '/',
      ownerId: user.id,
      memberIds: [user.id],
      invites: [],
      linkToken: newId(),
      status: detected.type === 'github' ? 'ingesting' : 'ready',
      createdAt: new Date().toISOString(),
    };

    const core = await getCore();
    core.projects.push(project);
    await saveCore(core);
    await saveProjectStore(project.id, { comments: [], notifications: [], presence: {} });

    if (detected.type === 'github') {
      try {
        await ingestGitHubRepo(project.id, detected.gh.owner, detected.gh.repo, detected.gh.ref);
        project.status = 'ready';
        await saveCore(core);
      } catch (err) {
        project.status = 'error';
        project.error = err.message;
        await saveCore(core);
        return json(
          {
            error: err.message || 'Failed to import GitHub repository',
            project: { ...publicProject(project, core.users), viewUrl: projectViewUrl(project) },
          },
          422
        );
      }
    }

    return json(
      {
        project: {
          ...publicProject(project, core.users),
          viewUrl: projectViewUrl(project),
          linkToken: project.linkToken,
        },
      },
      201
    );
  } catch (err) {
    console.error('[projects POST]', err);
    return json({ error: err.message || 'Failed to create project' }, 500);
  }
}

export async function PATCH(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json();
  const id = body.id;
  if (!id) return json({ error: 'Project id required' }, 400);

  const core = await getCore();
  const project = findProject(core, id);
  if (!project) return json({ error: 'Project not found' }, 404);
  if (!isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  if (typeof body.name === 'string' && body.name.trim()) {
    if (!isOwner(project, user.id)) return json({ error: 'Only the owner can rename' }, 403);
    project.name = body.name.trim();
  }

  if (body.regenerateLink) {
    if (!isOwner(project, user.id)) return json({ error: 'Only the owner can regenerate the link' }, 403);
    project.linkToken = newId();
  }

  if (body.leave) {
    if (isOwner(project, user.id)) {
      return json({ error: 'Owners cannot leave — delete the project instead' }, 400);
    }
    project.memberIds = (project.memberIds || []).filter((mid) => mid !== user.id);
  }

  await saveCore(core);
  return json({
    project: {
      ...publicProject(project, core.users),
      viewUrl: projectViewUrl(project),
      linkToken: isOwner(project, user.id) ? project.linkToken : undefined,
    },
  });
}

export async function DELETE(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Project id required' }, 400);

  const core = await getCore();
  const idx = core.projects.findIndex((p) => p.id === id);
  if (idx === -1) return json({ error: 'Project not found' }, 404);

  const project = core.projects[idx];
  if (project.ownerId !== user.id) return json({ error: 'Only the owner can delete' }, 403);

  core.projects.splice(idx, 1);
  await saveCore(core);
  await deleteProjectStore(id);

  return json({ ok: true });
}
