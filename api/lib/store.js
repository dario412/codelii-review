import { put, get, del, list } from '@vercel/blob';

const CORE_PATH = 'review-data/core.json';
const EMPTY_CORE = { users: [], projects: [] };
const EMPTY_PROJECT = { comments: [], notifications: [], presence: {}, cursorRuns: [] };

function isVercel() {
  return Boolean(process.env.VERCEL);
}

function blobOpts() {
  const opts = { access: 'private', useCache: false };
  if (process.env.BLOB_STORE_ID) opts.storeId = process.env.BLOB_STORE_ID;
  if (process.env.BLOB_READ_WRITE_TOKEN) opts.token = process.env.BLOB_READ_WRITE_TOKEN;
  return opts;
}

function hasBlobStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function requireBlobStorage() {
  if (!hasBlobStorage()) {
    throw new Error(
      'Blob storage is not connected. In Vercel: Storage → Blob → Connect to project, then redeploy.'
    );
  }
}

function normalizeCore(raw) {
  return {
    users: Array.isArray(raw?.users) ? raw.users : [],
    projects: Array.isArray(raw?.projects) ? raw.projects : [],
  };
}

function normalizeProject(raw) {
  return {
    comments: Array.isArray(raw?.comments) ? raw.comments : [],
    notifications: Array.isArray(raw?.notifications) ? raw.notifications : [],
    presence: raw?.presence && typeof raw.presence === 'object' ? raw.presence : {},
    cursorRuns: Array.isArray(raw?.cursorRuns) ? raw.cursorRuns : [],
  };
}

async function streamToText(stream) {
  const reader = stream.getReader();
  const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const length = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(bytes);
}

async function streamToBuffer(stream) {
  const reader = stream.getReader();
  const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const length = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return Buffer.from(bytes);
}

function localDataDir() {
  return import('path').then(async ({ join, dirname }) => {
    const { fileURLToPath } = await import('url');
    return join(dirname(fileURLToPath(import.meta.url)), '../../data');
  });
}

async function readJsonBlob(path, empty) {
  requireBlobStorage();
  const opts = blobOpts();
  try {
    const result = await get(path, opts);
    if (!result || result.statusCode !== 200 || !result.stream) {
      return structuredClone(empty);
    }
    const text = await streamToText(result.stream);
    if (!text) return structuredClone(empty);
    return JSON.parse(text);
  } catch (err) {
    console.error(`[store] read ${path} failed:`, err.message);
    return structuredClone(empty);
  }
}

