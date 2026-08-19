/** 入队辅助:发起/恢复下个 tick */
import type { Env } from "../env";

export const TICK_LOCK_TTL = 360;

export function tickKey(campaignId: number): string {
  return `cq:tick:${campaignId}`;
}

export async function enqueueCampaignTick(
  env: Env,
  campaignId: number,
  delaySeconds = 0,
): Promise<void> {
  await env.KV.put(tickKey(campaignId), Date.now().toString(), {
    expirationTtl: TICK_LOCK_TTL,
  });
  await env.MAIL_QUEUE.send(
    { type: "campaign_tick", campaign_id: campaignId },
    { delaySeconds: Math.max(0, Math.min(delaySeconds, 43200)) },
  );
}