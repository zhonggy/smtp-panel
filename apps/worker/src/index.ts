// ===== Worker 入口 =====
import { Hono } from "hono";
import type { Env, QueueMessage } from "./env";
import { apiApp } from "./api";
import { handleQueueMessage, runWatchdog } from "./queue/consumer";

const app = new Hono<{ Bindings: Env }>();

// API 路由: /api/*
app.route("/api", apiApp);

// 非 API 请求 → 返回前端静态资产(SPA fallback)
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    for (const msg of batch.messages) {
      try {
        await handleQueueMessage(env, msg.body);
        msg.ack();
      } catch (e) {
        console.error("Queue error:", e);
        msg.retry();
      }
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runWatchdog(env));
  },
};