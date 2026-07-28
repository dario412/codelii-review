/**
 * Shared Cursor prompt builders (server-side).
 */

export function buildCursorPrompt(comment, project) {
  const page = comment.page || comment.path || 'unknown page';
  const x = Number(comment.x);
  const y = Number(comment.y);
  const replies = comment.replies || [];

  const lines = [
    'Implement the following change from a visual site review. Stay scoped to this feedback only.',
    '',
    '## Project',
    `- Name: ${project?.name || 'Untitled'}`,
    `- Type: ${project?.type === 'github' ? 'GitHub snapshot' : 'Live URL'}`,
    `- Source: ${project?.source || 'unknown'}`,
  ];

  if (project?.repoUrl) {
    lines.push(`- Repo: ${project.repoUrl}`);
  }

  if (project?.hasSource || project?.type === 'github' || project?.repoUrl) {
    lines.push('- Code access: yes — find and edit the relevant source files in this codebase');
  } else {
    lines.push('- Code access: assume the matching local/repo codebase is open in this workspace');
  }

  lines.push(
    '',
    '## Page / location',
    `- Page path: ${page}`,
    Number.isFinite(x) && Number.isFinite(y)
      ? `- Pin position on page: ~${Math.round(x)}% from left, ~${Math.round(y)}% from top`
      : null,
    comment.screenshot
      ? '- A visual snapshot was saved with this comment in Codelii Review (use it as visual reference if available)'
      : null,
    '',
    '## Feedback',
    `"${String(comment.text || '').trim()}"`,
    `- Author: ${comment.authorName || 'Reviewer'}`,
    comment.createdAt ? `- Commented: ${comment.createdAt}` : null
  );

  if (replies.length) {
    lines.push('', '## Thread');
    replies.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.authorName || 'Someone'}: "${String(r.text || '').trim()}"`);
    });
  }

  lines.push(
    '',
    '## Instructions',
    '1. Locate the UI described by the page path and feedback.',
    '2. Make the smallest change that satisfies the request.',
    '3. Match existing design system, typography, spacing, and patterns.',
    '4. Do not refactor unrelated code or expand scope.',
    '5. If anything is ambiguous, choose the most reasonable interpretation and note it briefly.',
    '6. When done, summarize what you changed.'
  );

  return lines.filter((l) => l !== null && l !== undefined).join('\n');
}

export function buildAllOpenPrompts(comments, project) {
  const open = (comments || []).filter((c) => !c.resolved);
  if (!open.length) return '';

  const parts = [
    `You have ${open.length} open review comment${open.length === 1 ? '' : 's'} to implement for "${project?.name || 'this project'}".`,
    'Work through them one by one. Keep each change scoped. Source: ' + (project?.source || 'unknown') + '.',
    '',
  ];

  open.forEach((c, i) => {
    parts.push('---', '', `### Comment ${i + 1} of ${open.length}`, '', buildCursorPrompt(c, project), '');
  });

  return parts.join('\n');
}

export function resolveRepoUrl(project) {
  if (project?.repoUrl) return project.repoUrl;
  if (project?.type === 'github' && project?.source) return project.source;
  return null;
}
