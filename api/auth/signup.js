import { getCore, saveCore, newId } from '../lib/store.js';
import { hashPassword } from '../lib/password.js';
import { createToken, sessionCookie } from '../lib/auth.js';
import { publicUser } from '../lib/password.js';
import { json, corsOptions } from '../lib/http.js';

export async function OPTIONS() {
  return corsOptions('POST, OPTIONS');
}

export async function POST(request) {
  try {
    const body = await request.json();
    const email = (body.email || '').trim().toLowerCase();
    const name = (body.name || '').trim();
    const password = body.password || '';

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
    if (core.users.find((u) => u.email === email)) {
      return json({ error: 'An account with this email already exists' }, 409);
    }

    const user = {
      id: newId(),
      email,
      name,
      passwordHash: await hashPassword(password),
      googleSub: null,
      avatar: null,
      createdAt: new Date().toISOString(),
    };
    core.users.push(user);
    await saveCore(core);

    const token = await createToken(user);
    const pub = publicUser(user);

    return new Response(JSON.stringify({ user: pub, token }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': sessionCookie(token),
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return json({ error: err.message || 'Signup failed' }, 500);
  }
}
