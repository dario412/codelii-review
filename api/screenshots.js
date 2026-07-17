import { getUser } from './lib/auth.js';
import { getCore, getProjectStore, saveProjectStore, findProject, isMember } from './lib/store.js';
import { readScreenshot, saveScreenshot, deleteScreenshot } from './lib/screenshots.js';
import { json, corsOptions } from './lib/http.js';

export async function OPTIONS() {
  return corsOptions('GET, POST, DELETE, OPTIONS');
}

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const commentId = url.searchParams.get('commentId');
  const projectId = url.searchParams.get('projectId');
  if (!commentId || !projectId) return json({ error: 'commentId and projectId required' }, 400);

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  const store = await getProjectStore(projectId);
  const comment = store.comments.find((c) => c.id === commentId);
  if (!comment) return json({ error: 'Not found' }, 404);

  const buffer = await readScreenshot(commentId);
  if (!buffer) return json({ error: 'Screenshot not found' }, 404);

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json();
  const commentId = (body.commentId || '').trim();
  const projectId = (body.projectId || '').trim();
  const image = body.image || '';

  if (!commentId || !projectId) return json({ error: 'commentId and projectId required' }, 400);
  if (!image) return json({ error: 'image required' }, 400);

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  const store = await getProjectStore(projectId);
  const comment = store.comments.find((c) => c.id === commentId);
  if (!comment) return json({ error: 'Comment not found' }, 404);

  const base64 = image.includes(',') ? image.split(',')[1] : image;
  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length > 4 * 1024 * 1024) {
    return json({ error: 'Screenshot too large' }, 400);
  }

  await saveScreenshot(commentId, buffer);
  comment.screenshot = true;
  await saveProjectStore(projectId, store);

  return json({ ok: true, commentId }, 201);
}

export async function DELETE(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const commentId = url.searchParams.get('commentId');
  const projectId = url.searchParams.get('projectId');
  if (!commentId || !projectId) return json({ error: 'commentId and projectId required' }, 400);

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

  const store = await getProjectStore(projectId);
  const comment = store.comments.find((c) => c.id === commentId);
  if (!comment) return json({ error: 'Not found' }, 404);
  if (comment.authorId !== user.id) {
    return json({ error: 'Only the author can delete' }, 403);
  }

  await deleteScreenshot(commentId);
  comment.screenshot = false;
  await saveProjectStore(projectId, store);

  return json({ ok: true });
}
