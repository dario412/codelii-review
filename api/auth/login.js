import { getCore, saveCore } from '../lib/store.js';
import { verifyPassword, publicUser } from '../lib/password.js';
import { createToken, sessionCookie, clearCookie, getUser } from '../lib/auth.js';
import { json, corsOptions } from '../lib/http.js';

export async function OPTIONS() {
  return corsOptions('POST, DELETE, OPTIONS');
}

export async function POST(request) {
  try {
    const body = await request.json();
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    if (!email || !password) {
      return json({ error: 'Email and password are required' }, 400);
    }

    const core = await getCore();
    const user = core.users.find((u) => u.email === email);
    if (!user) {
      return json({ error: 'Invalid email or password' }, 401);
    }

    if (!user.passwordHash) {
      return json({ error: 'This account uses Google sign-in. Continue with Google.' }, 400);
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return json({ error: 'Invalid email or password' }, 401);
    }

    const token = await createToken(user);
    return new Response(JSON.stringify({ user: publicUser(user), token }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': sessionCookie(token),
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return json({ error: err.message || 'Login failed' }, 500);
  }
}

export async function DELETE(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearCookie(),
      'Access-Control-Allow-Origin': '*',
    },
  });
}
