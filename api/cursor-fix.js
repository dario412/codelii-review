import {
  getCore,
  getProjectStore,
  saveProjectStore,
  findProject,
  isMember,
  newId,
} from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import {
  buildCursorPrompt,
  buildAllOpenPrompts,
  buildCommentsPrompts,
  resolveRepoUrl,
} from './lib/prompts.js';
import { startCursorFix, getCursorRunStatus, isCursorConfigured } from './lib/cursor-agent.js';

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
  const runs = [...(store.cursorRuns || [])].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const runId = url.searchParams.get('runId');
  if (runId) {
    const run = runs.find((r) => r.id === runId || r.runId === runId);
    if (!run) return json({ error: 'Run not found' }, 404);

    if (isCursorConfigured() && run.agentId) {
      try {
        const live = await getCursorRunStatus({
          agentId: run.agentId,
          runId: run.runId,
          runtime: run.runtime,
          localPath: project.localPath,
        });
        if (live.status && live.status !== 'unknown') {
          run.status = live.status;
          run.updatedAt = new Date().toISOString();
          if (live.resultText) run.resultText = live.resultText;
          if (live.prUrl) run.prUrl = live.prUrl;
          await saveProjectStore(projectId, store);
        }
      } catch (err) {
        console.warn('[cursor-fix GET]', err.message);
      }
    }

    return json({ run, configured: isCursorConfigured() });
  }

  return json({
    runs: runs.slice(0, 30),
    configured: isCursorConfigured(),
    canCloud: Boolean(resolveRepoUrl(project)),
    canLocal: Boolean(project.localPath),
  });
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  if (!isCursorConfigured()) {
    return json(
      {
        error:
          'Cursor SDK is not configured. Add CURSOR_API_KEY from https://cursor.com/dashboard/integrations',
      },
      503
    );
  }

  try {
    const body = await request.json();
    const projectId = (body.projectId || '').trim();
    if (!projectId) return json({ error: 'projectId required' }, 400);

    const core = await getCore();
    const project = findProject(core, projectId);
    if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

    const store = await getProjectStore(projectId);
    let prompt = (body.prompt || '').trim();
    let commentId = body.commentId || null;
    const commentIds = Array.isArray(body.commentIds)
      ? body.commentIds.map((id) => String(id)).filter(Boolean)
      : [];
    const scope = body.scope || (commentId ? 'comment' : commentIds.length ? 'selected' : 'custom');

    if (!prompt && scope === 'all') {
      prompt = buildAllOpenPrompts(store.comments, project);
      if (!prompt) return json({ error: 'No open comments to fix' }, 400);
    } else if (!prompt && (scope === 'selected' || commentIds.length)) {
      const selected = store.comments.filter(
        (c) => commentIds.includes(c.id) && !c.resolved
      );
      if (!selected.length) return json({ error: 'No selected open comments to fix' }, 400);
      prompt = buildCommentsPrompts(selected, project);
    } else if (!prompt && commentId) {
      const comment = store.comments.find((c) => c.id === commentId);
      if (!comment) return json({ error: 'Comment not found' }, 404);
      prompt = buildCursorPrompt(comment, project);
    }

    if (!prompt) return json({ error: 'prompt or commentId required' }, 400);

    const mode = body.mode || (project.localPath && !resolveRepoUrl(project) ? 'local' : 'cloud');
    const workOnCurrentBranch = body.workOnCurrentBranch === true;
    const autoCreatePR =
      body.autoCreatePR !== undefined
        ? Boolean(body.autoCreatePR)
        : workOnCurrentBranch
          ? false
          : project.autoCreatePR !== false;

    const started = await startCursorFix({
      project,
      prompt,
      mode,
      autoCreatePR,
      workOnCurrentBranch,
    });

    const run = {
      id: newId(),
      commentId,
      commentIds: commentIds.length ? commentIds : commentId ? [commentId] : [],
      scope,
      prompt,
      runtime: started.runtime,
      agentId: started.agentId,
      runId: started.runId,
      status: started.status || 'running',
      repoUrl: started.repoUrl || resolveRepoUrl(project),
      agentUrl: started.agentUrl || null,
      startedBy: user.id,
      startedByName: user.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (started.runtime === 'cloud') {
      run.deliveryMode = workOnCurrentBranch ? 'main' : 'pr';
    }

    if (!store.cursorRuns) store.cursorRuns = [];
    store.cursorRuns.unshift(run);
    // keep last 50
    store.cursorRuns = store.cursorRuns.slice(0, 50);
    await saveProjectStore(projectId, store);

    return json(
      {
        run,
        message:
          started.runtime === 'cloud'
            ? started.agentUrl
              ? `Cloud agent started. Open it: ${started.agentUrl}`
              : 'Cloud agent started. In Cursor: Filter → Source → SDK (or Agents on the web).'
            : 'Local agent started against your project folder.',
        agentUrl: started.agentUrl || null,
      },
      201
    );
  } catch (err) {
    console.error('[cursor-fix POST]', err);
    return json({ error: err.message || 'Failed to start Cursor agent' }, 500);
  }
}
