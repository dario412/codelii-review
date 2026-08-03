import { getCore, saveCore, newId } from '../lib/store.js';
import { hashPassword, publicUser } from '../lib/password.js';
import { json, corsOptions } from '../lib/http.js';

export async function OPTIONS() {
  return corsOptions('POST, OPTIONS');
}

/**
 * Upsert a password user (agency bootstrap).
 * Auth: x-admin-key must match JWT_SECRET.
 */
export async function POST(request) {
  const key = request.headers.get('x-admin-key') || '';
  const secret = process.env.JWT_SECRET || '';
  if (!secret || key !== secret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const password = String(body.password || '');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Valid email is required' }, 400);
  }
  if (!name || name.length < 2) {
    return json({ error: 'Name is required (min 2 characters)' }, 400);
  }
  if (!password || password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, 400);
  }

  const core = await getCore();
  let user = core.users.find((u) => u.email === email);
  let created = false;

  if (user) {
    user.name = name;
    user.passwordHash = await hashPassword(password);
  } else {
    created = true;
    user = {
      id: newId(),
      email,
      name,
      passwordHash: await hashPassword(password),
      googleSub: null,
      avatar: null,
      createdAt: new Date().toISOString(),
    };
    core.users.push(user);
  }

  await saveCore(core);

  return json({
    ok: true,
    created,
    updated: !created,
    user: publicUser(user),
  });
}
