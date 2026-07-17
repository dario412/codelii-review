import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getCore, saveCore, newId } from '../lib/store.js';
import { createToken, sessionCookie } from '../lib/auth.js';
import { publicUser } from '../lib/password.js';
import { json, corsOptions } from '../lib/http.js';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export async function OPTIONS() {
  return corsOptions('POST, OPTIONS');
}

export async function POST(request) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return json({ error: 'Google sign-in is not configured' }, 503);
    }

    const body = await request.json();
    const credential = body.credential || body.idToken;
    if (!credential) {
      return json({ error: 'Google credential is required' }, 400);
    }

    const { payload } = await jwtVerify(credential, jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
    });

    const email = (payload.email || '').toLowerCase();
    const googleSub = payload.sub;
    const name = (payload.name || email.split('@')[0] || 'User').trim();
    const avatar = payload.picture || null;

    if (!email || !googleSub) {
      return json({ error: 'Invalid Google token' }, 400);
    }

    const core = await getCore();
    let user =
      core.users.find((u) => u.googleSub === googleSub) ||
      core.users.find((u) => u.email === email);

    if (!user) {
      user = {
        id: newId(),
        email,
        name,
        passwordHash: null,
        googleSub,
        avatar,
        createdAt: new Date().toISOString(),
      };
      core.users.push(user);
    } else {
      user.googleSub = googleSub;
      user.name = name || user.name;
      if (avatar) user.avatar = avatar;
    }

    await saveCore(core);
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
    console.error('[google auth]', err.message);
    return json({ error: 'Google sign-in failed' }, 401);
  }
}
