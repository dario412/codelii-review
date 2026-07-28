/**
 * Inject review overlay scripts into HTML and rewrite absolute/relative URLs for proxy mode.
 */

export function injectOverlay(html, project) {
  const hasSource =
    typeof project.hasSource === 'boolean'
      ? project.hasSource
      : project.type === 'github';
  const ctx = {
    id: project.id,
    name: project.name,
    type: project.type,
    source: project.source,
    baseUrl: project.baseUrl || null,
    hasSource,
    repoUrl: project.repoUrl || (project.type === 'github' ? project.source : null),
    localPath: project.localPath || null,
    autoCreatePR: project.autoCreatePR !== false,
    viewPrefix: project.type === 'github' ? `/s/${project.id}` : `/p/${project.id}`,
  };

  const snippet = `
<!-- Codelii Review Mode -->
<link rel="stylesheet" href="/css/review.css">
<script>window.__REVIEW_PROJECT__=${JSON.stringify(ctx)};</script>
<script src="/js/auth-guard.js"></script>
<script src="/js/cursor-prompts.js"></script>
<script src="/js/review.js" defer></script>
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

export function rewriteHtml(html, project) {
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

  return injectOverlay(out, project);
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
