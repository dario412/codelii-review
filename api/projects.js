import {
  getCore,
  saveCore,
  findProject,
  findClient,
  isMember,
  isOwner,
  publicProject,
  publicClient,
  newId,
  saveProjectStore,
  deleteProjectStore,
} from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import { ingestGitHubRepo, parseGitHubUrl } from './lib/github.js';
import { isStripeConfigured } from './lib/stripe.js';
import { canCreateProjects, blockedReason, syncFromStripe } from './lib/billing.js';
import { normalizeSlackWebhook } from './lib/slack.js';

function enrichProject(project, core, user) {
  const card = {
    ...publicProject(project, core.users),
    viewUrl: projectViewUrl(project),
  };
  if (project.clientId) {
    const client = findClient(core, project.clientId);
    if (client) {
      card.clientId = client.id;
      card.clientName = client.name;
      card.clientColor = client.color || null;
    } else {
      card.clientId = null;
    }
  }
  if (isOwner(project, user.id)) {
    card.slackWebhookUrl = project.slackWebhookUrl || '';
  }
  return card;
}
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
  const account = core.users.find((u) => u.id === user.id);
  const owned = [];
  const invited = [];

  for (const p of core.projects) {
    const card = enrichProject(p, core, user);
    if (p.ownerId === user.id) owned.push(card);
    else if (isMember(p, user.id)) invited.push(card);
  }

  owned.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  invited.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const clients = (core.clients || [])
    .filter((c) => c.ownerId === user.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      ...publicClient(c),
      projectCount: owned.filter((p) => p.clientId === c.id).length,
    }));

  return json({
    owned,
    invited,
    clients,
    slackConnected: Boolean(account?.slack?.webhookUrl),
  });
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  try {
    const core = await getCore();
    const account = core.users.find((u) => u.id === user.id);
    if (!account) return json({ error: 'Account not found' }, 401);

    if (account.guest) {
      return json(
        { error: 'Guests joined through a share link cannot create projects. Sign up for an account first.' },
        403
      );
    }

    // Paywall. Creating your own project is the paid action; being invited to
    // someone else's is free, which is why this check lives here and not in
    // GET, /api/comments or the viewer.
    if (isStripeConfigured() && !canCreateProjects(account)) {
      // The webhook may still be in flight right after checkout, so confirm
      // against Stripe before turning a paying customer away.
      const changed = await syncFromStripe(account).catch(() => false);
      if (changed) await saveCore(core);

      if (!canCreateProjects(account)) {
        return json({ error: blockedReason(account), needsSubscription: true }, 402);
      }
    }

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

    const hasSource =
      typeof body.hasSource === 'boolean'
        ? body.hasSource
        : detected.type === 'github';

    const project = {
      id: newId(),
      name: projectName,
      type: detected.type,
      source: detected.type === 'github' ? detected.source : detected.origin,
      baseUrl: detected.type === 'url' ? detected.origin : null,
      startPath: detected.type === 'url' ? detected.startPath : '/',
      hasSource,
      ownerId: user.id,
      memberIds: [user.id],
      invites: [],
      linkToken: newId(),
      linkAccess: true,
      status: detected.type === 'github' ? 'ingesting' : 'ready',
      createdAt: new Date().toISOString(),
    };

    const clientId = body.clientId || null;
    if (clientId) {
      const client = findClient(core, clientId);
      if (!client || client.ownerId !== user.id) {
        return json({ error: 'Client not found' }, 400);
      }
      project.clientId = client.id;
    }

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
            project: enrichProject(project, core, user),
          },
          422
        );
      }
    }

    return json(
      {
        project: {
          ...enrichProject(project, core, user),
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

  if (typeof body.hasSource === 'boolean') {
    if (!isOwner(project, user.id)) return json({ error: 'Only the owner can change settings' }, 403);
    project.hasSource = body.hasSource;
  }

  if (typeof body.repoUrl === 'string') {
    if (!isOwner(project, user.id)) return json({ error: 'Only the owner can change settings' }, 403);
    const url = body.repoUrl.trim();
    project.repoUrl = url || null;
    if (url) project.hasSource = true;
  }

  if (typeof body.repoRef === 'string') {
    if (!isOwner(project, user.id)) return json({ error: 'Only the owner can change settings' }, 403);
    project.repoRef = body.repoRef.trim() || 'main';
  }

  if (typeof body.localPath === 'string') {
    if (!isOwner(project, user.id)) return json({ error: 'Only the owner can change settings' }, 403);
    const path = body.localPath.trim();
    project.localPath = path || null;
    if (path) project.hasSource = true;
  }

  if (typeof body.autoCreatePR === 'boolean') {
    if (!isOwner(project, user.id)) return json({ error: 'Only the owner can change settings' }, 403);
    project.autoCreatePR = body.autoCreatePR;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'clientId')) {
    if (!isOwner(project, user.id)) return json({ error: 'Only the owner can change the client' }, 403);
    const next = body.clientId;
    if (next === null || next === '') {
      delete project.clientId;
    } else {
      const client = findClient(core, next);
      if (!client || client.ownerId !== user.id) {
        return json({ error: 'Client not found' }, 400);
      }
      project.clientId = client.id;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'slackWebhookUrl')) {
    if (!isOwner(project, user.id)) return json({ error: 'Only the owner can change Slack settings' }, 403);
    try {
      project.slackWebhookUrl = normalizeSlackWebhook(body.slackWebhookUrl);
    } catch (err) {
      return json({ error: err.message }, 400);
    }
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
      ...enrichProject(project, core, user),
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
