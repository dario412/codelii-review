import { Agent, CursorAgentError } from '@cursor/sdk';
import { resolveRepoUrl } from './prompts.js';

export function isCursorConfigured() {
  return Boolean(process.env.CURSOR_API_KEY?.trim());
}

function apiKey() {
  const key = process.env.CURSOR_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'CURSOR_API_KEY is not set. Add it in .env.local (local) or Vercel env vars. Get a key at https://cursor.com/dashboard/integrations'
    );
  }
  return key;
}

/**
 * Start a Cursor agent for a review prompt.
 * Returns quickly after send() — does not wait for the full run to finish.
 */
export async function startCursorFix({ project, prompt, mode, autoCreatePR }) {
  const key = apiKey();
  const model = { id: process.env.CURSOR_MODEL?.trim() || 'composer-2.5' };
  const runtime = mode || (project.localPath ? 'local' : 'cloud');

  if (runtime === 'local') {
    const cwd = (project.localPath || '').trim();
    if (!cwd) {
      throw new Error('Set a local folder path in project Settings to run a local Cursor agent');
    }

    const agent = await Agent.create({
      apiKey: key,
      model,
      name: `Codelii · ${project.name}`,
      local: { cwd, settingSources: [] },
    });

    try {
      const run = await agent.send(prompt);
      return {
        runtime: 'local',
        agentId: agent.agentId,
        runId: run.id,
        status: 'running',
      };
    } finally {
      try {
        await agent[Symbol.asyncDispose]();
      } catch {
        /* ignore */
      }
    }
  }

  // Cloud
  const repoUrl = resolveRepoUrl(project);
  if (!repoUrl) {
    throw new Error(
      'Cloud Fix needs a GitHub repo. Use a GitHub project, or set Repo URL in Settings.'
    );
  }

  const agent = await Agent.create({
    apiKey: key,
    model,
    name: `Codelii · ${project.name}`,
    cloud: {
      repos: [{ url: repoUrl, startingRef: project.repoRef || 'main' }],
      autoCreatePR: autoCreatePR !== false,
      skipReviewerRequest: true,
    },
  });

  try {
    const run = await agent.send(prompt);
    return {
      runtime: 'cloud',
      agentId: agent.agentId,
      runId: run.id,
      status: 'running',
      repoUrl,
    };
  } finally {
    try {
      await agent[Symbol.asyncDispose]();
    } catch {
      /* ignore */
    }
  }
}

export async function getCursorRunStatus({ agentId, runId, runtime, localPath }) {
  const key = apiKey();

  try {
    if (agentId) {
      const info = await Agent.get(agentId, { apiKey: key });
      return {
        agentId,
        runId,
        status: info?.status || 'unknown',
        name: info?.name,
        raw: summarizeAgent(info),
      };
    }
  } catch (err) {
    // fall through to getRun
    if (!(err instanceof CursorAgentError)) {
      console.warn('[cursor] Agent.get failed:', err.message);
    }
  }

  if (!runId) {
    return { agentId, runId, status: 'unknown' };
  }

  try {
    const opts = { apiKey: key, runtime: runtime === 'local' ? 'local' : 'cloud' };
    if (agentId) opts.agentId = agentId;
    if (runtime === 'local' && localPath) opts.cwd = localPath;

    const run = await Agent.getRun(runId, opts);
    let status = 'running';
    let resultText = null;
    let prUrl = null;

    if (run.supports?.('conversation')) {
      try {
        const conv = await run.conversation();
        // best-effort extract
        resultText = extractAssistantText(conv);
      } catch {
        /* ignore */
      }
    }

    try {
      // Some run handles expose status via wait with timeout — avoid blocking.
      // Prefer documented fields if present.
      if (typeof run.status === 'string') status = run.status;
    } catch {
      /* ignore */
    }

    return {
      agentId,
      runId,
      status,
      resultText,
      prUrl,
      raw: { id: run.id },
    };
  } catch (err) {
    return {
      agentId,
      runId,
      status: 'unknown',
      error: err.message,
    };
  }
}

function summarizeAgent(info) {
  if (!info || typeof info !== 'object') return null;
  return {
    id: info.agentId || info.id,
    name: info.name,
    status: info.status,
    createdAt: info.createdAt,
  };
}

function extractAssistantText(conv) {
  if (!conv) return null;
  if (typeof conv === 'string') return conv.slice(0, 4000);
  const messages = conv.messages || conv.turns || [];
  if (!Array.isArray(messages)) return null;
  const texts = [];
  for (const m of messages) {
    if (m.type === 'assistant' || m.role === 'assistant') {
      const content = m.message?.content || m.content;
      if (typeof content === 'string') texts.push(content);
      else if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text' && block.text) texts.push(block.text);
        }
      }
    }
  }
  return texts.length ? texts.join('\n\n').slice(0, 4000) : null;
}
