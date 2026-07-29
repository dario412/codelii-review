/**
 * Project activity / progress feed for all members (clients included).
 */
import {
  getCore,
  getProjectStore,
  findProject,
  isMember,
  isOwner,
} from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import { deriveActivity } from './lib/activity.js';

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

  const store = await getProjectStore(projectId);
  const owner = isOwner(project, user.id);
  const hiddenIds = new Set(
    (store.comments || []).filter((c) => c.hidden).map((c) => c.id)
  );

  let events = Array.isArray(store.activityEvents) && store.activityEvents.length
    ? store.activityEvents
    : deriveActivity(store);

  if (!owner) {
    events = events.filter((e) => !e.commentId || !hiddenIds.has(e.commentId));
  }

  // Progress snapshot for the header strip
  const comments = (store.comments || []).filter((c) => owner || !c.hidden);
  const open = comments.filter((c) => !c.resolved).length;
  const resolved = comments.filter((c) => c.resolved).length;
  const assigned = comments.filter((c) => c.assigneeId && !c.resolved).length;
  const approvedPages = (store.pageApprovals || []).filter((a) => !a.revokedAt).length;
  const issues = comments.filter((c) => c.githubIssueNumber).length;

  return json({
    events: events.slice(0, 80),
    progress: {
      open,
      resolved,
      assigned,
      approvedPages,
      issues,
      total: comments.length,
    },
  });
}
