/**
 * Create a PM task from a review comment.
 * POST { projectId, commentId, provider }
 */
import {
  getCore,
  getProjectStore,
  saveProjectStore,
  findProject,
  isMember,
} from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import { pushActivity } from './lib/activity.js';
import {
  PM_PROVIDERS,
  createPmTask,
  getPmConnection,
} from './lib/pm.js';
import { projectReviewUrl } from './lib/slack.js';

export async function OPTIONS() {
  return corsOptions('POST, OPTIONS');
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  try {
    const body = await request.json();
    const projectId = (body.projectId || '').trim();
    const commentId = (body.commentId || '').trim();
    const provider = (body.provider || '').toLowerCase();

    if (!projectId || !commentId || !provider) {
      return json({ error: 'projectId, commentId, and provider required' }, 400);
    }
    const meta = PM_PROVIDERS[provider];
    if (!meta || meta.comingSoon) {
      return json({ error: `${meta?.name || provider} is not available yet` }, 400);
    }

    const core = await getCore();
    const project = findProject(core, projectId);
    if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

    const account = core.users.find((u) => u.id === user.id);
    if (!account || !getPmConnection(account, provider)?.accessToken) {
      return json({
        error: `Connect ${meta.name} in Integrations first`,
        needsConnect: true,
        provider,
      }, 400);
    }

    const store = await getProjectStore(projectId);
    const comment = store.comments.find((c) => c.id === commentId);
    if (!comment) return json({ error: 'Comment not found' }, 404);

    // Idempotent per provider on this comment.
    const existing = (comment.pmTasks || []).find((t) => t.provider === provider);
    if (existing?.url) {
      return json({ alreadyExists: true, task: existing, comment });
    }

    const deepLink = `${projectReviewUrl(project, comment.page)}${
      projectReviewUrl(project, comment.page).includes('?') ? '&' : '?'
    }comment=${comment.id}`;

    const task = await createPmTask(account, provider, {
      title: (comment.text || 'Review feedback').replace(/\s+/g, ' ').trim().slice(0, 120),
      description: comment.text || '',
      deepLink,
      projectName: project.name,
      page: comment.page,
      authorName: comment.authorName,
    });

    if (!comment.pmTasks) comment.pmTasks = [];
    const record = {
      provider: task.provider,
      id: task.id,
      key: task.key || null,
      title: task.title,
      url: task.url,
      createdAt: new Date().toISOString(),
      createdBy: user.id,
    };
    comment.pmTasks.push(record);

    pushActivity(store, {
      type: 'pm_task',
      actorId: user.id,
      actorName: user.name,
      commentId: comment.id,
      page: comment.page,
      provider,
      providerName: meta.name,
      taskUrl: task.url,
      taskKey: task.key,
      message: task.title,
    });

    await saveProjectStore(projectId, store);
    return json({ comment, task: record }, 201);
  } catch (err) {
    console.error('[pm-task]', err);
    return json({ error: err.message || 'Failed to create task' }, 500);
  }
}
