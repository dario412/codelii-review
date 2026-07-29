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
import { notifyCommentTagged, notifyReply, addNotification } from './lib/notifications.js';
import { pushActivity } from './lib/activity.js';
import { notifyReviewEvent } from './lib/notify.js';
import { json, corsOptions } from './lib/http.js';

export async function OPTIONS() {
  return corsOptions();
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
  // Hidden comments stay in the store for the owner; everyone else never sees them.
  const comments = store.comments
    .filter((c) => owner || !c.hidden)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return json({ comments });
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json();
  const projectId = (body.projectId || '').trim();
  if (!projectId) return json({ error: 'projectId required' }, 400);

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  const parentId = (body.parentId || '').trim();
  const text = (body.text || '').trim();
  const tags = Array.isArray(body.tags) ? body.tags : [];

  if (!text) return json({ error: 'Comment text is required' }, 400);

  const store = await getProjectStore(projectId);

  if (parentId) {
    const parent = store.comments.find((c) => c.id === parentId);
    if (!parent) return json({ error: 'Comment not found' }, 404);

    if (!parent.replies) parent.replies = [];

    const reply = {
      id: newId(),
      text,
      authorId: user.id,
      authorEmail: user.email,
      authorName: user.name,
      tags: tags.map((t) => ({
        email: (t.email || '').toLowerCase(),
        name: t.name || t.email || '',
      })),
      createdAt: new Date().toISOString(),
    };

    parent.replies.push(reply);
    notifyReply(store, parent, reply, user);
    await saveProjectStore(projectId, store);

    notifyReviewEvent(core, project, {
      title: 'New reply',
      body: reply.text,
      page: parent.page,
      actorName: user.name,
      commentId: parent.id,
    });

    const notifyTags = [...tags];
    if (parent.authorEmail !== user.email && !tags.some((t) => t.email === parent.authorEmail)) {
      notifyTags.push({ email: parent.authorEmail, name: parent.authorName, isAuthor: true });
    }

    if (notifyTags.length > 0) {
      await notifyEmail(project, parent, reply, user, notifyTags, request, true);
    }

    return json({ reply, comment: parent }, 201);
  }

  const page = (body.page || body.path || '').trim();
  const x = Number(body.x);
  const y = Number(body.y);
  const scrollY = Number(body.scrollY) || 0;

  if (!page) return json({ error: 'Page path is required' }, 400);
  if (Number.isNaN(x) || Number.isNaN(y)) {
    return json({ error: 'Position is required' }, 400);
  }

  const comment = {
    id: newId(),
    page,
    path: page,
    projectId,
    x,
    y,
    scrollY,
    text,
    authorId: user.id,
    authorEmail: user.email,
    authorName: user.name,
    tags: tags.map((t) => ({
      email: (t.email || '').toLowerCase(),
      name: t.name || t.email || '',
    })),
    replies: [],
    resolved: false,
    screenshot: false,
    createdAt: new Date().toISOString(),
  };

  store.comments.push(comment);
  notifyCommentTagged(store, comment, user, comment.tags);
  pushActivity(store, {
    type: 'comment_created',
    actorId: user.id,
    actorName: user.name,
    commentId: comment.id,
    page: comment.page,
    message: comment.text.slice(0, 160),
  });
  await saveProjectStore(projectId, store);

  notifyReviewEvent(core, project, {
    title: 'New comment',
    body: comment.text,
    page: comment.page,
    actorName: user.name,
    commentId: comment.id,
  });

  if (tags.length > 0) {
    await notifyEmail(project, comment, comment, user, tags, request, false);
  }

  return json({ comment }, 201);
}

