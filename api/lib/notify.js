/**
 * Fan-out review events to Slack, Teams, and Discord.
 */
import { notifySlack, projectReviewUrl } from './slack.js';
import { resolveTeamsWebhook, postTeams } from './teams.js';
import { resolveDiscordWebhook, postDiscord } from './discord.js';

/**
 * Notify connected channels about a review event. Fire-and-forget safe.
 */
export function notifyReviewEvent(core, project, {
  title,
  body,
  page,
  actorName,
  commentId,
} = {}) {
  notifySlack(core, project, { title, body, page, actorName, commentId });

  const url = projectReviewUrl(project, page);
  const deep = commentId ? `${url}${url.includes('?') ? '&' : '?'}comment=${commentId}` : url;
  const payload = {
    title,
    body,
    link: deep,
    actorName,
    projectName: project?.name,
  };

  const teams = resolveTeamsWebhook(core, project);
  if (teams) postTeams(teams, payload).catch(() => {});

  const discord = resolveDiscordWebhook(core, project);
  if (discord) postDiscord(discord, payload).catch(() => {});
}
