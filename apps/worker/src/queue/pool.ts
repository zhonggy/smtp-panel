/**
 * SMTP 池调度器。
 *
 * 职责:在池模式下为每一封邮件挑选可用 SMTP 账号,并在发送后回写健康状态。
 *
 * 选择策略(逐层过滤后加权选优):
 *   1. 排除:禁用 / 不在池中 / 冷却未到期 / 今日额度已用尽
 *   2. 排序:剩余额度比例高者优先 → 最久未使用者优先
 *   3. 权重:weight 作为剩余额度比例的乘数,实现按容量倾斜分配
 *
 * 健康管理:
 *   - 连续失败达阈值 → 进入冷却(指数退避,上限 60 分钟)
 *   - 限额类错误    → 直接冷却到次日 UTC 零点
 *   - 成功一次      → 清零连续失败计数
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { smtp_accounts, smtp_daily_stats } from "@panel/db";
import { todayUTC } from "@panel/shared";
import type { BounceCategory } from "@panel/mail";

/** 触发冷却的连续失败次数 */
const COOLDOWN_THRESHOLD = 3;
/** 冷却基数(毫秒):3 次失败 → 2 分钟,之后指数增长 */
const COOLDOWN_BASE_MS = 120_000;
const COOLDOWN_MAX_MS = 3_600_000;

export interface PoolCandidate {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password_encrypted: string;
  security: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  daily_limit: number;
  weight: number;
  /** 今日已发送(尝试数) */
  used_today: number;
  /** 今日剩余额度;Infinity 表示不限 */
  remaining: number;
}

/**
 * 加载可用候选账号。
 *
 * @param poolIds 限定候选范围(逗号分隔字符串或 null = 全部在池账号)
 * @param singleId 非池模式:仅加载该账号(仍做冷却与额度检查)
 */
