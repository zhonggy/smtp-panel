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

const router = new Hono<AppEnv>();

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
  return c.json(rows.map(({ c: camp, smtp_name, template_name }) => ({ ...camp, smtp_name, template_name })));
});

/** 创建任务 */
router.post("/", async (c) => {
  const { name, smtp_id, template_id, speed_limit, retry_limit, test_email } = await c.req.json();
  if (!name || !smtp_id || !template_id) {
    return c.json({ error: "name/smtp_id/template_id 为必填项" }, 400);
  }
  const db = drizzle(c.env.DB);
  const [smtp] = await db.select().from(smtp_accounts).where(eq(smtp_accounts.id, smtp_id)).limit(1);
  if (!smtp || !smtp.enabled) return c.json({ error: "SMTP 账号不存在或已禁用" }, 400);
  const [tpl] = await db.select().from(mail_templates).where(eq(mail_templates.id, template_id)).limit(1);
  if (!tpl) return c.json({ error: "邮件模板不存在" }, 400);

  const now = new Date().toISOString();
  const speed = Math.min(60, Math.max(1, parseInt(speed_limit, 10) || 5));
  const retry = Math.min(10, Math.max(1, parseInt(retry_limit, 10) || 3));

  const [row] = await db
    .insert(campaigns)
    .values({
      name,
      smtp_id,
      template_id,
      status: "draft",
      total: 0,
      pending: 0,
      success: 0,
      failed: 0,
      speed_limit: speed,
      retry_limit: retry,
      test_email: test_email?.trim() || null,
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
  return c.json({ ...row.c, smtp_name: row.smtp_name, template_name: row.template_name });
});

/** 任务内收件人列表 */
router.get("/:id/recipients", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const status = c.req.query("status") ?? "";
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const pageSize = 50;
  const db = drizzle(c.env.DB);
  const conds = [eq(campaign_recipients.campaign_id, id)];
  if (["pending", "sent", "failed"].includes(status)) {
    conds.push(eq(campaign_recipients.status, status));
  }
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

/** 启动(草稿→队列,并快照收件人) */
router.post("/:id/start", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!camp) return c.json({ error: "任务不存在" }, 404);
  if (camp.status !== "draft") return c.json({ error: "只有草稿状态可启动" }, 400);

  const now = new Date().toISOString();
  if (camp.test_email) {
    // 测试模式:只发给测试邮箱
    await db.insert(campaign_recipients).values({
      campaign_id: id,
      recipient_id: null,
      email: camp.test_email,
      name: "测试收件人",
      status: "pending",
    });
  } else {
    // 从收件人列表快照
    await db.run(
      sql`INSERT INTO campaign_recipients (campaign_id, recipient_id, email, name, status)
          SELECT ${id}, id, email, name, 'pending' FROM recipients WHERE status = 'active'`,
    );
  }
  const [{ n }] = await db
    .select({ n: count() })
    .from(campaign_recipients)
    .where(eq(campaign_recipients.campaign_id, id));
  if (n === 0) return c.json({ error: "没有有效收件人,无法启动" }, 400);

  await db
    .update(campaigns)
    .set({ total: n, pending: n, status: "queued", updated_at: now })
    .where(eq(campaigns.id, id));

  await enqueueCampaignTick(c.env, id, 0);
  return c.json({ ok: true, total: n });
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

/** 删除(仅草稿/已取消/已完成/已暂停) */
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