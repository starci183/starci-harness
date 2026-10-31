// notify.mjs - the post-deploy notification (`deploy.notify`): one webhook message when an attempt ends, off unless the environment declares it.
// The message holds names only: the outcome, the environment, the stack, the commit, the tag, the release id, the attempt id, the CI run URL and the
// failure code. The webhook URL is a key of a sealed member (https only); it is never printed, journaled or put in an error. A notification that fails
// (the member cannot be opened, the URL is not https, the endpoint answers an error or does not answer) is one line of the result and never fails the deploy.
import type { DeployConfig } from './config.mjs';
import type { StackContext } from './context.mjs';
import type { AttemptSummary } from './journal.mjs';
import { openMember } from './sealed.mjs';

const TIMEOUT_MS = 10_000;
const HTTPS_URL = /^https:\/\/[^\s]+$/u;

/** The one-line text a chat webhook shows. */
export function notifyText(summary: AttemptSummary): string {
  const commit = summary.sourceSha ? ` of ${summary.sourceSha.slice(0, 10)}` : '';
  const tag = summary.tag ? ` (${summary.tag})` : '';
  const release = summary.releaseId ? `, release ${summary.releaseId}` : '';
  const failure = summary.errorCode ? `, ${summary.errorCode}` : '';
  return `[${summary.stack}/${summary.env}] ${summary.kind} ${summary.outcome}${commit}${tag}${release}${failure}`;
}

/** The JSON body: `text` (Slack style) and `content` (Discord style) carry the line, the rest is the same facts as fields. */
export function notifyBody(summary: AttemptSummary): Record<string, unknown> {
  const text = notifyText(summary);
  return { text, content: text, ...summary };
}

/** Sends the message for a finished attempt when `deploy.notify` is declared and lists its outcome; returns the lines to print (empty when nothing was sent or it went well). */
export async function notifyOutcome(ctx: StackContext, config: Pick<DeployConfig, 'notify' | 'secretsDir'>, summary: AttemptSummary): Promise<string[]> {
  const declared = config.notify;
  if (!declared || !declared.on.includes(summary.outcome)) return [];
  try {
    const url = openMember(ctx, config, declared.webhook.member)[declared.webhook.key];
    if (typeof url !== 'string' || !HTTPS_URL.test(url)) return [`notify: the sealed ${declared.webhook.member} holds no https URL under ${declared.webhook.key}; nothing was sent`];
    const response = await ctx.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notifyBody(summary)), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok ? [] : [`notify: the webhook answered HTTP ${response.status}; the deploy outcome stands`];
  } catch (error) {
    return [`notify: the message was not sent (${(error as Error).name === 'TimeoutError' ? 'timed out' : 'the webhook could not be reached'}); the deploy outcome stands`];
  }
}
