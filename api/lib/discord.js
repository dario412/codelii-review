/**
 * Discord incoming webhook notifications.
 * Resolution: project override → client → project owner's account.
 */

const DISCORD_HOOK_RE =
  /^https:\/\/(?:discord(?:app)?\.com|canary\.discord\.com)\/api\/webhooks\//i;

export function isValidDiscordWebhook(url) {
  return DISCORD_HOOK_RE.test(String(url || '').trim());
}

export function normalizeDiscordWebhook(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  if (!isValidDiscordWebhook(u)) {
    throw new Error('Discord webhook must be a discord.com/api/webhooks/… URL');
  }
  return u;
}

export function resolveDiscordWebhook(core, project) {
  if (!project) return null;
  if (project.discordWebhookUrl) return project.discordWebhookUrl;
  if (project.clientId) {
    const client = (core.clients || []).find((c) => c.id === project.clientId);
    if (client?.discordWebhookUrl) return client.discordWebhookUrl;
  }
  const owner = (core.users || []).find((u) => u.id === project.ownerId);
  if (owner?.discord?.webhookUrl) return owner.discord.webhookUrl;
  return null;
}

export function publicDiscordStatus(user) {
  const d = user?.discord;
  if (!d?.webhookUrl) return { connected: false };
  return {
    connected: true,
    label: d.label || null,
    connectedAt: d.connectedAt || null,
  };
}

export async function postDiscord(webhookUrl, { title, body, link, actorName, projectName } = {}) {
  if (!webhookUrl) return false;
  const headline = title || 'Codelii Review update';
  const description = [
    body ? String(body).replace(/\n/g, ' ').slice(0, 280) : null,
    actorName ? `by ${actorName}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const payload = {
    username: 'Codelii Review',
    embeds: [
      {
        title: `${headline} · ${projectName || 'Project'}`,
        description: description || undefined,
        url: link || undefined,
        color: 0x002b2b,
        footer: { text: 'Codelii Review' },
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('[discord]', res.status, errBody.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[discord]', err.message);
    return false;
  }
}
