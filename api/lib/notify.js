/**
 * Fan-out review events to Slack, Teams, and Discord.
 */
import { saveCore } from './store.js';
import { notifySlack, projectReviewUrl } from './slack.js';
import { notifyTeamsConnection } from './teams.js';
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

  notifyTeamsConnection(core, project, payload)
    .then(async (result) => {
      if (result?.saved) {
        try {
          await saveCore(core);
        } catch (err) {
          console.error('[notify] save teams tokens', err.message);
        }
      }
    })
    .catch(() => {});

  const discord = resolveDiscordWebhook(core, project);
  if (discord) postDiscord(discord, payload).catch(() => {});
}