export async function PATCH(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json();
  const { id, resolved, text, hidden, assigneeId, projectId } = body;
  if (!id || !projectId) return json({ error: 'id and projectId required' }, 400);

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  const store = await getProjectStore(projectId);
  const comment = store.comments.find((c) => c.id === id);
  if (!comment) return json({ error: 'Not found' }, 404);

  // Hide/unhide is owner-only — for spam / off-topic without deleting history.
  if (typeof hidden === 'boolean') {
    if (!isOwner(project, user.id)) {
      return json({ error: 'Only the project owner can hide comments' }, 403);
    }
    comment.hidden = hidden;
    if (hidden) {
      comment.hiddenAt = new Date().toISOString();
      comment.hiddenBy = user.id;
    } else {
      delete comment.hiddenAt;
      delete comment.hiddenBy;
    }
  }

  if (typeof resolved === 'boolean' && resolved !== comment.resolved) {
    comment.resolved = resolved;
    pushActivity(store, {
      type: resolved ? 'comment_resolved' : 'comment_reopened',
      actorId: user.id,
      actorName: user.name,
      commentId: comment.id,
      page: comment.page,
      message: comment.text.slice(0, 160),
    });
    notifyReviewEvent(core, project, {
      title: resolved ? 'Comment resolved' : 'Comment reopened',
      body: comment.text,
      page: comment.page,
      actorName: user.name,
      commentId: comment.id,
    });
  }

  if (text !== undefined) comment.text = text.trim();

  // Assign / unassign — any member. Turns feedback into task ownership.
  if (Object.prototype.hasOwnProperty.call(body, 'assigneeId')) {
    if (assigneeId === null || assigneeId === '') {
      const prevName = comment.assigneeName;
      delete comment.assigneeId;
      delete comment.assigneeName;
      delete comment.assigneeEmail;
      delete comment.assignedAt;
      delete comment.assignedBy;
      pushActivity(store, {
        type: 'unassigned',
        actorId: user.id,
        actorName: user.name,
        commentId: comment.id,
        page: comment.page,
        assigneeName: prevName || null,
      });
    } else {
      const memberIds = project.memberIds || [];
      if (!memberIds.includes(assigneeId) && project.ownerId !== assigneeId) {
        return json({ error: 'Assignee must be a project member' }, 400);
      }
      const assignee = core.users.find((u) => u.id === assigneeId);
      if (!assignee) return json({ error: 'Assignee not found' }, 404);

      comment.assigneeId = assignee.id;
      comment.assigneeName = assignee.name;
      comment.assigneeEmail = assignee.email;
      comment.assignedAt = new Date().toISOString();
      comment.assignedBy = user.id;

      addNotification(store, {
        userEmail: assignee.email,
        type: 'assign',
        commentId: comment.id,
        page: comment.page,
        message: comment.text,
        fromName: user.name,
        fromEmail: user.email,
      });

      pushActivity(store, {
        type: 'assigned',
        actorId: user.id,
        actorName: user.name,
        commentId: comment.id,
        page: comment.page,
        assigneeId: assignee.id,
        assigneeName: assignee.name,
        message: comment.text.slice(0, 160),
      });
      notifyReviewEvent(core, project, {
        title: `Assigned to ${assignee.name}`,
        body: comment.text,
        page: comment.page,
        actorName: user.name,
        commentId: comment.id,
      });
    }
  }

  await saveProjectStore(projectId, store);
  return json({ comment });
}

export async function DELETE(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const projectId = url.searchParams.get('projectId');
  if (!id || !projectId) return json({ error: 'id and projectId required' }, 400);

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  const store = await getProjectStore(projectId);
  const idx = store.comments.findIndex((c) => c.id === id);
  if (idx === -1) return json({ error: 'Not found' }, 404);

  const comment = store.comments[idx];
  const allowed = comment.authorId === user.id || isOwner(project, user.id);
  if (!allowed) {
    return json({ error: 'Only the author or project owner can delete' }, 403);
  }

  store.comments.splice(idx, 1);
  try {
    const { deleteScreenshot } = await import('./lib/screenshots.js');
    await deleteScreenshot(id);
  } catch {
    /* ignore */
  }
  await saveProjectStore(projectId, store);
  return json({ ok: true });
}

async function notifyEmail(project, comment, message, author, tags, request, isReply) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const siteUrl = process.env.SITE_URL || `${new URL(request.url).origin}`;
  const prefix = project.type === 'github' ? `/s/${project.id}` : `/p/${project.id}`;
  const pagePath = (comment.page || '').replace(/^\//, '');
  const link = `${siteUrl}${prefix}/${pagePath}?comment=${comment.id}`;
  const messageText = message.text;
  const seen = new Set();

  for (const tag of tags) {
    const email = (tag.email || '').toLowerCase();
    if (!email || email === author.email || seen.has(email)) continue;
    seen.add(email);

    const subject = tag.isAuthor
      ? `${author.name} replied to your comment`
      : isReply
        ? `${author.name} mentioned you in a reply`
        : `${author.name} tagged you in a review comment`;

    const intro = tag.isAuthor
      ? `<strong>${escapeHtml(author.name)}</strong> replied to your comment on <strong>${escapeHtml(project.name)}</strong>:`
      : `<strong>${escapeHtml(author.name)}</strong> mentioned you ${isReply ? 'in a reply' : 'in a comment'} on <strong>${escapeHtml(project.name)}</strong>:`;

    if (!apiKey) {
      console.log(`[notify] Would email ${email}: ${subject}`);
      continue;
    }

    try {
      const { Resend } = await import('resend');
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from,
        to: email,
        subject,
        html: `
          <div style="font-family: Inter, sans-serif; max-width: 520px;">
            <p>${intro}</p>
            ${isReply && !tag.isAuthor ? `<p style="color:#6B6E75;font-size:14px;">On: "${escapeHtml(comment.text.slice(0, 120))}${comment.text.length > 120 ? '…' : ''}"</p>` : ''}
            <blockquote style="border-left: 3px solid #B8FF54; margin: 16px 0; padding: 8px 16px; color: #2A2D34;">
              ${escapeHtml(messageText)}
            </blockquote>
            <p><a href="${link}" style="color: #002B2B;">View conversation →</a></p>
          </div>
        `,
      });
    } catch (err) {
      console.error('Email notify failed:', err.message);
    }
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
