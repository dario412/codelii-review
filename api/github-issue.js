/**
 * Create a GitHub issue from a review comment.
 * Agency-side only (same gate as Fix with Cursor).
 */
import {
  getCore,
  getProjectStore,
  saveProjectStore,
  findProject,
  isMember,
} from './lib/store.js';
import { getUser } from './lib/auth.js';
import { json, corsOptions } from './lib/http.js';
import { createGitHubIssue, parseGitHubUrl } from './lib/github.js';
import { canUseCursorTools, CURSOR_TOOLS_DENIED } from './lib/permissions.js';
import { pushActivity } from './lib/activity.js';
import { resolveRepoUrl } from './lib/prompts.js';

export async function OPTIONS() {
  return corsOptions('POST, OPTIONS');
}

export async function POST(request) {
  const user = await getUser(request);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  try {
    const body = await request.json();
    const projectId = (body.projectId || '').trim();
    const commentId = (body.commentId || '').trim();
    if (!projectId || !commentId) {
      return json({ error: 'projectId and commentId required' }, 400);
    }

    const core = await getCore();
    const project = findProject(core, projectId);
    if (!project || !isMember(project, user.id)) return json({ error: 'Forbidden' }, 403);
    if (!canUseCursorTools(project, user)) return json({ error: CURSOR_TOOLS_DENIED }, 403);

    const repoUrl = resolveRepoUrl(project);
    if (!repoUrl || !parseGitHubUrl(repoUrl)) {
      return json(
        { error: 'Link a GitHub repo in Project settings before creating issues.' },
        400
      );
    }

    const store = await getProjectStore(projectId);
    const comment = store.comments.find((c) => c.id === commentId);
    if (!comment) return json({ error: 'Comment not found' }, 404);

    if (comment.githubIssueNumber && comment.githubIssueUrl) {
      return json({
        alreadyExists: true,
        comment,
        issue: {
          number: comment.githubIssueNumber,
          url: comment.githubIssueUrl,
        },
      });
    }

    const site = (process.env.SITE_URL || '').replace(/\/+$/, '')
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
    const prefix = project.type === 'github' ? `/s/${project.id}` : `/p/${project.id}`;
    const pagePath = (comment.page || '').replace(/^\//, '');
    const deepLink = site
      ? `${site}${prefix}/${pagePath}?comment=${comment.id}`
      : `${prefix}/${pagePath}?comment=${comment.id}`;

    const title = (comment.text || 'Review feedback').replace(/\s+/g, ' ').trim().slice(0, 120);
    const issueBody = [
      `## Review comment`,
      ``,
      comment.text || '',
      ``,
      `---`,
      `- **Project:** ${project.name}`,
      `- **Page:** \`${comment.page || '/'}\``,
      `- **Author:** ${comment.authorName || 'Unknown'}`,
      comment.assigneeName ? `- **Assignee:** ${comment.assigneeName}` : null,
      `- **Open in Codelii:** ${deepLink}`,
      ``,
      `_Created from Codelii Review_`,
    ].filter((line) => line !== null).join('\n');

    // Omit labels — custom labels fail if they don't exist on the repo.
    const issue = await createGitHubIssue({
      repoUrl,
      title: title || 'Review feedback',
      body: issueBody,
    });

    comment.githubIssueNumber = issue.number;
    comment.githubIssueUrl = issue.url;
    comment.githubIssueCreatedAt = new Date().toISOString();
    comment.githubIssueCreatedBy = user.id;

    pushActivity(store, {
      type: 'github_issue',
      actorId: user.id,
      actorName: user.name,
      commentId: comment.id,
      page: comment.page,
      githubIssueNumber: issue.number,
      githubIssueUrl: issue.url,
      message: title,
    });

    await saveProjectStore(projectId, store);
    return json({ comment, issue }, 201);
  } catch (err) {
    console.error('[github-issue]', err);
    return json({ error: err.message || 'Failed to create GitHub issue' }, 500);
  }
}
