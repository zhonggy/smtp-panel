// ===== 邮件模板管理 =====
import { Hono } from "hono";
import { eq, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { mail_templates, campaigns } from "@panel/db";
import type { AppEnv } from "../../env";

const router = new Hono<AppEnv>();

router.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(mail_templates).orderBy(mail_templates.id);
  return c.json(rows);
});

router.post("/", async (c) => {
  const { name, subject, html_body, text_body } = await c.req.json();
  if (!name || !subject) return c.json({ error: "name 和 subject 为必填项" }, 400);
  const now = new Date().toISOString();
  const db = drizzle(c.env.DB);
  const [row] = await db
    .insert(mail_templates)
    .values({
      name,
      subject,
      html_body: html_body ?? "",
      text_body: text_body || null,
      created_at: now,
      updated_at: now,
    })
    .returning({ id: mail_templates.id });
  return c.json({ id: row.id, ok: true }, 201);
});

router.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(mail_templates).where(eq(mail_templates.id, id)).limit(1);
  if (!row) return c.json({ error: "模板不存在" }, 404);
  return c.json(row);
});

router.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const { name, subject, html_body, text_body } = await c.req.json();
  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(mail_templates).where(eq(mail_templates.id, id)).limit(1);
  if (!existing) return c.json({ error: "模板不存在" }, 404);
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) upd.name = name;
  if (subject !== undefined) upd.subject = subject;
  if (html_body !== undefined) upd.html_body = html_body;
  if (text_body !== undefined) upd.text_body = text_body || null;
  await db.update(mail_templates).set(upd).where(eq(mail_templates.id, id));
  return c.json({ ok: true });
});

router.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(mail_templates).where(eq(mail_templates.id, id)).limit(1);
  if (!existing) return c.json({ error: "模板不存在" }, 404);
  const [{ n }] = await db
    .select({ n: count() })
    .from(campaigns)
    .where(eq(campaigns.template_id, id));
  if (n > 0) return c.json({ error: `该模板被 ${n} 个任务引用,无法删除` }, 400);
  await db.delete(mail_templates).where(eq(mail_templates.id, id));
  return c.json({ ok: true });
});

export default router;