/**
 * Daily / weekly open-comment digests via Resend.
 */
import { getProjectStore, isMember } from './store.js';
import { projectReviewUrl } from './slack.js';

export const DIGEST_FREQUENCIES = ['off', 'daily', 'weekly'];

export function publicDigestStatus(user) {
  const d = user?.emailDigest || {};
  const frequency = DIGEST_FREQUENCIES.includes(d.frequency) ? d.frequency : 'off';
  return {
    connected: frequency !== 'off',
    frequency,
    lastSentAt: d.lastSentAt || null,
    available: Boolean((process.env.RESEND_API_KEY || '').trim()),
  };
}

function startOfUtcDay(d = new Date()) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function alreadySentToday(lastSentAt) {
  if (!lastSentAt) return false;
  const last = new Date(lastSentAt);
  if (Number.isNaN(last.getTime())) return false;
  return startOfUtcDay(last) === startOfUtcDay(new Date());
}

function shouldSendNow(frequency, lastSentAt, now = new Date()) {
  if (frequency === 'off') return false;
  if (alreadySentToday(lastSentAt)) return false;
  if (frequency === 'daily') return true;
  if (frequency === 'weekly') {
    // Monday UTC
    return now.getUTCDay() === 1;
  }
  return false;
}

async function openCommentsForProject(project) {
  try {
    const store = await getProjectStore(project.id);
    const open = (store.comments || []).filter((c) => !c.resolved && !c.hidden);
    return open.map((c) => ({
      id: c.id,
      page: c.page || '/',
      text: (c.text || '').slice(0, 140),
      authorName: c.authorName || 'Someone',
      assigneeName: c.assigneeName || null,
      createdAt: c.createdAt,
    }));
  } catch (err) {
    console.error('[digest] load', project.id, err.message);
    return [];
  }
}

export async function collectDigestForUser(core, user) {
  const projects = (core.projects || []).filter(
    (p) => p.ownerId === user.id || isMember(p, user.id)
  );
  const sections = [];
  let total = 0;

  for (const project of projects) {
    const open = await openCommentsForProject(project);
    if (!open.length) continue;
    total += open.length;
    sections.push({
      project,
      open: open.slice(0, 8),
      more: Math.max(0, open.length - 8),
    });
  }

  return { total, sections };
}

function renderDigestHtml({ user, frequency, total, sections }) {
  const period = frequency === 'weekly' ? 'This week' : 'Today';
  const rows = sections
    .map(({ project, open, more }) => {
      const items = open
        .map((c) => {
          const link = projectReviewUrl(project, c.page);
          const deep = `${link}${link.includes('?') ? '&' : '?'}comment=${c.id}`;
          return `<li style="margin:0 0 8px;"><a href="${deep}" style="color:#002B2B;font-weight:600;text-decoration:none;">${escapeHtml(c.text || 'Comment')}</a><br/><span style="color:#667;font-size:13px;">${escapeHtml(c.page)} · ${escapeHtml(c.authorName)}${c.assigneeName ? ` · assigned ${escapeHtml(c.assigneeName)}` : ''}</span></li>`;
        })
        .join('');
      return `<div style="margin:0 0 22px;"><h2 style="margin:0 0 10px;font-size:16px;color:#002B2B;">${escapeHtml(project.name)} <span style="color:#667;font-weight:500;">(${open.length + more} open)</span></h2><ul style="margin:0;padding-left:18px;">${items}</ul>${more ? `<p style="color:#667;font-size:13px;margin:8px 0 0;">+${more} more</p>` : ''}</div>`;
    })
    .join('');

  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f5;padding:24px;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 28px 32px;border:1px solid #e6ebe8;">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#667;">Codelii Review</p>
    <h1 style="margin:0 0 8px;font-size:22px;color:#002B2B;">${period}'s open feedback</h1>
    <p style="margin:0 0 24px;color:#445;">Hi ${escapeHtml(user.name || 'there')} — ${total} open comment${total === 1 ? '' : 's'} across your projects.</p>
    ${rows}
    <p style="margin:28px 0 0;font-size:12px;color:#889;">You’re receiving this because email digests are set to ${escapeHtml(frequency)} in Integrations. Change anytime in Codelii Review.</p>
  </div>
  </body></html>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendDigestEmail(user, digest, frequency) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  const from = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);
  const period = frequency === 'weekly' ? 'Weekly' : 'Daily';
  const { error } = await resend.emails.send({
    from,
    to: user.email,
    subject: `${period} digest: ${digest.total} open comment${digest.total === 1 ? '' : 's'} — Codelii Review`,
    html: renderDigestHtml({ user, frequency, ...digest }),
  });
  if (error) throw new Error(error.message || 'Resend failed');
}

/**
 * Run digest pass for all eligible users. Mutates + expects caller to saveCore.
 */
export async function runEmailDigests(core, { now = new Date(), forceUserId = null } = {}) {
  const results = [];
  for (const user of core.users || []) {
    if (user.guest || !user.email) continue;
    if (forceUserId && user.id !== forceUserId) continue;

    const frequency = forceUserId
      ? (user.emailDigest?.frequency && user.emailDigest.frequency !== 'off'
        ? user.emailDigest.frequency
        : 'daily')
      : (DIGEST_FREQUENCIES.includes(user.emailDigest?.frequency)
        ? user.emailDigest.frequency
        : 'off');

    if (!forceUserId && !shouldSendNow(frequency, user.emailDigest?.lastSentAt, now)) {
      continue;
    }

    const digest = await collectDigestForUser(core, user);
    if (!digest.total) {
      results.push({ userId: user.id, email: user.email, skipped: 'empty' });
      continue;
    }

    try {
      await sendDigestEmail(user, digest, frequency === 'off' ? 'daily' : frequency);
      if (!user.emailDigest) user.emailDigest = { frequency: 'off' };
      user.emailDigest.lastSentAt = now.toISOString();
      results.push({ userId: user.id, email: user.email, sent: true, total: digest.total });
    } catch (err) {
      console.error('[digest]', user.email, err.message);
      results.push({ userId: user.id, email: user.email, error: err.message });
    }
  }
  return results;
}
