import { putProjectFile } from './store.js';

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXT = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'map',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'txt', 'md', 'xml', 'webmanifest',
]);

export function parseGitHubUrl(input) {
  const raw = (input || '').trim().replace(/\.git$/, '');
  let owner;
  let repo;
  let ref = 'HEAD';

  const urlMatch = raw.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)(?:\/(?:tree|blob)\/([^/#?]+))?/i
  );
  if (urlMatch) {
    owner = urlMatch[1];
    repo = urlMatch[2];
    if (urlMatch[3]) ref = urlMatch[3];
  } else {
    const short = raw.match(/^([^/\s]+)\/([^/\s#?]+)$/);
    if (!short) return null;
    owner = short[1];
    repo = short[2];
  }

  if (!owner || !repo || owner === 'http:' || owner === 'https:') return null;
  return { owner, repo, ref };
}

function contentTypeFor(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  const map = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    txt: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}

async function gunzip(buffer) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([buffer]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return Buffer.from(ab);
  }
  const { gunzipSync } = await import('zlib');
  return gunzipSync(buffer);
}

function parseTar(buffer) {
  const files = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeOctal, 8) || 0;
    const typeFlag = String.fromCharCode(header[156] || 0);
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const fullName = prefix ? `${prefix}/${name}` : name;

    offset += 512;
    if (typeFlag === '0' || typeFlag === '\0') {
      const content = buffer.subarray(offset, offset + size);
      files.push({ name: fullName, content: Buffer.from(content) });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

function stripRoot(name) {
  // GitHub tarballs: owner-repo-sha/...
  const idx = name.indexOf('/');
  return idx === -1 ? name : name.slice(idx + 1);
}

export async function ingestGitHubRepo(projectId, owner, repo, ref = 'HEAD') {
  const refsToTry = ref === 'HEAD' ? ['HEAD', 'main', 'master'] : [ref];
  let tarGz = null;
  let lastErr = null;

  for (const r of refsToTry) {
    const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${r}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Codelii-Review/1.0' },
        redirect: 'follow',
      });
      if (!res.ok) {
        lastErr = new Error(`GitHub returned ${res.status} for ${owner}/${repo}@${r}`);
        continue;
      }
      const ab = await res.arrayBuffer();
      if (ab.byteLength > MAX_BYTES) {
        throw new Error('Repository is too large (max 50 MB compressed)');
      }
      tarGz = Buffer.from(ab);
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!tarGz) {
    throw lastErr || new Error('Could not download repository. Is it public?');
  }

  const tar = await gunzip(tarGz);
  const entries = parseTar(tar);
  let hasIndex = false;
  let total = 0;
  let stored = 0;

  for (const entry of entries) {
    const rel = stripRoot(entry.name);
    if (!rel || rel.endsWith('/')) continue;
    if (rel.includes('..')) continue;
    const ext = rel.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;

    total += entry.content.length;
    if (total > MAX_BYTES * 2) {
      throw new Error('Extracted files exceed size limit');
    }

    await putProjectFile(projectId, rel, entry.content, contentTypeFor(rel));
    stored++;
    if (rel === 'index.html' || rel.endsWith('/index.html')) hasIndex = true;
  }

  if (!stored) {
    throw new Error('No static files found in this repository');
  }
  if (!hasIndex) {
    throw new Error('No index.html found — only static sites are supported in V1');
  }

  return { files: stored };
}
