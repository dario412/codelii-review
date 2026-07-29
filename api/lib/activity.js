/**
 * Project activity feed — append-only events for client-facing progress.
 */
import { newId } from './ids.js';

const MAX_EVENTS = 200;

export function pushActivity(store, event) {
  if (!store.activityEvents) store.activityEvents = [];
  store.activityEvents.unshift({
    id: newId(),
    createdAt: new Date().toISOString(),
    ...event,
  });
  if (store.activityEvents.length > MAX_EVENTS) {
    store.activityEvents = store.activityEvents.slice(0, MAX_EVENTS);
  }
}

/**
 * Build a feed when activityEvents is empty so older projects still show momentum.
 */
export function deriveActivity(store) {
  const events = [];

  for (const c of store.comments || []) {
    if (c.hidden) continue;
    events.push({
      id: `c-${c.id}`,
      type: 'comment_created',
      createdAt: c.createdAt,
      actorId: c.authorId,
      actorName: c.authorName,
      commentId: c.id,
      page: c.page,
      message: c.text,
    });
    if (c.assigneeId) {
      events.push({
        id: `a-${c.id}`,
        type: 'assigned',
        createdAt: c.assignedAt || c.createdAt,
        actorId: c.assignedBy || c.authorId,
        actorName: c.authorName,
        commentId: c.id,
        page: c.page,
        assigneeId: c.assigneeId,
        assigneeName: c.assigneeName,
      });
    }
    if (c.githubIssueNumber) {
      events.push({
        id: `g-${c.id}`,
        type: 'github_issue',
        createdAt: c.githubIssueCreatedAt || c.createdAt,
        actorId: c.githubIssueCreatedBy,
        actorName: c.authorName,
        commentId: c.id,
        page: c.page,
        githubIssueNumber: c.githubIssueNumber,
        githubIssueUrl: c.githubIssueUrl,
      });
    }
    if (c.resolved) {
      events.push({
        id: `r-${c.id}`,
        type: 'comment_resolved',
        createdAt: c.createdAt,
        actorName: c.authorName,
        commentId: c.id,
        page: c.page,
      });
    }
  }

  for (const a of store.pageApprovals || []) {
    if (a.revokedAt) {
      events.push({
        id: `appr-r-${a.id}`,
        type: 'page_revoked',
        createdAt: a.revokedAt,
        actorId: a.revokedBy,
        actorName: a.revokedByName,
        page: a.page,
      });
    } else {
      events.push({
        id: `appr-${a.id}`,
        type: 'page_approved',
        createdAt: a.approvedAt,
        actorId: a.approvedBy,
        actorName: a.approvedByName,
        page: a.page,
      });
    }
  }

  for (const run of store.cursorRuns || []) {
    events.push({
      id: `fix-${run.id}`,
      type: 'cursor_started',
      createdAt: run.createdAt,
      actorId: run.startedBy,
      actorName: run.startedByName,
      runId: run.id,
      status: run.status,
      prUrl: run.prUrl || null,
    });
  }

  return events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
}
