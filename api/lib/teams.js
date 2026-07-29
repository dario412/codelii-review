/**
 * Microsoft Teams incoming webhook (classic connector or Power Automate).
 * Resolution: project override → client → project owner's account.
 */

const TEAMS_HOST_RE =
  /(^|\.)webhook\.office\.com$|(^|\.)office\.com$|(^|\.)logic\.azure\.com$|(^|\.)powerplatform\.com$|(^|\.)powerautomate\.com$/i;

export function isValidTeamsWebhook(url) {
  const u = String(url || '').trim();
  if (!/^https:\/\//i.test(u)) return false;
  try {
    const host = new URL(u).hostname;
    return TEAMS_HOST_RE.test(host);
  } catch {
    return false;
  }
}

export function normalizeTeamsWebhook(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  if (!isValidTeamsWebhook(u)) {
    throw new Error(
      'Teams webhook must be an Outlook/Office, Power Automate, or logic.azure.com HTTPS URL'
    );
  }
  return u;
}

export function resolveTeamsWebhook(core, project) {
  if (!project) return null;
  if (project.teamsWebhookUrl) return project.teamsWebhookUrl;
  if (project.clientId) {
    const client = (core.clients || []).find((c) => c.id === project.clientId);
    if (client?.teamsWebhookUrl) return client.teamsWebhookUrl;
  }
  const owner = (core.users || []).find((u) => u.id === project.ownerId);
  if (owner?.teams?.webhookUrl) return owner.teams.webhookUrl;
  return null;
}

export function publicTeamsStatus(user) {
  const t = user?.teams;
  if (!t?.webhookUrl) return { connected: false };
  return {
    connected: true,
    label: t.label || null,
    connectedAt: t.connectedAt || null,
  };
}

export async function postTeams(webhookUrl, { title, body, link, actorName, projectName } = {}) {
  if (!webhookUrl) return false;
  const headline = title || 'Codelii Review update';
  const textLines = [
    `**${headline}** · ${projectName || 'Project'}`,
    body ? String(body).replace(/\n/g, ' ').slice(0, 280) : null,
    actorName ? `_by ${actorName}_` : null,
    link || null,
  ].filter(Boolean);

  // MessageCard works with classic Office connectors; `text` covers many Power Automate flows.
  const payload = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: `${headline} on ${projectName || 'project'}`,
    themeColor: '002B2B',
    title: headline,
    text: textLines.join('\n\n'),
    potentialAction: link
      ? [
          {
            '@type': 'OpenUri',
            name: 'Open in Codelii',
            targets: [{ os: 'default', uri: link }],
          },
        ]
      : undefined,
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('[teams]', res.status, errBody.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[teams]', err.message);
    return false;
  }
}
