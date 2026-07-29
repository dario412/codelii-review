/**
 * Page-level client approve / sign-off.
 *
 * Any project member can sign off a page (clients included). The record is
 * keyed by the same page path comments use, with who/when for agency audit.
 * Owners can revoke; anyone can re-approve (replaces the active sign-off).
 */
import {
  getCore,
  getProjectStore,
  saveProjectStore,
  findProject,
  isMember,
  isOwner,
  newId,
} from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import { pushActivity } from './lib/activity.js';
import { notifySlack } from './lib/slack.js';

export async function OPTIONS() {
  return corsOptions('GET, POST, DELETE, OPTIONS');
}

function normalizePage(raw) {
  let page = String(raw || '').trim().replace(/^\//, '');
  if (!page || page === '/') page = 'index.html';
  if (page.endsWith('/')) page += 'index.html';
  return page;
}

function activeApproval(store, page) {
  return (store.pageApprovals || []).find(
    (a) => a.page === page && !a.revokedAt
  ) || null;
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
  const page = url.searchParams.get('page');
  const approvals = [...(store.pageApprovals || [])].sort(
    (a, b) => new Date(b.approvedAt) - new Date(a.approvedAt)
  );

  if (page) {
    const key = normalizePage(page);
    return json({
      page: key,
      approval: activeApproval(store, key),
      history: approvals.filter((a) => a.page === key).slice(0, 20),
    });
  }

  const active = approvals.filter((a) => !a.revokedAt);
  return json({ approvals: active, history: approvals.slice(0, 50) });
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json();
  const projectId = (body.projectId || '').trim();
  const page = normalizePage(body.page);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  if (!projectId) return json({ error: 'projectId required' }, 400);

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  const store = await getProjectStore(projectId);
  if (!store.pageApprovals) store.pageApprovals = [];

  // One active sign-off per page: revoke the previous if present.
  const previous = activeApproval(store, page);
  if (previous) {
    previous.revokedAt = new Date().toISOString();
    previous.revokedBy = user.id;
    previous.revokedByName = user.name;
    previous.revokeReason = 'superseded';
  }

  const approval = {
    id: newId(),
    page,
    approvedAt: new Date().toISOString(),
    approvedBy: user.id,
    approvedByName: user.name,
    approvedByEmail: user.email,
    note: note || null,
  };
  store.pageApprovals.unshift(approval);
  store.pageApprovals = store.pageApprovals.slice(0, 200);
  pushActivity(store, {
    type: 'page_approved',
    actorId: user.id,
    actorName: user.name,
    page,
  });
  await saveProjectStore(projectId, store);

  notifySlack(core, project, {
    title: 'Page approved',
    body: page,
    page,
    actorName: user.name,
  });

  return json({ approval }, 201);
}

export async function DELETE(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  const page = normalizePage(url.searchParams.get('page'));
  const id = url.searchParams.get('id');
  if (!projectId || (!page && !id)) {
    return json({ error: 'projectId and page (or id) required' }, 400);
  }

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  // Revoke is owner-only so a client can't quietly erase the audit trail.
  if (!isOwner(project, user.id)) {
    return json({ error: 'Only the project owner can revoke a sign-off' }, 403);
  }

  const store = await getProjectStore(projectId);
  const target = (store.pageApprovals || []).find((a) => {
    if (a.revokedAt) return false;
    if (id) return a.id === id;
    return a.page === page;
  });
  if (!target) return json({ error: 'No active approval to revoke' }, 404);

  target.revokedAt = new Date().toISOString();
  target.revokedBy = user.id;
  target.revokedByName = user.name;
  target.revokeReason = 'revoked';
  pushActivity(store, {
    type: 'page_revoked',
    actorId: user.id,
    actorName: user.name,
    page: target.page,
  });
  await saveProjectStore(projectId, store);

  return json({ ok: true, approval: target });
}
