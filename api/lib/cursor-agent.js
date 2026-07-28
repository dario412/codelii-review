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
export async function startCursorFix({ project, prompt, mode }) {
  const key = apiKey();
  const modelId = process.env.CURSOR_MODEL?.trim() || 'composer-2.5';
  const runtime = mode || (project.localPath ? 'local' : 'cloud');

  if (runtime === 'local') {
    return startLocalFix({ key, modelId, project, prompt });
  }

  return startCloudFixRest({ key, modelId, project, prompt });
}

async function startCloudFixRest({ key, modelId, project, prompt }) {
  const repoUrl = resolveRepoUrl(project);
  if (!repoUrl) {
    throw new Error(
      'Cloud Fix needs a GitHub repo. Use a GitHub project, or set Repo URL in Settings.'
    );
  }

  // Always open a PR on a new branch. Direct push to main is intentionally not
  // offered — undo and review both depend on GitHub's PR diff.
  const body = {
    prompt: { text: prompt },
    model: { id: modelId },
    repos: [
      {
        url: repoUrl,
        startingRef: project.repoRef || 'main',
      },
    ],
    autoCreatePR: true,
    workOnCurrentBranch: false,
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
    deliveryMode: 'pr',
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
        let branch = null;
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
              const primary = branches.find((b) => b.prUrl) || branches[0] || null;
              prUrl = primary?.prUrl || null;
              branch = primary?.branch || null;
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
          branch,
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

/**
 * Lightweight file-change preview via GitHub's compare API.
 * Works unauthenticated for public repos; private repos need GITHUB_TOKEN.
 */
export async function fetchComparePreview({ repoUrl, baseRef, branch }) {
  if (!repoUrl || !branch) return null;
  const parsed = String(repoUrl)
    .replace(/^https?:\/\//i, '')
    .replace(/^github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/$/, '');
  const [owner, repo] = parsed.split('/');
  if (!owner || !repo) return null;

  const base = encodeURIComponent(baseRef || 'main');
  const head = encodeURIComponent(branch);
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'codelii-review',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`,
      { headers }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const files = (data.files || []).slice(0, 40).map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions || 0,
      deletions: f.deletions || 0,
    }));
    return {
      compareUrl: `https://github.com/${owner}/${repo}/compare/${base}...${head}?expand=1`,
      aheadBy: data.ahead_by || 0,
      total: data.files?.length || files.length,
      additions: data.files?.reduce((n, f) => n + (f.additions || 0), 0) || 0,
      deletions: data.files?.reduce((n, f) => n + (f.deletions || 0), 0) || 0,
      files,
    };
  } catch (err) {
    console.warn('[cursor] compare preview failed:', err.message);
    return null;
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
