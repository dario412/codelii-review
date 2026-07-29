import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');

function loadEnvFile(filename) {
  const path = join(ROOT, filename);
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const PORT = Number(process.env.PORT) || 3010;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const API_ROUTES = {
  'POST /api/auth/login': () => import('../api/auth/login.js'),
  'DELETE /api/auth/login': () => import('../api/auth/login.js'),
  'OPTIONS /api/auth/login': () => import('../api/auth/login.js'),
  'POST /api/auth/signup': () => import('../api/auth/signup.js'),
  'OPTIONS /api/auth/signup': () => import('../api/auth/signup.js'),
  'POST /api/auth/google': () => import('../api/auth/google.js'),
  'OPTIONS /api/auth/google': () => import('../api/auth/google.js'),
  'GET /api/auth/config': () => import('../api/auth/config.js'),
  'OPTIONS /api/auth/config': () => import('../api/auth/config.js'),
  'GET /api/auth/me': () => import('../api/auth/me.js'),
  'OPTIONS /api/auth/me': () => import('../api/auth/me.js'),
  'GET /api/projects': () => import('../api/projects.js'),
  'POST /api/projects': () => import('../api/projects.js'),
  'PATCH /api/projects': () => import('../api/projects.js'),
  'DELETE /api/projects': () => import('../api/projects.js'),
  'OPTIONS /api/projects': () => import('../api/projects.js'),
  'GET /api/clients': () => import('../api/clients.js'),
  'POST /api/clients': () => import('../api/clients.js'),
  'PATCH /api/clients': () => import('../api/clients.js'),
  'DELETE /api/clients': () => import('../api/clients.js'),
  'OPTIONS /api/clients': () => import('../api/clients.js'),
  'GET /api/integrations': () => import('../api/integrations.js'),
  'POST /api/integrations': () => import('../api/integrations.js'),
  'DELETE /api/integrations': () => import('../api/integrations.js'),
  'OPTIONS /api/integrations': () => import('../api/integrations.js'),
  'GET /api/pm-start': () => import('../api/pm-start.js'),
  'POST /api/pm-start': () => import('../api/pm-start.js'),
  'OPTIONS /api/pm-start': () => import('../api/pm-start.js'),
  'GET /api/pm-callback': () => import('../api/pm-callback.js'),
  'OPTIONS /api/pm-callback': () => import('../api/pm-callback.js'),
  'POST /api/pm-task': () => import('../api/pm-task.js'),
  'OPTIONS /api/pm-task': () => import('../api/pm-task.js'),
  'GET /api/slack-start': () => import('../api/slack-start.js'),
  'OPTIONS /api/slack-start': () => import('../api/slack-start.js'),
  'GET /api/slack-callback': () => import('../api/slack-callback.js'),
  'OPTIONS /api/slack-callback': () => import('../api/slack-callback.js'),
  'GET /api/billing': () => import('../api/billing.js'),
  'POST /api/billing': () => import('../api/billing.js'),
  'OPTIONS /api/billing': () => import('../api/billing.js'),
  'POST /api/stripe-webhook': () => import('../api/stripe-webhook.js'),
  'GET /api/invites': () => import('../api/invites.js'),
  'POST /api/invites': () => import('../api/invites.js'),
  'OPTIONS /api/invites': () => import('../api/invites.js'),
  'GET /api/share': () => import('../api/share.js'),
  'POST /api/share': () => import('../api/share.js'),
  'OPTIONS /api/share': () => import('../api/share.js'),
  'GET /api/comments': () => import('../api/comments.js'),
  'POST /api/comments': () => import('../api/comments.js'),
  'PATCH /api/comments': () => import('../api/comments.js'),
  'DELETE /api/comments': () => import('../api/comments.js'),
  'OPTIONS /api/comments': () => import('../api/comments.js'),
  'GET /api/users': () => import('../api/users.js'),
  'OPTIONS /api/users': () => import('../api/users.js'),
  'GET /api/notifications': () => import('../api/notifications.js'),
  'PATCH /api/notifications': () => import('../api/notifications.js'),
  'OPTIONS /api/notifications': () => import('../api/notifications.js'),
  'GET /api/presence': () => import('../api/presence.js'),
  'POST /api/presence': () => import('../api/presence.js'),
  'OPTIONS /api/presence': () => import('../api/presence.js'),
  'GET /api/approvals': () => import('../api/approvals.js'),
  'POST /api/approvals': () => import('../api/approvals.js'),
  'DELETE /api/approvals': () => import('../api/approvals.js'),
  'OPTIONS /api/approvals': () => import('../api/approvals.js'),
  'GET /api/activity': () => import('../api/activity.js'),
  'OPTIONS /api/activity': () => import('../api/activity.js'),
  'POST /api/github-issue': () => import('../api/github-issue.js'),
  'OPTIONS /api/github-issue': () => import('../api/github-issue.js'),
  'GET /api/cursor-fix': () => import('../api/cursor-fix.js'),
  'POST /api/cursor-fix': () => import('../api/cursor-fix.js'),
  'OPTIONS /api/cursor-fix': () => import('../api/cursor-fix.js'),
  'POST /api/admin/cleanup': () => import('../api/admin/cleanup.js'),
  'GET /api/screenshots': () => import('../api/screenshots.js'),
  'POST /api/screenshots': () => import('../api/screenshots.js'),
  'DELETE /api/screenshots': () => import('../api/screenshots.js'),
  'OPTIONS /api/screenshots': () => import('../api/screenshots.js'),
  'GET /api/proxy': () => import('../api/proxy.js'),
  'OPTIONS /api/proxy': () => import('../api/proxy.js'),
  'GET /api/serve': () => import('../api/serve.js'),
  'OPTIONS /api/serve': () => import('../api/serve.js'),
};

async function handleApi(req, res, requestUrl) {
  const url = new URL(requestUrl || req.url, `http://localhost:${PORT}`);
  const key = `${req.method} ${url.pathname}`;
  const loader = API_ROUTES[key];

  if (!loader) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const mod = await loader();
  const handler = mod[req.method] || mod[req.method === 'OPTIONS' ? 'OPTIONS' : null];
  if (!handler) {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const body = await readBody(req);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }

  const request = new Request(`http://localhost:${PORT}${url.pathname}${url.search}`, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body,
    redirect: 'manual',
  });

  const response = await handler(request);
  const outHeaders = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, outHeaders);

  if ([301, 302, 303, 307, 308].includes(response.status) && !response.body) {
    res.end();
    return;
  }

  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString() || undefined));
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/join') pathname = '/join.html';

  const filePath = join(ROOT, pathname);

  if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const data = await readFile(filePath);
  const type = MIME[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(data);
}

