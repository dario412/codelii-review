/**
 * Inject review overlay scripts into HTML and rewrite absolute/relative URLs for proxy mode.
 */
import { canUseCursorTools } from './permissions.js';

export function injectOverlay(html, project, viewer) {
  const hasSource =
    typeof project.hasSource === 'boolean'
      ? project.hasSource
      : project.type === 'github';
  const cursorTools = canUseCursorTools(project, viewer);

  const ctx = {
    canUseCursorTools: cursorTools,
    // Project owner can moderate comments (delete / hide). Not a full role system.
    isOwner: Boolean(viewer && project.ownerId === viewer.id),
    id: project.id,
    name: project.name,
    type: project.type,
    source: project.source,
    baseUrl: project.baseUrl || null,
    hasSource,
    viewPrefix: project.type === 'github' ? `/s/${project.id}` : `/p/${project.id}`,
  };

  // Repo and local folder paths only drive the Cursor tools, so clients never
  // receive them — nor the prompt builder that reads them.
  if (cursorTools) {
    ctx.repoUrl = project.repoUrl || (project.type === 'github' ? project.source : null);
    ctx.localPath = project.localPath || null;
    ctx.autoCreatePR = project.autoCreatePR !== false;
  }

  const scripts = [
    '<script src="/js/auth-guard.js"></script>',
    cursorTools ? '<script src="/js/cursor-prompts.js"></script>' : null,
    '<script src="/js/review.js" defer></script>',
  ]
    .filter(Boolean)
    .join('\n');

  const snippet = `
<!-- Codelii Review Mode -->
<link rel="stylesheet" href="/css/review.css">
<script>window.__REVIEW_PROJECT__=${JSON.stringify(ctx)};</script>
${scripts}
`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${snippet}\n</body>`);
  }
  return html + snippet;
}

function normalizeHost(host) {
  return (host || '').toLowerCase().replace(/^www\./, '');
}

export function sameSite(urlA, urlB) {
  try {
    return normalizeHost(new URL(urlA).host) === normalizeHost(new URL(urlB).host);
  } catch {
    return false;
  }
}

function isSameOrigin(href, baseOrigin) {
  try {
    let u;
    if (href.startsWith('//')) u = new URL(`https:${href}`);
    else if (/^https?:\/\//i.test(href)) u = new URL(href);
    else return true; // relative or root-relative
    return normalizeHost(u.host) === normalizeHost(new URL(baseOrigin).host);
  } catch {
    return false;
  }
}

function rewriteUrl(href, projectId, baseOrigin, mode) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href.startsWith('data:') || href.startsWith('blob:')) {
    return href;
  }

  const prefix = mode === 'github' ? `/s/${projectId}` : `/p/${projectId}`;

  // Already rewritten or app-owned path
  if (
    href === prefix ||
    href.startsWith(`${prefix}/`) ||
    href.startsWith('/css/') ||
    href.startsWith('/js/') ||
    href.startsWith('/api/') ||
    href.startsWith('/login') ||
    href.startsWith('/dashboard')
  ) {
    return href;
  }

  try {
    if (href.startsWith('//')) {
      const u = new URL(`https:${href}`);
      if (!isSameOrigin(href, baseOrigin)) return href;
      return `${prefix}${u.pathname}${u.search}${u.hash}`;
    }
    if (/^https?:\/\//i.test(href)) {
      const u = new URL(href);
      if (!isSameOrigin(href, baseOrigin)) return href;
      return `${prefix}${u.pathname}${u.search}${u.hash}`;
    }
    if (href.startsWith('/')) {
      return `${prefix}${href}`;
    }
    // relative — leave for browser; <base> resolves it
    return href;
  } catch {
    return href;
  }
}

export function rewriteHtml(html, project, viewer) {
  const projectId = project.id;
  const baseOrigin = project.baseUrl || '';
  const mode = project.type === 'github' ? 'github' : 'url';
  const prefix = mode === 'github' ? `/s/${projectId}` : `/p/${projectId}`;

  let out = html;

  // Strip CSP that could block the overlay
  out = out.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');

  // Remove existing base tags — we set ours after rewrites
  out = out.replace(/<base[^>]*>/gi, '');

  // Strip subresource integrity — rewritten same-origin assets would fail the hash
  out = out.replace(/\sintegrity=["'][^"']*["']/gi, '');

  // Rewrite href/src/action attributes (same-origin only; external URLs untouched)
  out = out.replace(/\b(href|src|action)=["']([^"']+)["']/gi, (match, attr, url) => {
    const next = rewriteUrl(url, projectId, baseOrigin, mode);
    if (next === url) return match;
    return `${attr}="${next}"`;
  });

  // Open external anchor links in a new tab (anchors only — never <link>/<script>)
  if (mode === 'url' && baseOrigin) {
    out = out.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
      const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
      if (!hrefMatch) return match;
      const href = hrefMatch[1];
      if (!/^(https?:)?\/\//i.test(href)) return match;
      if (isSameOrigin(href, baseOrigin)) return match;
      if (/\btarget=/i.test(attrs)) return match;
      return `<a${attrs} target="_blank">`;
    });
  }

  // srcset
  out = out.replace(/\bsrcset=["']([^"']+)["']/gi, (match, value) => {
    const parts = value.split(',').map((part) => {
      const trimmed = part.trim();
      const [u, ...rest] = trimmed.split(/\s+/);
      const next = rewriteUrl(u, projectId, baseOrigin, mode);
      return [next, ...rest].join(' ');
    });
    return `srcset="${parts.join(', ')}"`;
  });

  // CSS url()
  out = out.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (match, quote, url) => {
    if (url.startsWith('data:')) return match;
    const next = rewriteUrl(url.trim(), projectId, baseOrigin, mode);
    return `url(${quote}${next}${quote})`;
  });

  // Set <base> last so it is not rewritten
  const baseTag = `<base href="${prefix}/">`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  } else {
    out = baseTag + out;
  }

  return injectOverlay(out, project, viewer);
}

export function rewriteCss(css, project) {
  const projectId = project.id;
  const baseOrigin = project.baseUrl || '';
  const mode = project.type === 'github' ? 'github' : 'url';
  return css.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (match, quote, url) => {
    if (url.startsWith('data:')) return match;
    const next = rewriteUrl(url.trim(), projectId, baseOrigin, mode);
    return `url(${quote}${next}${quote})`;
  });
}
