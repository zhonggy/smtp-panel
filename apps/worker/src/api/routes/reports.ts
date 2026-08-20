// ===== 统计报表 =====
import { Hono } from "hono";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  send_logs,
  smtp_accounts,
  smtp_daily_stats,
  bounce_daily_stats,
  campaigns,
  suppressions,
} from "@panel/db";
import { BOUNCE_LABELS, ALL_BOUNCE_CATEGORIES } from "@panel/mail";
import type { AppEnv } from "../../env";

const router = new Hono<AppEnv>();

/** 解析天数范围(默认 7 天,最大 90) */
function parseDays(raw: string | undefined): number {
  const n = parseInt(raw ?? "7", 10);
  if (!Number.isFinite(n)) return 7;
  return Math.min(90, Math.max(1, n));
}

/** 起始日期(UTC,YYYY-MM-DD) */
function sinceDate(days: number): string {
  const d = new Date(Date.now() - (days - 1) * 86400000);
  return d.toISOString().slice(0, 10);
}

/** 生成连续日期序列(用于补零) */
function dateRange(days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/** 退信分类标签表(前端渲染用) */
router.get("/categories", (c) => {
  return c.json(
    ALL_BOUNCE_CATEGORIES.map((key) => ({ key, label: BOUNCE_LABELS[key] })),
  );
});

/**
 * 概览:指定天数内的发送总量、成功率、退信构成、SMTP 表现
 * GET /api/reports/overview?days=7
 */
router.get("/overview", async (c) => {
  const days = parseDays(c.req.query("days"));
  const since = sinceDate(days);
  const db = drizzle(c.env.DB);

  // 每日发送量(来自 smtp_daily_stats,已聚合,成本低)
  const daily = await db
    .select({
      date: smtp_daily_stats.date,
      total: sql<number>`SUM(${smtp_daily_stats.total})`,
      success: sql<number>`SUM(${smtp_daily_stats.success})`,
      failed: sql<number>`SUM(${smtp_daily_stats.failed})`,
    })
    .from(smtp_daily_stats)
    .where(gte(smtp_daily_stats.date, since))
    .groupBy(smtp_daily_stats.date)
    .orderBy(smtp_daily_stats.date);

  const dailyMap = new Map(daily.map((d) => [d.date, d]));
  const trend = dateRange(days).map((date) => {
    const d = dailyMap.get(date);
    return {
      date,
      total: Number(d?.total ?? 0),
      success: Number(d?.success ?? 0),
      failed: Number(d?.failed ?? 0),
    };
  });

  const totals = trend.reduce(
    (a, t) => ({
      total: a.total + t.total,
      success: a.success + t.success,
      failed: a.failed + t.failed,
    }),
    { total: 0, success: 0, failed: 0 },
  );

  // 退信分类构成
  const bounceRows = await db
    .select({
      category: bounce_daily_stats.category,
      n: sql<number>`SUM(${bounce_daily_stats.count})`,
    })
    .from(bounce_daily_stats)
    .where(gte(bounce_daily_stats.date, since))
    .groupBy(bounce_daily_stats.category);

  const bounceTotal = bounceRows.reduce((a, r) => a + Number(r.n), 0);
  const bounces = bounceRows
    .map((r) => ({
      category: r.category,
      label: BOUNCE_LABELS[r.category as keyof typeof BOUNCE_LABELS] ?? r.category,
      count: Number(r.n),
      ratio: bounceTotal > 0 ? Number(r.n) / bounceTotal : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // SMTP 表现排行
  const smtpRows = await db
    .select({
      id: smtp_daily_stats.smtp_id,
      name: smtp_accounts.name,
      enabled: smtp_accounts.enabled,
      in_pool: smtp_accounts.in_pool,
      cooldown_until: smtp_accounts.cooldown_until,
      daily_limit: smtp_accounts.daily_limit,
      total: sql<number>`SUM(${smtp_daily_stats.total})`,
      success: sql<number>`SUM(${smtp_daily_stats.success})`,
      failed: sql<number>`SUM(${smtp_daily_stats.failed})`,
    })
    .from(smtp_daily_stats)
    .leftJoin(smtp_accounts, eq(smtp_accounts.id, smtp_daily_stats.smtp_id))
    .where(gte(smtp_daily_stats.date, since))
    .groupBy(smtp_daily_stats.smtp_id, smtp_accounts.name)
    .orderBy(desc(sql`SUM(${smtp_daily_stats.total})`));

  const smtp_performance = smtpRows.map((r) => {
    const total = Number(r.total);
    const success = Number(r.success);
    return {
      id: r.id,
      name: r.name ?? `#${r.id}`,
      total,
      success,
      failed: Number(r.failed),
      success_rate: total > 0 ? success / total : 0,
      daily_limit: r.daily_limit ?? 0,
      enabled: r.enabled ?? false,
      in_pool: r.in_pool ?? false,
      cooling: !!(r.cooldown_until && r.cooldown_until > new Date().toISOString()),
    };
  });

  // 任务完成情况
  const campRows = await db
    .select({ status: campaigns.status, n: count() })
    .from(campaigns)
    .groupBy(campaigns.status);
  const campaign_status = Object.fromEntries(campRows.map((r) => [r.status, r.n]));

  // 抑制名单规模
  const [{ n: suppressedTotal }] = await db.select({ n: count() }).from(suppressions);

  return c.json({
    range: { days, since },
    totals: {
      ...totals,
      success_rate: totals.total > 0 ? totals.success / totals.total : 0,
    },
    trend,
    bounces,
    smtp_performance,
    campaign_status,
    suppressed_total: suppressedTotal,
  });
});

/**
 * 退信分类 × 日期 热力数据
 * GET /api/reports/bounces?days=14
 */
router.get("/bounces", async (c) => {
  const days = parseDays(c.req.query("days"));
  const since = sinceDate(days);
  const db = drizzle(c.env.DB);

  const rows = await db
    .select({
      date: bounce_daily_stats.date,
      category: bounce_daily_stats.category,
      n: sql<number>`SUM(${bounce_daily_stats.count})`,
    })
    .from(bounce_daily_stats)
    .where(gte(bounce_daily_stats.date, since))
    .groupBy(bounce_daily_stats.date, bounce_daily_stats.category);

  // 只保留出现过的类别,避免空列
  const seen = new Set(rows.map((r) => r.category));
  const categories = ALL_BOUNCE_CATEGORIES.filter((c) => seen.has(c)).map((key) => ({
    key,
    label: BOUNCE_LABELS[key],
  }));

  const byDate = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const e = byDate.get(r.date) ?? {};
    e[r.category] = Number(r.n);
    byDate.set(r.date, e);
  }
  const matrix = dateRange(days).map((date) => ({
    date,
    counts: byDate.get(date) ?? {},
    total: Object.values(byDate.get(date) ?? {}).reduce((a, b) => a + b, 0),
  }));

  return c.json({ range: { days, since }, categories, matrix });
});

/**
 * 按退信类别列出代表性样本(排查用)
 * GET /api/reports/bounce-samples?category=invalid_recipient&limit=20
 */
router.get("/bounce-samples", async (c) => {
  const category = c.req.query("category");
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10)));
  const db = drizzle(c.env.DB);

  const conds = [eq(send_logs.status, "failed")];
  if (category) conds.push(eq(send_logs.bounce_category, category));

  const rows = await db
    .select({
      id: send_logs.id,
      recipient: send_logs.recipient,
      subject: send_logs.subject,
      smtp_name: send_logs.smtp_name,
      campaign_name: send_logs.campaign_name,
      bounce_category: send_logs.bounce_category,
      smtp_code: send_logs.smtp_code,
      enhanced_code: send_logs.enhanced_code,
      error: send_logs.error,
      created_at: send_logs.created_at,
    })
    .from(send_logs)
    .where(and(...conds))
    .orderBy(desc(send_logs.id))
    .limit(limit);

  return c.json(
    rows.map((r) => ({
      ...r,
      label: r.bounce_category
        ? (BOUNCE_LABELS[r.bounce_category as keyof typeof BOUNCE_LABELS] ?? r.bounce_category)
        : null,
    })),
  );
});

/**
 * 任务维度报表
 * GET /api/reports/campaigns?days=30
 */
router.get("/campaigns", async (c) => {
  const days = parseDays(c.req.query("days"));
  const sinceISO = new Date(Date.now() - days * 86400000).toISOString();
  const db = drizzle(c.env.DB);

  const rows = await db
    .select()
    .from(campaigns)
    .where(gte(campaigns.created_at, sinceISO))
    .orderBy(desc(campaigns.id))
    .limit(200);

  return c.json(
    rows.map((r) => {
      const attempted = r.success + r.failed;
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        use_pool: r.use_pool,
        total: r.total,
        success: r.success,
        failed: r.failed,
        suppressed: r.suppressed,
        pending: r.pending,
        success_rate: attempted > 0 ? r.success / attempted : 0,
        scheduled_at: r.scheduled_at,
        started_at: r.started_at,
        finished_at: r.finished_at,
        created_at: r.created_at,
      };
    }),
  );
});

export default router;
