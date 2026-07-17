import { getCore, findProject, isMember } from './lib/store.js';
import { getUser } from './lib/auth.js';
import { rewriteHtml, rewriteCss, sameSite } from './lib/inject.js';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function parseProxyPath(url) {
  const u = new URL(url);
  const m = u.pathname.match(/^\/p\/([^/]+)(?:\/(.*))?$/);
  if (m) {
    return { projectId: m[1], path: m[2] || '', search: u.search };
  }
  // Vercel / local rewrite: /api/proxy?projectId=&path=
  const projectId = u.searchParams.get('projectId');
  let path = u.searchParams.get('path') || '';
  path = decodeURIComponent(path).replace(/^\/+/, '');
  // Preserve extra query params beyond projectId/path for upstream
  const passthrough = new URLSearchParams(u.searchParams);
  passthrough.delete('projectId');
  passthrough.delete('path');
  const extra = passthrough.toString();
  return {
    projectId,
    path,
    search: extra ? `?${extra}` : '',
  };
}

function joinUrl(base, path, search) {
  const origin = base.replace(/\/$/, '');
  let p = path || '';
  if (!p || p === '') p = '/';
  if (!p.startsWith('/')) p = '/' + p;
  return origin + p + (search || '');
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
  const { projectId, path, search } = parseProxyPath(request.url);

  if (!projectId) {
    return new Response('Missing project', { status: 400 });
  }

  const core = await getCore();
  const project = findProject(core, projectId);
  if (!project || project.type !== 'url') {
    return new Response('Project not found', { status: 404 });
  }

  if (!user || !isMember(project, user.id)) {
    // Redirect to login with return URL
    const returnTo = encodeURIComponent(`/p/${projectId}/${path || ''}${search || ''}`);
    return Response.redirect(new URL(`/login.html?redirect=${returnTo}`, request.url).toString(), 302);
  }

  const target = joinUrl(project.baseUrl, path || project.startPath || '/', search);

  let upstream;
  try {
    upstream = await fetch(target, {
      redirect: 'manual',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: request.headers.get('accept') || '*/*',
        'Accept-Language': request.headers.get('accept-language') || 'en-US,en;q=0.9',
      },
    });
  } catch (err) {
    return new Response(`Failed to fetch upstream: ${err.message}`, { status: 502 });
  }

  // Follow same-site redirects (treats www.example.com and example.com as the same site)
  if ([301, 302, 303, 307, 308].includes(upstream.status)) {
    const loc = upstream.headers.get('location');
    if (loc) {
      try {
        const next = new URL(loc, target);
        if (sameSite(next.toString(), project.baseUrl)) {
          // Remember the canonical origin (e.g. https://www.example.com) for future fetches
          if (next.origin !== new URL(project.baseUrl).origin) {
            project.baseUrl = next.origin;
            const { saveCore } = await import('./lib/store.js');
            await saveCore(core).catch(() => {});
          }
          const proxied = `/p/${projectId}${next.pathname}${next.search}`;
          return Response.redirect(new URL(proxied, request.url).toString(), 302);
        }
        return Response.redirect(next.toString(), 302);
      } catch {
        /* fall through */
      }
    }
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const buf = Buffer.from(await upstream.arrayBuffer());

  if (contentType.includes('text/html')) {
    let html = buf.toString('utf8');
    html = rewriteHtml(html, project);
    return new Response(html, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (contentType.includes('text/css')) {
    const css = rewriteCss(buf.toString('utf8'), project);
    return new Response(css, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  return new Response(buf, {
    status: upstream.status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
    },
  });
}
