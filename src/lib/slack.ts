import "server-only";

import { SLACK_CHANNEL } from "@/config/team";

/**
 * Posts to #alwayscited (5 Nov 2026: dropped WLDM links, client messages, CSM tasks). Until Danny adds
 * SLACK_BOT_TOKEN in Vercel this is a no-op that logs what it would have posted, so every caller can be built and
 * tested now and starts posting the moment the token exists. Never throws: a Slack outage must not fail the audit or
 * the message that triggered it.
 */
export type SlackResult = { posted: true } | { posted: false; reason: "no_token" | "rejected" | "failed"; detail?: string };

export async function postToChannel(text: string, channel: string = SLACK_CHANNEL.id): Promise<SlackResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.log(`[slack] would post to #${channel === SLACK_CHANNEL.id ? SLACK_CHANNEL.name : channel}: ${text.slice(0, 500)}`);
    return { posted: false, reason: "no_token" };
  }
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (body.ok) return { posted: true };
    console.warn(`[slack] post refused: ${body.error ?? res.status}`);
    return { posted: false, reason: "rejected", detail: body.error ?? String(res.status) };
  } catch (err) {
    console.warn(`[slack] post failed: ${err instanceof Error ? err.message : String(err)}`);
    return { posted: false, reason: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
