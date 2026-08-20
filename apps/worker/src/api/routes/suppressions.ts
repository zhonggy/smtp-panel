// ===== 抑制名单管理 =====
import { Hono } from "hono";
import { and, count, desc, eq, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { suppressions } from "@panel/db";
import { BOUNCE_LABELS } from "@panel/mail";
import { isValidEmail, normalizeEmail, parseRecipientsText, chunk } from "@panel/shared";
import type { AppEnv } from "../../env";

const router = new Hono<AppEnv>();

/** 列表(分页 + 搜索 + 类别筛选) */
router.get("/", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query("page_size") ?? "20", 10)));
  const search = c.req.query("search")?.trim();
  const reason = c.req.query("reason");
  const db = drizzle(c.env.DB);

  const conds: any[] = [];
  if (search) {
    conds.push(or(like(suppressions.email, `%${search}%`), like(suppressions.detail, `%${search}%`)));
  }
  if (reason) conds.push(eq(suppressions.reason, reason));
  const where = conds.length ? and(...conds) : undefined;

  const [items, [{ n }]] = await Promise.all([
    db
      .select()
      .from(suppressions)
      .where(where)
      .orderBy(desc(suppressions.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(suppressions).where(where),
  ]);

  return c.json({
    items: items.map((r) => ({
      ...r,
      label: r.bounce_category
        ? (BOUNCE_LABELS[r.bounce_category as keyof typeof BOUNCE_LABELS] ?? r.bounce_category)
        : null,
    })),
    total: n,
    page,
    page_size: pageSize,
  });
});

/** 按原因统计 */
router.get("/stats", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ reason: suppressions.reason, n: count() })
    .from(suppressions)
    .groupBy(suppressions.reason)
    .orderBy(desc(count()));
  const total = rows.reduce((a, r) => a + r.n, 0);
  return c.json({ total, by_reason: rows.map((r) => ({ reason: r.reason, count: r.n })) });
});

/** 手动添加(单个或批量文本) */
router.post("/", async (c) => {
  const body = await c.req.json();
  const now = new Date().toISOString();

  // 批量文本模式
  if (typeof body.text === "string" && body.text.trim()) {
    const parsed = parseRecipientsText(body.text);
    const seen = new Set<string>();
    const rows: string[] = [];
    let invalid = 0;
    for (const p of parsed) {
      const email = normalizeEmail(p.email);
      if (!isValidEmail(email)) {
        invalid++;
        continue;
      }
      if (seen.has(email)) continue;
      seen.add(email);
      rows.push(email);
    }
    let added = 0;
    for (const part of chunk(rows, 14)) {
      const sql = `INSERT INTO suppressions (email, reason, detail, created_at) VALUES ${part
        .map(() => "(?, 'manual', ?, ?)")
        .join(", ")} ON CONFLICT(email) DO NOTHING`;
      const res = await c.env.DB.prepare(sql)
        .bind(...part.flatMap((e) => [e, body.detail ?? "手动添加", now]))
        .run();
      added += res.meta.changes ?? 0;
    }
    return c.json({ total: parsed.length, added, duplicate: rows.length - added, invalid });
  }

  // 单个模式
  const email = normalizeEmail(String(body.email ?? ""));
  if (!isValidEmail(email)) return c.json({ error: "邮箱格式无效" }, 400);
  const res = await c.env.DB.prepare(
    `INSERT INTO suppressions (email, reason, detail, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO NOTHING`,
  )
    .bind(email, body.reason ?? "manual", body.detail ?? "手动添加", now)
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: "该邮箱已在抑制名单中" }, 409);
  return c.json({ ok: true }, 201);
});

/** 移除(允许该地址重新接收投递) */
router.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(suppressions).where(eq(suppressions.id, id)).limit(1);
  if (!existing) return c.json({ error: "记录不存在" }, 404);
  await db.delete(suppressions).where(eq(suppressions.id, id));
  return c.json({ ok: true });
});

/** 按邮箱移除 */
router.delete("/email/:email", async (c) => {
  const email = normalizeEmail(decodeURIComponent(c.req.param("email")));
  const db = drizzle(c.env.DB);
  const res = await db.delete(suppressions).where(eq(suppressions.email, email));
  return c.json({ ok: true, deleted: res.meta.changes ?? 0 });
});

export default router;
