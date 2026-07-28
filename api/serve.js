import { getCore, findProject, isMember, getProjectFile, guessContentType } from './lib/store.js';
import { getUser } from './lib/auth.js';
import { rewriteHtml, rewriteCss } from './lib/inject.js';

function parseServePath(url) {
  const u = new URL(url);
  const m = u.pathname.match(/^\/s\/([^/]+)(?:\/(.*))?$/);
  if (m) {
    return { projectId: m[1], path: decodeURIComponent(m[2] || '') };
  }
  return {
    projectId: u.searchParams.get('projectId'),
    path: decodeURIComponent(u.searchParams.get('path') || '').replace(/^\/+/, ''),
  };
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function GET(request) {
  const user = await getUser(request);
  let { projectId, path } = parseServePath(request.url);

  if (!projectId) {
    return new Response('Missing project', { status: 400 });
  }

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || project.type !== 'github') {
    return new Response('Project not found', { status: 404 });
  }

  if (!user || !isMember(project, user.id)) {
    const returnTo = encodeURIComponent(`/s/${projectId}/${path || ''}`);
    return Response.redirect(new URL(`/login.html?redirect=${returnTo}`, request.url).toString(), 302);
  }

  if (project.status === 'error') {
    return new Response(`Import failed: ${project.error || 'unknown error'}`, { status: 422 });
  }
  if (project.status === 'ingesting') {
    return new Response('Still importing repository… refresh in a moment.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '3' },
    });
  }

  path = (path || '').replace(/^\/+/, '');
  if (!path || path.endsWith('/')) path = `${path}index.html`.replace(/^\/+/, '');

  let file = await getProjectFile(projectId, path);
  if (!file && !path.includes('.')) {
    file = await getProjectFile(projectId, `${path}/index.html`);
  }
  if (!file) {
    return new Response('File not found', { status: 404 });
  }

  const contentType = file.contentType || guessContentType(path);

  if (contentType.includes('text/html')) {
    let html = file.buffer.toString('utf8');
    // For snapshots, inject overlay; light rewrite so relative assets stay under /s/
    html = rewriteHtml(html, { ...project, baseUrl: `https://snapshot.local` }, user);
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (contentType.includes('text/css')) {
    const css = rewriteCss(file.buffer.toString('utf8'), {
      ...project,
      baseUrl: `https://snapshot.local`,
    });
    return new Response(css, {
      status: 200,
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  return new Response(file.buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
