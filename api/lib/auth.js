import { SignJWT, jwtVerify } from 'jose';

const COOKIE = 'review_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    if (process.env.VERCEL) {
      throw new Error('JWT_SECRET must be set in Vercel environment variables');
    }
    return new TextEncoder().encode('dev-only-secret-change-me!!');
  }
  return new TextEncoder().encode(s);
}

export async function createToken(user) {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export async function verifyToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
    };
  } catch {
    return null;
  }
}

function remember(tokens, value) {
  if (!value) return;
  let token = String(value).trim();
  if (token.toLowerCase().startsWith('bearer ')) token = token.slice(7).trim();
  if (!token || token === 'null' || token === 'undefined') return;
  try {
    token = decodeURIComponent(token);
  } catch {
    /* already decoded */
  }
  if (!tokens.includes(token)) tokens.push(token);
}

/** Every credential the browser might have sent. A bad Authorization must not hide a good cookie. */
export function candidateTokens(req) {
  const tokens = [];
  // Custom header: Vercel rewrites sometimes drop Authorization before the function runs.
  remember(tokens, req.headers.get('x-review-token'));
  remember(tokens, req.headers.get('authorization'));
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (match) remember(tokens, match[1]);
  return tokens;
}

export function parseAuth(req) {
  return candidateTokens(req)[0] || null;
}

export async function getUser(req) {
  for (const token of candidateTokens(req)) {
    const user = await verifyToken(token);
    if (user) return user;
  }
  return null;
}

export function sessionCookie(token) {
  const secure = process.env.VERCEL ? ' Secure;' : '';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE};${secure}`;
}

export function clearCookie() {
  const secure = process.env.VERCEL ? ' Secure;' : '';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0;${secure}`;
}

export { COOKIE, MAX_AGE };
