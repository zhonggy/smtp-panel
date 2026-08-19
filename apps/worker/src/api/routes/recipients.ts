// ===== 收件人管理 =====
import { Hono } from "hono";
import { eq, or, like, desc, count, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { recipients } from "@panel/db";
import type { AppEnv } from "../../env";
import { isValidEmail, normalizeEmail, parseRecipientsText, nameFromEmail, chunk } from "@panel/shared";
import { fetchExternalAccounts } from "../services/external-api";
import { decryptText } from "../crypto";

const router = new Hono<AppEnv>();

/** 列表(分页+搜索+状态筛选) */
router.get("/", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query("page_size") ?? "20", 10)));
  const search = c.req.query("search")?.trim();
  const status = c.req.query("status");
  const db = drizzle(c.env.DB);

  const conds: any[] = [];
  if (search) {
    conds.push(
      or(
        like(recipients.email, `%${search}%`),
        like(recipients.name, `%${search}%`),
        like(recipients.remark, `%${search}%`),
      ),
    );
  }
  if (status === "active" || status === "blocked") conds.push(eq(recipients.status, status));
  const where = conds.length ? and(...conds) : undefined;

  const [items, [{ n }]] = await Promise.all([
    db
      .select()
      .from(recipients)
      .where(where)
      .orderBy(desc(recipients.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(recipients).where(where),
  ]);
  return c.json({ items, total: n, page, page_size: pageSize });
});

/** 统计 */
router.get("/stats", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ status: recipients.status, n: count() })
    .from(recipients)
    .groupBy(recipients.status);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const active = rows.find((r) => r.status === "active")?.n ?? 0;
  const blocked = rows.find((r) => r.status === "blocked")?.n ?? 0;
  return c.json({ total, active, blocked });
});

/** 添加单个 */
router.post("/", async (c) => {
  const { name, email, remark } = await c.req.json();
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) return c.json({ error: "邮箱格式无效" }, 400);
  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(recipients).where(eq(recipients.email, normalized)).limit(1);
  if (existing) return c.json({ error: "该邮箱已存在" }, 409);
  const now = new Date().toISOString();
  const [row] = await db
    .insert(recipients)
    .values({
      name: name || null,
      email: normalized,
      remark: remark || null,
      status: "active",
      source: "manual",
      created_at: now,
      updated_at: now,
    })
    .returning({ id: recipients.id });
  return c.json({ id: row.id, ok: true }, 201);
});

/** 更新 */
router.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const { name, remark, status } = await c.req.json();
  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(recipients).where(eq(recipients.id, id)).limit(1);
  if (!existing) return c.json({ error: "收件人不存在" }, 404);
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) upd.name = name;
  if (remark !== undefined) upd.remark = remark;
  if (status === "active" || status === "blocked") upd.status = status;
  await db.update(recipients).set(upd).where(eq(recipients.id, id));
  return c.json({ ok: true });
});

/** 删除 */
router.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(recipients).where(eq(recipients.id, id)).limit(1);
  if (!existing) return c.json({ error: "收件人不存在" }, 404);
  await db.delete(recipients).where(eq(recipients.id, id));
  return c.json({ ok: true });
});

/** 批量插入收件人(ON CONFLICT DO NOTHING,D1 batch,每语句 ≤ 100 参数) */
async function bulkInsertRecipients(
  env: { DB: D1Database },
  rows: { name: string | null; email: string; remark: string | null; source: string }[],
): Promise<number> {
  const now = new Date().toISOString();
  let added = 0;
  // 7 参数/行 → 每条语句最多 14 行
  const groups = chunk(rows, 14);
  const stmts = groups.map((g) =>
    env.DB.prepare(
      `INSERT INTO recipients (name, email, remark, status, source, created_at, updated_at) VALUES ${g
        .map(() => "(?, ?, ?, 'active', ?, ?, ?)")
        .join(", ")} ON CONFLICT(email) DO NOTHING`,
    ).bind(...g.flatMap((r) => [r.name, r.email, r.remark, r.source, now, now])),
  );
  // D1 batch 每次最多 100 条语句,分批执行
  for (const batchPart of chunk(stmts, 100)) {
    const results = await env.DB.batch(batchPart);
    for (const r of results) added += r.meta.changes ?? 0;
  }
  return added;
}

