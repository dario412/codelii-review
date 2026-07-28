/**
 * Public share-link flow.
 *
 * GET  /api/share?token=…  → minimal, unauthenticated preview of a share link
 * POST /api/share          → join as a guest with just a name + email
 *
 * Both are deliberately unauthenticated: the link itself is the credential.
 * Email invites are not joinable here — those stay restricted to their
 * recipient and go through /api/invites once the person is signed in.
 */
import { getCore, saveCore, newId } from './lib/store.js';
import { createToken, sessionCookie } from './lib/auth.js';
import { publicUser } from './lib/password.js';
import { json, corsOptions } from './lib/http.js';

export async function OPTIONS() {
  return corsOptions('GET, POST, OPTIONS');
}

function viewUrl(project) {
  return project.type === 'github' ? `/s/${project.id}/` : `/p/${project.id}/`;
}

function linkProject(core, token) {
  if (!token) return null;
  return core.projects.find((p) => p.linkToken === token) || null;
}

function isEmailInvite(core, token) {
  return core.projects.some((p) => (p.invites || []).some((i) => i.token === token));
}

/** Preview a token so join.html knows which gate to show. */
export async function GET(request) {
  const token = (new URL(request.url).searchParams.get('token') || '').trim();
  if (!token) return json({ error: 'token required' }, 400);

  const core = await getCore();

  const project = linkProject(core, token);
  if (project) {
    return json({
      type: 'link',
      // Off means the owner revoked open access; the link is dead until re-enabled.
      allowed: project.linkAccess !== false,
      projectName: project.name,
    });
  }

  // Never reveal the recipient's address for an email invite.
  if (isEmailInvite(core, token)) return json({ type: 'email' });

  return json({ error: 'This link is not valid' }, 404);
}

/** Join a shared project as a guest: name + email, no password. */
export async function POST(request) {
  try {
    const body = await request.json();
    const token = (body.token || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const name = (body.name || '').trim();

    if (!token) return json({ error: 'token required' }, 400);
    if (!name || name.length < 2) return json({ error: 'Please enter your name' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Please enter a valid email address' }, 400);
    }

    const core = await getCore();
    const project = linkProject(core, token);
    if (!project) return json({ error: 'This link is not valid' }, 404);
    if (project.linkAccess === false) {
      return json({ error: 'Link sharing is turned off for this project' }, 403);
    }

    let user = core.users.find((u) => u.email === email);

    // An email that already owns a real account can only be used by signing in —
    // otherwise anyone with the link could type the owner's address and become them.
    if (user && !user.guest) {
      return json(
        {
          needsSignIn: true,
          error: 'This email already has an account. Sign in to join the project.',
        },
        409
      );
    }

    if (!user) {
      user = {
        id: newId(),
        email,
        name,
        passwordHash: null,
        googleSub: null,
        avatar: null,
        guest: true,
        createdAt: new Date().toISOString(),
      };
      core.users.push(user);
    } else if (name && name !== user.name) {
      user.name = name;
    }

    if (!project.memberIds.includes(user.id)) project.memberIds.push(user.id);
    await saveCore(core);

    const sessionToken = await createToken(user);
    return new Response(
      JSON.stringify({
        user: publicUser(user),
        token: sessionToken,
        project: { id: project.id, name: project.name, viewUrl: viewUrl(project) },
      }),
      {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': sessionCookie(sessionToken),
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (err) {
    console.error('[share POST]', err);
    return json({ error: err.message || 'Could not join project' }, 500);
  }
}
