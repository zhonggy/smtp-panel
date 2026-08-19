// ===== Dashboard 汇总 =====
import { Hono } from "hono";
import { eq, and, count, sql, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { smtp_accounts, smtp_daily_stats, send_logs, campaigns } from "@panel/db";
import type { AppEnv } from "../../env";
import { todayUTC } from "@panel/shared";

const router = new Hono<AppEnv>();

router.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const today = todayUTC();
  const todayStart = today + "T00:00:00.000Z";

  // 今日发送统计
  let today_total = 0,
    today_success = 0,
    today_failed = 0;
  const todayRows = await db
    .select({ status: send_logs.status, n: count() })
    .from(send_logs)
    .where(sql`created_at >= ${todayStart}`)
    .groupBy(send_logs.status);
  for (const r of todayRows) {
    if (r.status === "success") today_success = r.n;
    else if (r.status === "failed") today_failed = r.n;
    today_total += r.n;
  }

  // SMTP 统计
  const allSmtp = await db.select().from(smtp_accounts);
  const enabled = allSmtp.filter((a) => a.enabled).length;

  // 今日 SMTP 用量
  const smtpUsage = await db
    .select({
      id: smtp_accounts.id,
      name: smtp_accounts.name,
      enabled: smtp_accounts.enabled,
      daily_limit: smtp_accounts.daily_limit,
      today_total: smtp_daily_stats.total,
      today_success: smtp_daily_stats.success,
      today_failed: smtp_daily_stats.failed,
    })
    .from(smtp_accounts)
    .leftJoin(
      smtp_daily_stats,
      and(eq(smtp_daily_stats.smtp_id, smtp_accounts.id), eq(smtp_daily_stats.date, today)),
    )
    .orderBy(smtp_accounts.id);

  // 任务状态统计
  const campRows = await db
    .select({ status: campaigns.status, n: count() })
    .from(campaigns)
    .groupBy(campaigns.status);
  const pick = (s: string) => campRows.find((r) => r.status === s)?.n ?? 0;

  // 最近 7 天趋势
  const trendData = await db
    .select({
      date: sql<string>`substr(created_at, 1, 10)`,
      status: send_logs.status,
      n: count(),
    })
    .from(send_logs)
    .where(sql`created_at >= ${new Date(Date.now() - 7 * 86400000).toISOString()}`)
    .groupBy(sql`substr(created_at, 1, 10)`, send_logs.status)
    .orderBy(sql`substr(created_at, 1, 10)`);
  const trendMap = new Map<string, { total: number; success: number; failed: number }>();
  for (const r of trendData) {
    if (!trendMap.has(r.date)) trendMap.set(r.date, { total: 0, success: 0, failed: 0 });
    const entry = trendMap.get(r.date)!;
    entry.total += r.n;
    if (r.status === "success") entry.success += r.n;
    else if (r.status === "failed") entry.failed += r.n;
  }
  const trend = Array.from(trendMap.entries()).map(([date, v]) => ({ date, ...v }));

  // 最近错误(最近 5 条失败日志)
  const recentErrors = await db
    .select()
    .from(send_logs)
    .where(eq(send_logs.status, "failed"))
    .orderBy(desc(send_logs.id))
    .limit(5);

  return c.json({
    today: { total: today_total, success: today_success, failed: today_failed },
    smtp: { total: allSmtp.length, enabled },
    campaigns: {
      sending: pick("sending"),
      queued: pick("queued"),
      paused: pick("paused"),
      draft: pick("draft"),
    },
    trend,
    recent_errors: recentErrors.map((e) => ({
      id: e.id,
      recipient: e.recipient,
      subject: e.subject,
      error: e.error,
      created_at: e.created_at,
    })),
    smtp_usage: smtpUsage.map((s) => ({
      id: s.id,
      name: s.name,
      today_total: s.today_total ?? 0,
      today_success: s.today_success ?? 0,
      today_failed: s.today_failed ?? 0,
      daily_limit: s.daily_limit,
      enabled: s.enabled,
    })),
  });
});

export default router;