/** CSV / 文本批量导入 */
router.post("/import", async (c) => {
  const { text } = await c.req.json();
  if (!text || text.length > 1_048_576) {
    return c.json({ error: "内容为空或超过 1MB 限制" }, 400);
  }
  const parsed = parseRecipientsText(text);
  if (parsed.length === 0) return c.json({ error: "未能解析出有效邮箱" }, 400);

  // 规范化 + 校验 + 批内去重
  const seen = new Set<string>();
  const rows: { name: string | null; email: string; remark: string | null; source: string }[] = [];
  let invalid = 0,
    inBatchDup = 0;
  for (const r of parsed) {
    const email = normalizeEmail(r.email);
    if (!isValidEmail(email)) {
      invalid++;
      continue;
    }
    if (seen.has(email)) {
      inBatchDup++;
      continue;
    }
    seen.add(email);
    rows.push({
      name: r.name || nameFromEmail(email),
      email,
      remark: r.remark || null,
      source: "csv",
    });
  }

  const added = await bulkInsertRecipients(c.env, rows);
  const duplicate = rows.length - added + inBatchDup;
  return c.json({ total: parsed.length, added, duplicate, invalid });
});

/**
 * 从外部系统拉取邮箱导入收件人
 * POST /api/recipients/import-external
 * Body: { group_id?, tag_ids?, limit?, only_active? }
 */
router.post("/import-external", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) ?? {};
  const groupId = body.group_id ? Number(body.group_id) : undefined;
  const tagIds = body.tag_ids ? String(body.tag_ids) : undefined;
  const maxTotal = Math.min(10000, Math.max(1, body.limit ?? 1000));
  const onlyActive = body.only_active !== false;

  const baseUrl = await getSetting(c.env.DB, "external_api_base_url");
  const keyEncrypted = await getSetting(c.env.DB, "external_api_key_encrypted");
  if (!baseUrl || !keyEncrypted) {
    return c.json({ error: "请先在设置中配置外部 API 地址和密钥" }, 400);
  }

  const apiKey = await decryptText(c.env.ENCRYPTION_KEY, keyEncrypted);

  let accounts: { email: string; status: string; group_name?: string | null; remark?: string | null }[];
  let remoteTotal: number;
  let truncated = false;
  try {
    const result = await fetchExternalAccounts({ baseUrl, apiKey, groupId, tagIds, maxTotal, onlyActive });
    accounts = result.accounts;
    remoteTotal = result.total;
    truncated = result.truncated;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: `拉取失败: ${msg}` }, 502);
  }

  if (accounts.length === 0) {
    return c.json({
      fetched: 0,
      remote_total: remoteTotal,
      added: 0,
      duplicate: 0,
      invalid: 0,
      pages: 0,
      truncated,
    });
  }

  // 过滤 + 批内去重
  const seen = new Set<string>();
  const rows: { name: string | null; email: string; remark: string | null; source: string }[] = [];
  let invalid = 0,
    skipped = 0,
    inBatchDup = 0;
  for (const acc of accounts) {
    const email = normalizeEmail(acc.email);
    if (!isValidEmail(email)) {
      invalid++;
      continue;
    }
    if (onlyActive && acc.status !== "active") {
      skipped++;
      continue;
    }
    if (seen.has(email)) {
      inBatchDup++;
      continue;
    }
    seen.add(email);
    const remark = [acc.group_name, acc.remark].filter(Boolean).join(" · ") || null;
    rows.push({
      name: nameFromEmail(email),
      email,
      remark,
      source: "external_api",
    });
  }

  const added = await bulkInsertRecipients(c.env, rows);
  const duplicate = rows.length - added + inBatchDup;
  return c.json({
    fetched: accounts.length,
    remote_total: remoteTotal,
    added,
    duplicate,
    invalid,
    pages: 1,
    truncated,
  });
});

async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export default router;