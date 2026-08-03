/**
 * Who may use the Cursor developer tools (copy prompt / Fix with Cursor).
 *
 * These are agency-side features: the people building the site turn feedback
 * into code. Invited clients review and comment, but never see them.
 *
 * Two gates, both must pass:
 *   1. The viewer owns the project. Collaborators never qualify.
 *   2. The viewer's email is on the beta allowlist.
 *
 * Set CURSOR_TOOLS_EMAILS to a comma-separated list to change the allowlist,
 * or to "*" to open the tools to every project owner once beta is over.
 *
 * The same allowlist also skips the Stripe project-creation paywall so agency
 * staff can create client projects without starting a personal subscription.
 */

const DEFAULT_ALLOWED_EMAILS = [
  'dario@positivestudio.co',
  'ani@positivestudio.co',
];

function allowedEmails() {
  const raw = (process.env.CURSOR_TOOLS_EMAILS || '').trim();
  if (!raw) return DEFAULT_ALLOWED_EMAILS;
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAgencyEmail(email) {
  const allowed = allowedEmails();
  if (allowed.includes('*')) return true;
  return allowed.includes(String(email || '').trim().toLowerCase());
}

export function canUseCursorTools(project, user) {
  if (!project || !user) return false;
  if (project.ownerId !== user.id) return false;
  return isAgencyEmail(user.email);
}

export const CURSOR_TOOLS_DENIED =
  'Cursor prompts and Fix with Cursor are only available to the project owner.';
