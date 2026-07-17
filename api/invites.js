import { getCore, saveCore, findProject, isMember, isOwner, newId } from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';

export async function OPTIONS() {
  return corsOptions();
}

async function sendInviteEmail(to, project, inviteUrl, inviterName) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  if (!apiKey) {
    console.log(`[invite] Would email ${to}: ${inviteUrl}`);
    return;
  }
  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `${inviterName} invited you to review ${project.name}`,
    html: `
      <div style="font-family: Inter, sans-serif; max-width: 520px;">
        <p><strong>${escapeHtml(inviterName)}</strong> invited you to collaborate on <strong>${escapeHtml(project.name)}</strong>.</p>
        <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 20px;background:#B8FF54;color:#002B2B;border-radius:999px;text-decoration:none;font-weight:700;">Join project</a></p>
        <p style="color:#666;font-size:13px;">Or open: ${escapeHtml(inviteUrl)}</p>
      </div>
    `,
  });
  if (error) {
    console.error('[invite email] Resend error:', error.message || JSON.stringify(error));
    throw new Error(error.message || 'Failed to send invite email');
  }
  console.log(`[invite] Sent to ${to} id=${data?.id || 'ok'}`);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function siteOrigin(request) {
  return process.env.SITE_URL || new URL(request.url).origin;
}

function viewUrl(project) {
  return project.type === 'github' ? `/s/${project.id}/` : `/p/${project.id}/`;
}

/** POST: create email invite or accept invite/link */
export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json();
  const action = body.action || (body.email ? 'invite' : 'accept');

  const core = await getCore();

  if (action === 'invite') {
    const projectId = body.projectId;
    const email = (body.email || '').trim().toLowerCase();
    if (!projectId || !email) return json({ error: 'projectId and email required' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Valid email required' }, 400);

    const project = findProject(core, projectId);
    if (!project) return json({ error: 'Project not found' }, 404);
    if (!isOwner(project, user.id)) return json({ error: 'Only the owner can invite' }, 403);

    const existingUser = core.users.find((u) => u.email === email);
    if (existingUser && isMember(project, existingUser.id)) {
      return json({ error: 'User is already a member' }, 409);
    }

    if (!project.invites) project.invites = [];
    let invite = project.invites.find((i) => i.email === email && i.status === 'pending');
    if (!invite) {
      invite = {
        id: newId(),
        email,
        token: newId(),
        status: 'pending',
        invitedBy: user.id,
        createdAt: new Date().toISOString(),
      };
      project.invites.push(invite);
    }

    await saveCore(core);

    const inviteUrl = `${siteOrigin(request)}/join.html?token=${encodeURIComponent(invite.token)}`;
    try {
      await sendInviteEmail(email, project, inviteUrl, user.name);
    } catch (err) {
      console.error('[invite email]', err.message);
    }

    return json({ invite: { id: invite.id, email: invite.email, status: invite.status }, inviteUrl }, 201);
  }

  if (action === 'accept') {
    const token = (body.token || '').trim();
    if (!token) return json({ error: 'token required' }, 400);

    // Email invite token
    for (const project of core.projects) {
      const invite = (project.invites || []).find((i) => i.token === token && i.status === 'pending');
      if (invite) {
        if (invite.email !== user.email.toLowerCase()) {
          return json({ error: 'This invite was sent to a different email address' }, 403);
        }
        invite.status = 'accepted';
        if (!project.memberIds.includes(user.id)) project.memberIds.push(user.id);
        await saveCore(core);
        return json({ project: { id: project.id, name: project.name, viewUrl: viewUrl(project) } });
      }
    }

    // Shareable link token
    const project = core.projects.find((p) => p.linkToken === token);
    if (!project) return json({ error: 'Invalid or expired invite' }, 404);
    if (!project.memberIds.includes(user.id)) project.memberIds.push(user.id);
    await saveCore(core);
    return json({ project: { id: project.id, name: project.name, viewUrl: viewUrl(project) } });
  }

  if (action === 'list') {
    const projectId = body.projectId;
    const project = findProject(core, projectId);
    if (!project) return json({ error: 'Project not found' }, 404);
    if (!isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);

    const members = (project.memberIds || [])
      .map((id) => {
        const u = core.users.find((x) => x.id === id);
        if (!u) return null;
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.id === project.ownerId ? 'owner' : 'member',
        };
      })
      .filter(Boolean);

    const invites = isOwner(project, user.id)
      ? (project.invites || [])
          .filter((i) => i.status === 'pending')
          .map((i) => ({ id: i.id, email: i.email, status: i.status, createdAt: i.createdAt }))
      : [];

    return json({
      members,
      invites,
      linkToken: isOwner(project, user.id) ? project.linkToken : null,
      shareUrl: isOwner(project, user.id)
        ? `${siteOrigin(request)}/join.html?token=${encodeURIComponent(project.linkToken)}`
        : null,
    });
  }

  return json({ error: 'Unknown action' }, 400);
}

export async function GET(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'token required' }, 400);

  const core = await getCore();

  for (const project of core.projects) {
    const invite = (project.invites || []).find((i) => i.token === token);
    if (invite) {
      return json({
        type: 'email',
        email: invite.email,
        status: invite.status,
        projectName: project.name,
        projectId: project.id,
      });
    }
  }

  const project = core.projects.find((p) => p.linkToken === token);
  if (project) {
    return json({
      type: 'link',
      status: 'pending',
      projectName: project.name,
      projectId: project.id,
    });
  }

  return json({ error: 'Invalid invite' }, 404);
}