async function writeJsonBlob(path, data) {
  requireBlobStorage();
  await put(path, JSON.stringify(data), {
    ...blobOpts(),
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function readLocalJson(relPath, empty) {
  const { readFile, writeFile, mkdir } = await import('fs/promises');
  const { existsSync } = await import('fs');
  const { join, dirname } = await import('path');
  const dir = await localDataDir();
  const full = join(dir, relPath);
  try {
    if (!existsSync(full)) {
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, JSON.stringify(empty, null, 2));
      return structuredClone(empty);
    }
    return JSON.parse(await readFile(full, 'utf-8'));
  } catch {
    return structuredClone(empty);
  }
}

async function writeLocalJson(relPath, data) {
  const { writeFile, mkdir } = await import('fs/promises');
  const { join, dirname } = await import('path');
  const dir = await localDataDir();
  const full = join(dir, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(data, null, 2));
}

function useBlob() {
  return isVercel() || hasBlobStorage();
}

export async function getCore() {
  let raw;
  if (useBlob()) {
    raw = await readJsonBlob(CORE_PATH, EMPTY_CORE);
  } else {
    raw = await readLocalJson('core.json', EMPTY_CORE);
  }
  return normalizeCore(raw);
}

export async function saveCore(data) {
  const payload = normalizeCore(data);
  if (useBlob()) {
    await writeJsonBlob(CORE_PATH, payload);
  } else {
    await writeLocalJson('core.json', payload);
  }
  return payload;
}

function projectPath(projectId) {
  return `review-data/projects/${projectId}.json`;
}

function projectLocalRel(projectId) {
  return `projects/${projectId}.json`;
}

export async function getProjectStore(projectId) {
  let raw;
  if (useBlob()) {
    raw = await readJsonBlob(projectPath(projectId), EMPTY_PROJECT);
  } else {
    raw = await readLocalJson(projectLocalRel(projectId), EMPTY_PROJECT);
  }
  return normalizeProject(raw);
}

export async function saveProjectStore(projectId, data) {
  const payload = normalizeProject(data);
  if (useBlob()) {
    await writeJsonBlob(projectPath(projectId), payload);
  } else {
    await writeLocalJson(projectLocalRel(projectId), payload);
  }
  return payload;
}

export async function deleteProjectStore(projectId) {
  if (useBlob()) {
    try {
      await del(projectPath(projectId), blobOpts());
    } catch {
      /* ignore */
    }
    try {
      const prefix = `projects/${projectId}/files/`;
      const listed = await list({ prefix, ...blobOpts() });
      for (const blob of listed.blobs || []) {
        await del(blob.url, blobOpts());
      }
    } catch {
      /* ignore */
    }
  } else {
    const { rm } = await import('fs/promises');
    const { join } = await import('path');
    const dir = await localDataDir();
    try {
      await rm(join(dir, projectLocalRel(projectId)), { force: true });
    } catch {
      /* ignore */
    }
    try {
      await rm(join(dir, 'files', projectId), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export async function putProjectFile(projectId, relPath, content, contentType) {
  const clean = relPath.replace(/^\/+/, '');
  if (useBlob()) {
    const path = `projects/${projectId}/files/${clean}`;
    await put(path, content, {
      ...blobOpts(),
      contentType: contentType || 'application/octet-stream',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return path;
  }
  const { writeFile, mkdir } = await import('fs/promises');
  const { join, dirname } = await import('path');
  const dir = await localDataDir();
  const full = join(dir, 'files', projectId, clean);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
  return full;
}

export async function getProjectFile(projectId, relPath) {
  const clean = relPath.replace(/^\/+/, '') || 'index.html';
  if (useBlob()) {
    requireBlobStorage();
    const path = `projects/${projectId}/files/${clean}`;
    try {
      const result = await get(path, blobOpts());
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      return {
        buffer: await streamToBuffer(result.stream),
        contentType: result.blob?.contentType || guessContentType(clean),
      };
    } catch {
      return null;
    }
  }
  const { readFile } = await import('fs/promises');
  const { existsSync } = await import('fs');
  const { join } = await import('path');
  const dir = await localDataDir();
  const full = join(dir, 'files', projectId, clean);
  if (!existsSync(full)) return null;
  return {
    buffer: await readFile(full),
    contentType: guessContentType(clean),
  };
}

export function guessContentType(path) {
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
    map: 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}

export function findProject(core, projectId) {
  return core.projects.find((p) => p.id === projectId) || null;
}

export function isMember(project, userId) {
  if (!project || !userId) return false;
  if (project.ownerId === userId) return true;
  return Array.isArray(project.memberIds) && project.memberIds.includes(userId);
}

export function isOwner(project, userId) {
  return Boolean(project && project.ownerId === userId);
}

export function publicProject(project, users = []) {
  const owner = users.find((u) => u.id === project.ownerId);
  const hasSource =
    typeof project.hasSource === 'boolean'
      ? project.hasSource
      : project.type === 'github';
  return {
    id: project.id,
    name: project.name,
    type: project.type,
    source: project.source,
    hasSource,
    repoUrl: project.repoUrl || (project.type === 'github' ? project.source : null),
    repoRef: project.repoRef || 'main',
    localPath: project.localPath || null,
    autoCreatePR: project.autoCreatePR !== false,
    ownerId: project.ownerId,
    ownerName: owner?.name || '',
    ownerEmail: owner?.email || '',
    memberIds: project.memberIds || [],
    memberCount: 1 + (project.memberIds || []).filter((id) => id !== project.ownerId).length,
    linkToken: project.linkToken || null,
    createdAt: project.createdAt,
    status: project.status || 'ready',
  };
}

export { newId } from './ids.js';

/** @deprecated Use getCore / getProjectStore. Kept for admin cleanup during transition. */
export async function getStore() {
  const core = await getCore();
  return { users: core.users, comments: [], notifications: [], presence: {} };
}

export async function saveStore() {
  throw new Error('saveStore is deprecated; use saveCore / saveProjectStore');
}
