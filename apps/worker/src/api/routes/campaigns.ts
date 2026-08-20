// ===== 发送任务管理 =====
import { Hono } from "hono";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  campaigns,
  campaign_recipients,
  smtp_accounts,
  mail_templates,
  send_logs,
} from "@panel/db";
import type { AppEnv } from "../../env";
import { enqueueCampaignTick } from "../queue";
import { materializeAndQueue } from "../../queue/consumer";
import { parsePoolIds } from "../../queue/pool";

const router = new Hono<AppEnv>();

/** 校验并规范化 pool_smtp_ids */
async function validatePoolIds(
  db: ReturnType<typeof drizzle>,
  raw: unknown,
): Promise<{ value: string | null; error?: string }> {
  if (raw === undefined || raw === null || raw === "") return { value: null };
  const ids = parsePoolIds(String(raw));
  if (ids.length === 0) return { value: null };
  const rows = await db
    .select({ id: smtp_accounts.id, enabled: smtp_accounts.enabled })
    .from(smtp_accounts)
    .where(sql`${smtp_accounts.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  const found = new Set(rows.filter((r) => r.enabled).map((r) => r.id));
  const missing = ids.filter((i) => !found.has(i));
  if (missing.length > 0) {
    return { value: null, error: `SMTP 账号不存在或已禁用: ${missing.join(", ")}` };
  }
  return { value: ids.join(",") };
}

/** 解析定时时间:必须是将来的合法 ISO 时间 */
function parseScheduledAt(raw: unknown): { value: string | null; error?: string } {
  if (raw === undefined || raw === null || raw === "") return { value: null };
  const t = new Date(String(raw));
  if (Number.isNaN(t.getTime())) return { value: null, error: "定时时间格式无效" };
  if (t.getTime() < Date.now() - 60_000) {
    return { value: null, error: "定时时间不能早于当前时间" };
  }
  return { value: t.toISOString() };
}

/** 任务列表 */
router.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      c: campaigns,
      smtp_name: smtp_accounts.name,
      template_name: mail_templates.name,
    })
    .from(campaigns)
    .leftJoin(smtp_accounts, eq(campaigns.smtp_id, smtp_accounts.id))
    .leftJoin(mail_templates, eq(campaigns.template_id, mail_templates.id))
    .orderBy(desc(campaigns.id));
  return c.json(
    rows.map(({ c: camp, smtp_name, template_name }) => ({ ...camp, smtp_name, template_name })),
  );
});

/** 创建任务 */
router.post("/", async (c) => {
  const body = await c.req.json();
  const {
    name,
    smtp_id,
    template_id,
    speed_limit,
    retry_limit,
    test_email,
    scheduled_at,
    use_pool,
    pool_smtp_ids,
  } = body;

  if (!name || !template_id) {
    return c.json({ error: "name/template_id 为必填项" }, 400);
  }
  const db = drizzle(c.env.DB);

  const usePool = use_pool === true;
  let poolIds: string | null = null;

  if (usePool) {
    const v = await validatePoolIds(db, pool_smtp_ids);
    if (v.error) return c.json({ error: v.error }, 400);
    poolIds = v.value;
    // 池模式下至少要有一个可用账号
    const [{ n }] = await db
      .select({ n: count() })
      .from(smtp_accounts)
      .where(and(eq(smtp_accounts.enabled, true), eq(smtp_accounts.in_pool, true)));
    if (n === 0) return c.json({ error: "没有启用且加入池的 SMTP 账号" }, 400);
  } else {
    if (!smtp_id) return c.json({ error: "非池模式必须指定 smtp_id" }, 400);
    const [smtp] = await db
      .select()
      .from(smtp_accounts)
      .where(eq(smtp_accounts.id, smtp_id))
      .limit(1);
    if (!smtp || !smtp.enabled) return c.json({ error: "SMTP 账号不存在或已禁用" }, 400);
  }

  const [tpl] = await db
    .select()
    .from(mail_templates)
    .where(eq(mail_templates.id, template_id))
    .limit(1);
  if (!tpl) return c.json({ error: "邮件模板不存在" }, 400);

  const sched = parseScheduledAt(scheduled_at);
  if (sched.error) return c.json({ error: sched.error }, 400);

  const now = new Date().toISOString();
  const speed = Math.min(60, Math.max(1, parseInt(speed_limit, 10) || 5));
  const retry = Math.min(10, Math.max(1, parseInt(retry_limit, 10) || 3));

  const [row] = await db
    .insert(campaigns)
    .values({
      name,
      smtp_id: usePool ? 0 : smtp_id,
      template_id,
      status: "draft",
      total: 0,
      pending: 0,
      success: 0,
      failed: 0,
      suppressed: 0,
      speed_limit: speed,
      retry_limit: retry,
      test_email: test_email?.trim() || null,
      scheduled_at: sched.value,
      use_pool: usePool,
      pool_smtp_ids: poolIds,
      created_at: now,
      updated_at: now,
    })
    .returning({ id: campaigns.id });
  return c.json({ id: row.id, ok: true }, 201);
});

/** 任务详情 */
router.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [row] = await db
    .select({
      c: campaigns,
      smtp_name: smtp_accounts.name,
      template_name: mail_templates.name,
    })
    .from(campaigns)
    .leftJoin(smtp_accounts, eq(campaigns.smtp_id, smtp_accounts.id))
    .leftJoin(mail_templates, eq(campaigns.template_id, mail_templates.id))
    .where(eq(campaigns.id, id))
    .limit(1);
  if (!row) return c.json({ error: "任务不存在" }, 404);

  // 池模式:附带池内账号使用情况
  let pool_usage: { id: number; name: string; sent: number; failed: number }[] = [];
  if (row.c.use_pool) {
    const usage = await db
      .select({
        id: send_logs.smtp_id,
        name: send_logs.smtp_name,
        status: send_logs.status,
        n: count(),
      })
      .from(send_logs)
      .where(eq(send_logs.campaign_id, id))
      .groupBy(send_logs.smtp_id, send_logs.smtp_name, send_logs.status);
    const map = new Map<number, { id: number; name: string; sent: number; failed: number }>();
    for (const u of usage) {
      if (u.id === null) continue;
      const e = map.get(u.id) ?? { id: u.id, name: u.name ?? String(u.id), sent: 0, failed: 0 };
      if (u.status === "success") e.sent += u.n;
      else e.failed += u.n;
      map.set(u.id, e);
    }
    pool_usage = [...map.values()].sort((a, b) => b.sent - a.sent);
  }

  return c.json({
    ...row.c,
    smtp_name: row.smtp_name,
    template_name: row.template_name,
    pool_usage,
  });
});

/** 更新任务(仅草稿/定时/暂停状态可改) */
router.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json();
  const db = drizzle(c.env.DB);
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!camp) return c.json({ error: "任务不存在" }, 404);
  if (!["draft", "scheduled", "paused"].includes(camp.status)) {
    return c.json({ error: "只有草稿/定时/暂停状态的任务可修改" }, 400);
  }

  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) upd.name = body.name;
  if (body.speed_limit !== undefined) {
    upd.speed_limit = Math.min(60, Math.max(1, parseInt(body.speed_limit, 10) || 5));
  }
  if (body.retry_limit !== undefined) {
    upd.retry_limit = Math.min(10, Math.max(1, parseInt(body.retry_limit, 10) || 3));
  }
  if (body.scheduled_at !== undefined) {
    const sched = parseScheduledAt(body.scheduled_at);
    if (sched.error) return c.json({ error: sched.error }, 400);
    upd.scheduled_at = sched.value;
  }
  if (body.use_pool !== undefined) {
    upd.use_pool = body.use_pool === true;
    if (body.use_pool === true) {
      const v = await validatePoolIds(db, body.pool_smtp_ids ?? camp.pool_smtp_ids);
      if (v.error) return c.json({ error: v.error }, 400);
      upd.pool_smtp_ids = v.value;
    }
  } else if (body.pool_smtp_ids !== undefined) {
    const v = await validatePoolIds(db, body.pool_smtp_ids);
    if (v.error) return c.json({ error: v.error }, 400);
    upd.pool_smtp_ids = v.value;
  }
  if (body.smtp_id !== undefined && body.use_pool !== true) {
    const [smtp] = await db
      .select()
      .from(smtp_accounts)
      .where(eq(smtp_accounts.id, body.smtp_id))
      .limit(1);
    if (!smtp || !smtp.enabled) return c.json({ error: "SMTP 账号不存在或已禁用" }, 400);
    upd.smtp_id = body.smtp_id;
  }

  await db.update(campaigns).set(upd).where(eq(campaigns.id, id));
  return c.json({ ok: true });
});

/** 任务内收件人列表 */
router.get("/:id/recipients", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const status = c.req.query("status") ?? "";
  const category = c.req.query("category") ?? "";
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const pageSize = 50;
  const db = drizzle(c.env.DB);
  const conds = [eq(campaign_recipients.campaign_id, id)];
  if (["pending", "sent", "failed"].includes(status)) {
    conds.push(eq(campaign_recipients.status, status));
  }
  if (category) conds.push(eq(campaign_recipients.bounce_category, category));
  const where = and(...conds);
  const [items, [{ n }]] = await Promise.all([
    db
      .select()
      .from(campaign_recipients)
      .where(where)
      .orderBy(campaign_recipients.id)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(campaign_recipients).where(where),
  ]);
  return c.json({ items, total: n, page, page_size: pageSize });
});

/** 任务日志 */
router.get("/:id/logs", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const pageSize = 50;
  const db = drizzle(c.env.DB);
  const [items, [{ n }]] = await Promise.all([
    db
      .select()
      .from(send_logs)
      .where(eq(send_logs.campaign_id, id))
      .orderBy(desc(send_logs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(send_logs).where(eq(send_logs.campaign_id, id)),
  ]);
  return c.json({ items, total: n, page, page_size: pageSize });
});

/** 任务退信分类汇总 */
router.get("/:id/bounces", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ category: send_logs.bounce_category, n: count() })
    .from(send_logs)
    .where(and(eq(send_logs.campaign_id, id), eq(send_logs.status, "failed")))
    .groupBy(send_logs.bounce_category)
    .orderBy(desc(count()));
  return c.json(
    rows.map((r) => ({ category: r.category ?? "unknown", count: r.n })),
  );
});

/** 启动:草稿 → 队列;若带定时时间则进入 scheduled 等待 Cron */
router.post("/:id/start", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!camp) return c.json({ error: "任务不存在" }, 404);
  if (!["draft", "scheduled"].includes(camp.status)) {
    return c.json({ error: "只有草稿/定时状态可启动" }, 400);
  }

  const now = new Date().toISOString();

  // 定时任务:仅置为 scheduled,由 Cron 到点启动
  if (camp.scheduled_at && new Date(camp.scheduled_at).getTime() > Date.now()) {
    await db
      .update(campaigns)
      .set({ status: "scheduled", last_error: null, updated_at: now })
      .where(eq(campaigns.id, id));
    return c.json({ ok: true, scheduled_at: camp.scheduled_at });
  }

  const started = await materializeAndQueue(c.env, id);
  if (!started) return c.json({ error: "没有有效收件人(可能全部在抑制名单中)" }, 400);
  const [updated] = await db
    .select({ total: campaigns.total })
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1);
  return c.json({ ok: true, total: updated?.total ?? 0 });
});

/** 取消定时(scheduled → draft) */
router.post("/:id/unschedule", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!camp) return c.json({ error: "任务不存在" }, 404);
  if (camp.status !== "scheduled") return c.json({ error: "任务不在定时状态" }, 400);
  await db
    .update(campaigns)
    .set({ status: "draft", scheduled_at: null, updated_at: new Date().toISOString() })
    .where(eq(campaigns.id, id));
  return c.json({ ok: true });
});

/** 暂停 */
router.post("/:id/pause", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!camp) return c.json({ error: "任务不存在" }, 404);
  if (!["queued", "sending"].includes(camp.status)) {
    return c.json({ error: "当前状态不可暂停" }, 400);
  }
  await db
    .update(campaigns)
    .set({ status: "paused", updated_at: new Date().toISOString() })
    .where(eq(campaigns.id, id));
  return c.json({ ok: true });
});

/** 恢复 */
router.post("/:id/resume", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!camp) return c.json({ error: "任务不存在" }, 404);
  if (camp.status !== "paused") return c.json({ error: "只有暂停状态可恢复" }, 400);
  await db
    .update(campaigns)
    .set({ status: "sending", last_error: null, updated_at: new Date().toISOString() })
    .where(eq(campaigns.id, id));
  await enqueueCampaignTick(c.env, id, 0);
  return c.json({ ok: true });
});

/** 取消 */
router.post("/:id/cancel", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!camp) return c.json({ error: "任务不存在" }, 404);
  if (["completed", "cancelled"].includes(camp.status)) {
    return c.json({ error: "任务已完成或已取消" }, 400);
  }
  await db
    .update(campaigns)
    .set({ status: "cancelled", updated_at: new Date().toISOString() })
    .where(eq(campaigns.id, id));
  return c.json({ ok: true });
});

/** 删除 */
router.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!camp) return c.json({ error: "任务不存在" }, 404);
  if (["queued", "sending"].includes(camp.status)) {
    return c.json({ error: "发送中的任务不可删除,请先取消" }, 400);
  }
  await db.delete(campaign_recipients).where(eq(campaign_recipients.campaign_id, id));
  await db.delete(campaigns).where(eq(campaigns.id, id));
  return c.json({ ok: true });
});

export default router;
