// ===== SMTP 账号管理 =====
import { Hono } from "hono";
import { eq, and, count, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { smtp_accounts, smtp_daily_stats, campaigns } from "@panel/db";
import type { AppEnv } from "../../env";
import { encryptText, decryptText } from "../crypto";
import { testSmtpConnection } from "@panel/mail";
import { todayUTC, isValidEmail } from "@panel/shared";

const router = new Hono<AppEnv>();

/** 列表(含今日统计) */
router.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const today = todayUTC();
  const rows = await db
    .select({
      a: smtp_accounts,
      s_total: smtp_daily_stats.total,
      s_success: smtp_daily_stats.success,
      s_failed: smtp_daily_stats.failed,
    })
    .from(smtp_accounts)
    .leftJoin(
      smtp_daily_stats,
      and(eq(smtp_daily_stats.smtp_id, smtp_accounts.id), eq(smtp_daily_stats.date, today)),
    )
    .orderBy(smtp_accounts.id);
  return c.json(
    rows.map(({ a, s_total, s_success, s_failed }) => {
      const { password_encrypted, ...safe } = a;
      return {
        ...safe,
        today_total: s_total ?? 0,
        today_success: s_success ?? 0,
        today_failed: s_failed ?? 0,
      };
    }),
  );
});

/** 添加 */
router.post("/", async (c) => {
  const body = await c.req.json();
  const { name, host, port, username, password, security, from_name, from_email, reply_to, daily_limit, enabled } = body;
  if (!host || !username || !password || !from_email) {
    return c.json({ error: "host/username/password/from_email 为必填项" }, 400);
  }
  if (!isValidEmail(from_email)) return c.json({ error: "发件人邮箱格式无效" }, 400);
  const sec = security ?? "ssl";
  if (!["ssl", "starttls", "none"].includes(sec)) {
    return c.json({ error: "security 需为 ssl/starttls/none" }, 400);
  }
  const p = parseInt(port, 10);
  if (!p || p < 1 || p > 65535) return c.json({ error: "端口无效" }, 400);

  const now = new Date().toISOString();
  const db = drizzle(c.env.DB);
  const password_encrypted = await encryptText(c.env.ENCRYPTION_KEY, password);
  const [row] = await db
    .insert(smtp_accounts)
    .values({
      name: name || host,
      host,
      port: p,
      username,
      password_encrypted,
      security: sec,
      from_name: from_name || "",
      from_email,
      reply_to: reply_to || null,
      daily_limit: daily_limit ?? 0,
      enabled: enabled !== false,
      created_at: now,
      updated_at: now,
    })
    .returning({ id: smtp_accounts.id });
  return c.json({ id: row.id, ok: true }, 201);
});

/** 单个详情(不含密码) */
router.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(smtp_accounts).where(eq(smtp_accounts.id, id)).limit(1);
  if (!row) return c.json({ error: "SMTP 账号不存在" }, 404);
  const { password_encrypted, ...safe } = row;
  return c.json(safe);
});

/** 更新 */
router.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const body = await c.req.json();
  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(smtp_accounts).where(eq(smtp_accounts.id, id)).limit(1);
  if (!existing) return c.json({ error: "SMTP 账号不存在" }, 404);

  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) upd.name = body.name;
  if (body.host !== undefined) upd.host = body.host;
  if (body.port !== undefined) upd.port = parseInt(body.port, 10) || existing.port;
  if (body.username !== undefined) upd.username = body.username;
  if (body.password && typeof body.password === "string") {
    upd.password_encrypted = await encryptText(c.env.ENCRYPTION_KEY, body.password);
  }
  if (body.security !== undefined) {
    if (!["ssl", "starttls", "none"].includes(body.security)) return c.json({ error: "security 无效" }, 400);
    upd.security = body.security;
  }
  if (body.from_name !== undefined) upd.from_name = body.from_name;
  if (body.from_email !== undefined) {
    if (!isValidEmail(body.from_email)) return c.json({ error: "邮箱格式无效" }, 400);
    upd.from_email = body.from_email;
  }
  if (body.reply_to !== undefined) upd.reply_to = body.reply_to || null;
  if (body.daily_limit !== undefined) upd.daily_limit = body.daily_limit;
  if (body.enabled !== undefined) upd.enabled = body.enabled;

  await db.update(smtp_accounts).set(upd).where(eq(smtp_accounts.id, id));
  return c.json({ ok: true });
});

/** 删除 */
router.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(smtp_accounts).where(eq(smtp_accounts.id, id)).limit(1);
  if (!existing) return c.json({ error: "SMTP 账号不存在" }, 404);
  // 检查是否有活跃任务引用
  const [{ n }] = await db
    .select({ n: count() })
    .from(campaigns)
    .where(and(eq(campaigns.smtp_id, id), sql`status IN ('draft','queued','sending','paused')`));
  if (n > 0) return c.json({ error: `该 SMTP 账号被 ${n} 个待处理任务引用,无法删除` }, 400);
  await db.delete(smtp_accounts).where(eq(smtp_accounts.id, id));
  return c.json({ ok: true });
});

/** 测试连接 */
router.post("/:id/test", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(smtp_accounts).where(eq(smtp_accounts.id, id)).limit(1);
  if (!row) return c.json({ error: "SMTP 账号不存在" }, 404);
  const password = await decryptText(c.env.ENCRYPTION_KEY, row.password_encrypted);
  const result = await testSmtpConnection({
    host: row.host,
    port: row.port,
    security: row.security as "ssl" | "starttls" | "none",
    username: row.username,
    password,
    timeoutMs: 15000,
  });
  return c.json(result);
});

export default router;