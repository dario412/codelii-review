import { Agent, CursorAgentError } from '@cursor/sdk';
import { resolveRepoUrl } from './prompts.js';

const CURSOR_API = 'https://api.cursor.com/v1';

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

function authHeader(key) {
  // Cloud Agents API uses Basic auth: key as username, empty password
  const token = Buffer.from(`${key}:`).toString('base64');
  return `Basic ${token}`;
}

/**
 * Start a Cursor agent for a review prompt.
 * Cloud uses the async REST API so the HTTP request returns immediately.
 * Local still uses the SDK against a folder on this machine.
 */
export async function startCursorFix({ project, prompt, mode, autoCreatePR, workOnCurrentBranch }) {
  const key = apiKey();
  const modelId = process.env.CURSOR_MODEL?.trim() || 'composer-2.5';
  const runtime = mode || (project.localPath ? 'local' : 'cloud');

  if (runtime === 'local') {
    return startLocalFix({ key, modelId, project, prompt });
  }

  return startCloudFixRest({ key, modelId, project, prompt, autoCreatePR, workOnCurrentBranch });
}

async function startCloudFixRest({ key, modelId, project, prompt, autoCreatePR, workOnCurrentBranch }) {
  const repoUrl = resolveRepoUrl(project);
  if (!repoUrl) {
    throw new Error(
      'Cloud Fix needs a GitHub repo. Use a GitHub project, or set Repo URL in Settings.'
    );
  }

  const pushToMain = workOnCurrentBranch === true;
  const openPr = pushToMain ? false : autoCreatePR !== false;

  const body = {
    prompt: { text: prompt },
    model: { id: modelId },
    repos: [
      {
        url: repoUrl,
        startingRef: project.repoRef || 'main',
      },
    ],
    autoCreatePR: openPr,
    workOnCurrentBranch: pushToMain,
    skipReviewerRequest: true,
    name: `Codelii · ${project.name}`,
  };

  const res = await fetch(`${CURSOR_API}/agents`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(key),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      (typeof data === 'string' ? data : null) ||
      `Cursor API error ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  const agent = data.agent || data;
  const run = data.run || {};

  return {
    runtime: 'cloud',
    agentId: agent.id,
    runId: run.id || agent.latestRunId || null,
    status: run.status || agent.status || 'CREATING',
    repoUrl,
    agentUrl: agent.url || (agent.id ? `https://cursor.com/agents/${agent.id}` : null),
  };
}

async function startLocalFix({ key, modelId, project, prompt }) {
  const cwd = (project.localPath || '').trim();
  if (!cwd) {
    throw new Error('Set a local folder path in project Settings to run a local Cursor agent');
  }

  const agent = await Agent.create({
    apiKey: key,
    model: { id: modelId },
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
    // Don't block forever on dispose
    Promise.resolve(agent[Symbol.asyncDispose]?.()).catch(() => {});
  }
}

export async function getCursorRunStatus({ agentId, runId, runtime, localPath }) {
  const key = apiKey();

  if (runtime !== 'local' && agentId) {
    try {
      const res = await fetch(`${CURSOR_API}/agents/${encodeURIComponent(agentId)}`, {
        headers: { Authorization: authHeader(key) },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const agent = data.agent || data;
        let runStatus = null;
        let prUrl = null;
        let resultText = null;

        const activeRunId = runId || agent.latestRunId;
        if (activeRunId) {
          try {
            const runRes = await fetch(
              `${CURSOR_API}/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(activeRunId)}`,
              { headers: { Authorization: authHeader(key) } }
            );
            const runData = await runRes.json().catch(() => ({}));
            if (runRes.ok) {
              const run = runData.run || runData;
              runStatus = run.status;
              resultText = run.summary || run.result || null;
              const branches = run.git?.branches || agent.git?.branches || [];
              prUrl = branches.find((b) => b.prUrl)?.prUrl || null;
            }
          } catch {
            /* ignore */
          }
        }

        return {
          agentId,
          runId: activeRunId,
          status: runStatus || agent.status || 'unknown',
          name: agent.name,
          agentUrl: agent.url || `https://cursor.com/agents/${agentId}`,
          prUrl,
          resultText,
        };
      }
    } catch (err) {
      console.warn('[cursor] REST get failed:', err.message);
    }
  }

  // Local / SDK fallback
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
    if (!(err instanceof CursorAgentError)) {
      console.warn('[cursor] Agent.get failed:', err.message);
    }
  }

  return { agentId, runId, status: 'unknown' };
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