export async function loadCandidates(
  env: { DB: D1Database },
  opts: { poolIds?: string | null; singleId?: number },
): Promise<PoolCandidate[]> {
  const db = drizzle(env.DB);
  const today = todayUTC();
  const nowISO = new Date().toISOString();

  const conds = [eq(smtp_accounts.enabled, true)];
  if (opts.singleId !== undefined) {
    conds.push(eq(smtp_accounts.id, opts.singleId));
  } else {
    conds.push(eq(smtp_accounts.in_pool, true));
    const ids = parsePoolIds(opts.poolIds);
    if (ids.length > 0) {
      conds.push(sql`${smtp_accounts.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    }
  }
  // 冷却已过期或未设置
  conds.push(
    or(isNull(smtp_accounts.cooldown_until), sql`${smtp_accounts.cooldown_until} <= ${nowISO}`)!,
  );

  const rows = await db
    .select({
      a: smtp_accounts,
      used: smtp_daily_stats.total,
    })
    .from(smtp_accounts)
    .leftJoin(
      smtp_daily_stats,
      and(eq(smtp_daily_stats.smtp_id, smtp_accounts.id), eq(smtp_daily_stats.date, today)),
    )
    .where(and(...conds));

  const out: PoolCandidate[] = [];
  for (const { a, used } of rows) {
    const usedToday = used ?? 0;
    const remaining = a.daily_limit > 0 ? a.daily_limit - usedToday : Number.POSITIVE_INFINITY;
    if (remaining <= 0) continue; // 额度用尽
    out.push({
      id: a.id,
      name: a.name,
      host: a.host,
      port: a.port,
      username: a.username,
      password_encrypted: a.password_encrypted,
      security: a.security,
      from_name: a.from_name,
      from_email: a.from_email,
      reply_to: a.reply_to,
      daily_limit: a.daily_limit,
      weight: Math.max(1, a.weight),
      used_today: usedToday,
      remaining,
    });
  }
  return out;
}

export function parsePoolIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * 池内调度器:在一个 tick 生命周期内跟踪本地计数,
 * 避免同一批次内把额度打爆(DB 统计是批次结束后才写入)。
 */
export class SmtpPool {
  private candidates: PoolCandidate[];
  /** 本 tick 内各账号已分配的发送数 */
  private allocated = new Map<number, number>();
  /** 本 tick 内被判定不可用的账号(限额/连接故障) */
  private disabled = new Set<number>();

  constructor(candidates: PoolCandidate[]) {
    this.candidates = candidates;
  }

  /** 池中是否还有可用账号 */
  get available(): boolean {
    return this.candidates.some((c) => this.usable(c));
  }

  /** 本 tick 可发送的总封数上限 */
  get capacity(): number {
    let sum = 0;
    for (const c of this.candidates) {
      if (this.disabled.has(c.id)) continue;
      const left = c.remaining - (this.allocated.get(c.id) ?? 0);
      if (left === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
      sum += Math.max(0, left);
    }
    return sum;
  }

  private usable(c: PoolCandidate): boolean {
    if (this.disabled.has(c.id)) return false;
    return c.remaining - (this.allocated.get(c.id) ?? 0) > 0;
  }

  /**
   * 选择下一个账号。
   * 评分 = 剩余额度比例 × weight;比例相同则选本 tick 分配最少的。
   */
  pick(): PoolCandidate | null {
    let best: PoolCandidate | null = null;
    let bestScore = -1;
    for (const c of this.candidates) {
      if (!this.usable(c)) continue;
      const alloc = this.allocated.get(c.id) ?? 0;
      const ratio =
        c.remaining === Number.POSITIVE_INFINITY
          ? 1
          : (c.remaining - alloc) / Math.max(1, c.daily_limit);
      // 分配越少越优先(同比例时轮转)
      const score = ratio * c.weight - alloc * 1e-6;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) this.allocated.set(best.id, (this.allocated.get(best.id) ?? 0) + 1);
    return best;
  }

  /** 标记账号在本 tick 内不可再用(限额触顶 / 连接不可用) */
  markUnusable(id: number): void {
    this.disabled.add(id);
  }

  /** 本 tick 各账号分配情况(用于日志) */
  get allocation(): { id: number; name: string; count: number }[] {
    return [...this.allocated.entries()].map(([id, count]) => ({
      id,
      name: this.candidates.find((c) => c.id === id)?.name ?? String(id),
      count,
    }));
  }
}

/** 计算冷却截止时间 */
export function computeCooldown(
  category: BounceCategory,
  consecutiveFailures: number,
): string | null {
  // 限额类:冷却到次日 UTC 零点(额度按天重置)
  if (category === "rate_limited") {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    return tomorrow.toISOString();
  }
  // 凭据/策略类:长冷却,需人工介入
  if (category === "auth" || category === "blocked" || category === "sender_rejected") {
    return new Date(Date.now() + COOLDOWN_MAX_MS).toISOString();
  }
  // 连接/超时类:指数退避
  if (consecutiveFailures >= COOLDOWN_THRESHOLD) {
    const factor = 2 ** (consecutiveFailures - COOLDOWN_THRESHOLD);
    const ms = Math.min(COOLDOWN_BASE_MS * factor, COOLDOWN_MAX_MS);
    return new Date(Date.now() + ms).toISOString();
  }
  return null;
}

/** 生成「记录 SMTP 健康状态」的预编译语句 */
export function healthStatements(
  env: { DB: D1Database },
  updates: {
    smtpId: number;
    ok: boolean;
    error?: string;
    category?: BounceCategory;
    consecutiveFailures: number;
  }[],
): D1PreparedStatement[] {
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  for (const u of updates) {
    if (u.ok) {
      stmts.push(
        env.DB.prepare(
          `UPDATE smtp_accounts
             SET consecutive_failures = 0, cooldown_until = NULL,
                 last_error = NULL, last_used_at = ?, updated_at = ?
           WHERE id = ?`,
        ).bind(now, now, u.smtpId),
      );
    } else {
      const cooldown = u.category ? computeCooldown(u.category, u.consecutiveFailures) : null;
      stmts.push(
        env.DB.prepare(
          `UPDATE smtp_accounts
             SET consecutive_failures = ?, cooldown_until = ?,
                 last_error = ?, last_error_at = ?, last_used_at = ?, updated_at = ?
           WHERE id = ?`,
        ).bind(
          u.consecutiveFailures,
          cooldown,
          (u.error ?? "").slice(0, 500),
          now,
          now,
          now,
          u.smtpId,
        ),
      );
    }
  }
  return stmts;
}