function rewriteProjectPath(pathname, search) {
  const pMatch = pathname.match(/^\/p\/([^/]+)(?:\/(.*))?$/);
  if (pMatch) {
    const projectId = encodeURIComponent(pMatch[1]);
    const path = encodeURIComponent(pMatch[2] || '');
    return `/api/proxy?projectId=${projectId}&path=${path}${search ? '&' + search.slice(1) : ''}`;
  }
  const sMatch = pathname.match(/^\/s\/([^/]+)(?:\/(.*))?$/);
  if (sMatch) {
    const projectId = encodeURIComponent(sMatch[1]);
    const path = encodeURIComponent(sMatch[2] || '');
    return `/api/serve?projectId=${projectId}&path=${path}${search ? '&' + search.slice(1) : ''}`;
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    const rewritten = rewriteProjectPath(url.pathname, url.search);
    if (rewritten) {
      await handleApi(req, res, rewritten);
      return;
    }

    if (req.url?.startsWith('/api/')) {
      await handleApi(req, res);
    } else {
      await serveStatic(req, res);
    }
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Codelii Review running at http://localhost:${PORT}`);
  console.log(`  Landing:  http://localhost:${PORT}/`);
  console.log(`  Sign in:  http://localhost:${PORT}/login.html\n`);
});
