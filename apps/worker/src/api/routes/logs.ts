// ===== 发送日志查询 =====
import { Hono } from "hono";
import { eq, desc, count, and, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { send_logs } from "@panel/db";
import type { AppEnv } from "../../env";

const router = new Hono<AppEnv>();

router.get("/", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query("page_size") ?? "20", 10)));
  const status = c.req.query("status");
  const campaignId = c.req.query("campaign_id");
  const search = c.req.query("search")?.trim();
  const db = drizzle(c.env.DB);

  const conds: any[] = [];
  if (status === "success" || status === "failed") conds.push(eq(send_logs.status, status));
  if (campaignId) {
    const id = parseInt(campaignId, 10);
    if (!isNaN(id)) conds.push(eq(send_logs.campaign_id, id));
  }
  if (search) {
    conds.push(
      or(
        like(send_logs.recipient, `%${search}%`),
        like(send_logs.subject, `%${search}%`),
        like(send_logs.error, `%${search}%`),
      ),
    );
  }
  const where = conds.length ? and(...conds) : undefined;

  const [items, [{ n }]] = await Promise.all([
    db
      .select()
      .from(send_logs)
      .where(where)
      .orderBy(desc(send_logs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(send_logs).where(where),
  ]);
  return c.json({ items, total: n, page, page_size: pageSize });
});

export default router;