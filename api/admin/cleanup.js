import { getCore, saveCore } from '../lib/store.js';
import { isTestEmail } from '../lib/cleanup.js';

export async function POST(request) {
  const key = request.headers.get('x-admin-key') || '';
  const secret = process.env.JWT_SECRET || '';
  if (!secret || key !== secret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const core = await getCore();
  const before = core.users.length;
  core.users = core.users.filter((u) => !isTestEmail(u.email));
  await saveCore(core);

  return json({
    ok: true,
    removedUsers: before - core.users.length,
    remainingUsers: core.users.length,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
