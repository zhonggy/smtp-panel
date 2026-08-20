/**
 * Queue Consumer: 处理发信 tick。
 *
 * 每个 tick 处理一批收件人(批大小 = speed_limit),完成后入队下个 tick(delay 60s)。
 *
 * 关键行为:
 *  - SMTP 池模式:每封邮件从池中挑选账号,按剩余额度与权重加权;连接按账号缓存复用
 *  - 退信分类:每次失败都归类,决定 重试 / 放弃 / 加入抑制名单 / 冷却账号 / 暂停任务
 *  - 抑制名单:启动时已过滤;发送中命中硬退信的地址会写入名单,后续任务自动跳过
 *  - DB 写入统一走 D1 batch,避免逐条往返
 */
import { eq, and, count, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  campaigns,
  campaign_recipients,
  smtp_accounts,
  mail_templates,
} from "@panel/db";
import { SmtpClient, buildMime, SmtpError, classifyBounce } from "@panel/mail";
import type { BounceCategory } from "@panel/mail";
import { renderTemplate, recipientTemplateVars, todayUTC, sleep, chunk } from "@panel/shared";
import { decryptText } from "../api/crypto";
import { tickKey, TICK_LOCK_TTL } from "../api/queue";
import type { Env, QueueMessage } from "../env";
import { SmtpPool, loadCandidates, healthStatements, type PoolCandidate } from "./pool";

interface SendResult {
  id: number;
  email: string;
  retry_count: number;
  smtp_id: number;
  smtp_name: string;
  ok: boolean;
  error?: string;
  category?: BounceCategory;
  code?: number;
  enhanced?: string;
  suppress?: boolean;
  duration_ms: number;
  subject: string;
}

/** 主入口:分发队列消息 */
export async function handleQueueMessage(env: Env, msg: QueueMessage): Promise<void> {
  if (msg?.type === "campaign_tick" && typeof msg.campaign_id === "number") {
    await handleCampaignTick(env, msg.campaign_id);
  }
}

/** 处理单个 Campaign 的 tick */
async function handleCampaignTick(env: Env, campaignId: number): Promise<void> {
  const db = drizzle(env.DB);

  // 1) 锁检测:防止重复 tick(KV 锁缺失 = 过期/重复消息)
  const lock = await env.KV.get(tickKey(campaignId));
  if (lock === null) return;

  // 2) 加载任务
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!camp) return;
  if (camp.status !== "queued" && camp.status !== "sending") return;

  const now = new Date().toISOString();
  if (camp.status === "queued") {
    await db
      .update(campaigns)
      .set({ status: "sending", started_at: camp.started_at ?? now, updated_at: now })
      .where(eq(campaigns.id, campaignId));
  } else {
    await db.update(campaigns).set({ updated_at: now }).where(eq(campaigns.id, campaignId));
  }

  // 3) 剩余待发送数
  const [{ n: pendingCount }] = await db
    .select({ n: count() })
    .from(campaign_recipients)
    .where(
      and(eq(campaign_recipients.campaign_id, campaignId), eq(campaign_recipients.status, "pending")),
    );
  if (pendingCount === 0) {
    await finalizeCampaign(env, campaignId);
    return;
  }

  // 4) 加载 SMTP 候选(池模式 = 多账号轮换;单账号模式 = 仅该账号)
  const candidates = await loadCandidates(env, {
    poolIds: camp.use_pool ? camp.pool_smtp_ids : undefined,
    singleId: camp.use_pool ? undefined : camp.smtp_id,
  });
  if (candidates.length === 0) {
    await pauseCampaign(
      env,
      campaignId,
      camp.use_pool
        ? "SMTP 池中没有可用账号(全部禁用、冷却中或额度已用尽)"
        : "SMTP 账号不可用(已禁用、冷却中或今日额度已用尽)",
    );
    return;
  }
  const pool = new SmtpPool(candidates);

  // 5) 批大小 = min(速度, 待发送数, 池剩余总额度)
  const capacity = pool.capacity;
  const batchSize = Math.max(
    1,
    Math.min(camp.speed_limit, pendingCount, capacity === Infinity ? camp.speed_limit : capacity),
  );

  // 6) 加载模板
  const [tpl] = await db
    .select()
    .from(mail_templates)
    .where(eq(mail_templates.id, camp.template_id))
    .limit(1);
  if (!tpl) {
    await pauseCampaign(env, campaignId, "邮件模板不存在");
    return;
  }

  // 7) 取批量收件人
  const batch = await db
    .select()
    .from(campaign_recipients)
    .where(
      and(eq(campaign_recipients.campaign_id, campaignId), eq(campaign_recipients.status, "pending")),
    )
    .orderBy(campaign_recipients.id)
    .limit(batchSize);

  // 8) 过滤抑制名单(启动后新增的硬退信地址)
  const emails = batch.map((r) => r.email);
  const suppressedSet = new Set<string>();
  if (emails.length > 0) {
    for (const part of chunk(emails, 50)) {
      const placeholders = part.map(() => "?").join(",");
      const rows = await env.DB.prepare(
        `SELECT email FROM suppressions WHERE email IN (${placeholders})`,
      )
        .bind(...part)
        .all<{ email: string }>();
      for (const row of rows.results ?? []) suppressedSet.add(row.email);
    }
  }
  const sendable = batch.filter((r) => !suppressedSet.has(r.email));
  const skipped = batch.filter((r) => suppressedSet.has(r.email));

  // 9) 逐封发送(池模式下按账号缓存连接)
  const connections = new Map<number, SmtpClient>();
  const passwords = new Map<number, string>();
  const results: SendResult[] = [];
  const failureCounters = new Map<number, number>();
  let fatalError: string | null = null;
  const pacingMs = Math.max(1000, Math.min(10000, Math.floor(60000 / Math.max(1, batchSize))));

  for (let i = 0; i < sendable.length; i++) {
    const r = sendable[i];
    const smtp = pool.pick();
    if (!smtp) {
      // 池内额度耗尽,剩余留待下个 tick
      break;
    }

    const vars = recipientTemplateVars(r);
    const subject = renderTemplate(tpl.subject, vars);
    const html = renderTemplate(tpl.html_body, vars);
    const text = tpl.text_body ? renderTemplate(tpl.text_body, vars) : undefined;
    const mime = buildMime({
      fromName: smtp.from_name || smtp.username,
      fromEmail: smtp.from_email,
      replyTo: smtp.reply_to ?? undefined,
      toEmail: r.email,
      toName: r.name ?? undefined,
      subject,
      html,
      text,
    });

    const t0 = Date.now();
    try {
      let client = connections.get(smtp.id);
      if (!client) {
        let password = passwords.get(smtp.id);
        if (password === undefined) {
          password = await decryptText(env, smtp.password_encrypted);
          passwords.set(smtp.id, password);
        }
        client = await SmtpClient.connect({
          host: smtp.host,
          port: smtp.port,
          security: smtp.security as "ssl" | "starttls" | "none",
          username: smtp.username,
          password,
          timeoutMs: 15000,
        });
        connections.set(smtp.id, client);
      }
      await client.sendMail(smtp.from_email, r.email, mime);
      results.push({
        id: r.id,
        email: r.email,
        retry_count: r.retry_count,
        smtp_id: smtp.id,
        smtp_name: smtp.name,
        ok: true,
        duration_ms: Date.now() - t0,
        subject,
      });
      failureCounters.set(smtp.id, 0);
    } catch (err) {
      const se = err as SmtpError;
      const cls = classifyBounce({
        stage: se.stage,
        code: se.code,
        message: se.message,
      });
      const prevFailures = failureCounters.get(smtp.id) ?? 0;
      failureCounters.set(smtp.id, prevFailures + 1);

      results.push({
        id: r.id,
        email: r.email,
        retry_count: r.retry_count,
        smtp_id: smtp.id,
        smtp_name: smtp.name,
        ok: false,
        error: `[${cls.label}]${se.code ? ` ${se.code}` : ""} ${se.message}`.trim(),
        category: cls.category,
        code: cls.code,
        enhanced: cls.enhanced,
        suppress: cls.suppress,
        duration_ms: Date.now() - t0,
        subject,
      });

      // 连接可能已损坏,丢弃以便重连
      const broken = connections.get(smtp.id);
      broken?.close();
      connections.delete(smtp.id);

      if (cls.fatal) {
        // 账号级故障:本 tick 内不再使用该账号
        pool.markUnusable(smtp.id);
        if (!pool.available) {
          // 所有账号都不可用 → 暂停任务
          fatalError = `${cls.label}: ${se.message}`;
          break;
        }
      }
    }
    if (i < sendable.length - 1) await sleep(pacingMs);
  }

  // 关闭全部连接
  for (const client of connections.values()) {
    try {
      await client.quit();
    } catch {
      client.close();
    }
  }

  // 10) 写回结果
  const sentAt = new Date().toISOString();
  const today = todayUTC();
  const stmts: D1PreparedStatement[] = [];

  // 抑制名单命中的收件人:直接标记,不计失败
  for (const r of skipped) {
    stmts.push(
      env.DB.prepare(
        `UPDATE campaign_recipients
           SET status = 'failed', suppressed = 1, bounce_category = 'invalid_recipient',
               last_error = '命中抑制名单,已跳过'
         WHERE id = ?`,
      ).bind(r.id),
    );
  }

  let okCount = 0;
  let failCount = 0;
  let retryCount = 0;
  /** 按 smtp_id 聚合的当日统计增量 */
  const perSmtp = new Map<number, { attempts: number; ok: number; failed: number }>();
  /** 按 (category, smtp_id) 聚合的退信统计 */
  const bounceAgg = new Map<string, { category: string; smtp_id: number; count: number }>();

  for (const res of results) {
    const agg = perSmtp.get(res.smtp_id) ?? { attempts: 0, ok: 0, failed: 0 };
    agg.attempts++;

    if (res.ok) {
      okCount++;
      agg.ok++;
      stmts.push(
        env.DB.prepare(
          `UPDATE campaign_recipients
             SET status = 'sent', sent_at = ?, last_error = NULL,
                 bounce_category = NULL, last_smtp_id = ?
           WHERE id = ?`,
        ).bind(sentAt, res.smtp_id, res.id),
      );
    } else {
      const cls = res.category ?? "unknown";
      // 退信统计
      const key = `${cls}|${res.smtp_id}`;
      const b = bounceAgg.get(key) ?? { category: cls, smtp_id: res.smtp_id, count: 0 };
      b.count++;
      bounceAgg.set(key, b);

      if (res.suppress) {
        // 硬退信:标记失败 + 写入抑制名单,不再重试
        failCount++;
        agg.failed++;
        stmts.push(
          env.DB.prepare(
            `UPDATE campaign_recipients
               SET status = 'failed', suppressed = 1, last_error = ?,
                   bounce_category = ?, last_smtp_id = ?
             WHERE id = ?`,
          ).bind(res.error ?? "", cls, res.smtp_id, res.id),
        );
        stmts.push(
          env.DB.prepare(
            `INSERT INTO suppressions (email, reason, bounce_category, smtp_code, detail, campaign_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(email) DO NOTHING`,
          ).bind(
            res.email,
            cls,
            cls,
            res.code ?? null,
            (res.error ?? "").slice(0, 500),
            campaignId,
            sentAt,
          ),
        );
      } else {
        const canRetry = res.retry_count + 1 < camp.retry_limit;
        if (canRetry) {
          retryCount++;
          agg.failed++;
          stmts.push(
            env.DB.prepare(
              `UPDATE campaign_recipients
                 SET retry_count = retry_count + 1, last_error = ?,
                     bounce_category = ?, last_smtp_id = ?
               WHERE id = ?`,
            ).bind(res.error ?? "", cls, res.smtp_id, res.id),
          );
        } else {
          failCount++;
          agg.failed++;
          stmts.push(
            env.DB.prepare(
              `UPDATE campaign_recipients
                 SET status = 'failed', last_error = ?, bounce_category = ?, last_smtp_id = ?
               WHERE id = ?`,
            ).bind(res.error ?? "", cls, res.smtp_id, res.id),
          );
        }
      }
    }
    perSmtp.set(res.smtp_id, agg);

    // 发送日志
    stmts.push(
      env.DB.prepare(
        `INSERT INTO send_logs
           (campaign_id, campaign_name, smtp_id, smtp_name, recipient, subject,
            status, error, bounce_category, smtp_code, enhanced_code, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        campaignId,
        camp.name,
        res.smtp_id,
        res.smtp_name,
        res.email,
        res.subject,
        res.ok ? "success" : "failed",
        res.error ?? null,
        res.ok ? null : (res.category ?? "unknown"),
        res.code ?? null,
        res.enhanced ?? null,
        res.duration_ms,
        sentAt,
      ),
    );
  }

  // SMTP 每日统计(按账号分别 upsert)
  for (const [smtpId, agg] of perSmtp) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO smtp_daily_stats (smtp_id, date, total, success, failed) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(smtp_id, date) DO UPDATE SET
           total = total + ?, success = success + ?, failed = failed + ?`,
      ).bind(smtpId, today, agg.attempts, agg.ok, agg.failed, agg.attempts, agg.ok, agg.failed),
    );
  }

  // 退信分类每日统计
  for (const b of bounceAgg.values()) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO bounce_daily_stats (date, category, smtp_id, count) VALUES (?, ?, ?, ?)
         ON CONFLICT(date, category, smtp_id) DO UPDATE SET count = count + ?`,
      ).bind(today, b.category, b.smtp_id, b.count, b.count),
    );
  }

  // SMTP 健康状态(冷却 / 失败计数)
  const healthUpdates = [...perSmtp.entries()].map(([smtpId, agg]) => {
    const lastFail = [...results].reverse().find((r) => r.smtp_id === smtpId && !r.ok);
    return {
      smtpId,
      ok: agg.ok > 0 && agg.failed === 0,
      error: lastFail?.error,
      category: lastFail?.category,
      consecutiveFailures: failureCounters.get(smtpId) ?? 0,
    };
  });
  stmts.push(...healthStatements(env, healthUpdates));

  for (const part of chunk(stmts, 100)) {
    await env.DB.batch(part);
  }

  // 11) 重算任务计数(权威来源:campaign_recipients)
  const counts = await db
    .select({ status: campaign_recipients.status, n: count() })
    .from(campaign_recipients)
    .where(eq(campaign_recipients.campaign_id, campaignId))
    .groupBy(campaign_recipients.status);
  const cntMap = new Map(counts.map((x) => [x.status, x.n]));
  const newPending = cntMap.get("pending") ?? 0;
  const newSuccess = cntMap.get("sent") ?? 0;
  const newFailed = cntMap.get("failed") ?? 0;

  const [{ n: suppressedTotal }] = await db
    .select({ n: count() })
    .from(campaign_recipients)
    .where(
      and(eq(campaign_recipients.campaign_id, campaignId), eq(campaign_recipients.suppressed, true)),
    );

  await db
    .update(campaigns)
    .set({
      pending: newPending,
      success: newSuccess,
      failed: newFailed,
      suppressed: suppressedTotal,
      updated_at: new Date().toISOString(),
    })
    .where(eq(campaigns.id, campaignId));

  // 12) 决定下一步(重新读状态,防止期间被暂停/取消)
  const [current] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!current || !["sending", "queued"].includes(current.status)) return;

  if (fatalError) {
    await pauseCampaign(env, campaignId, fatalError);
  } else if (newPending > 0) {
    await env.KV.put(tickKey(campaignId), Date.now().toString(), {
      expirationTtl: TICK_LOCK_TTL,
    });
    await env.MAIL_QUEUE.send(
      { type: "campaign_tick", campaign_id: campaignId },
      { delaySeconds: 60 },
    );
  } else {
    await finalizeCampaign(env, campaignId);
  }
}

/** 完成任务(仅当仍处于 sending/queued) */
async function finalizeCampaign(env: Env, campaignId: number): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE campaigns SET status = 'completed', finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('sending', 'queued')",
  )
    .bind(now, now, campaignId)
    .run();
}

/** 暂停任务(仅当仍处于 sending/queued) */
async function pauseCampaign(env: Env, campaignId: number, error: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE campaigns SET status = 'paused', last_error = ?, updated_at = ? WHERE id = ? AND status IN ('sending', 'queued')",
  )
    .bind(error.slice(0, 500), now, campaignId)
    .run();
}

/**
 * 定时巡检(Cron 每分钟):
 *   1. 到点的定时任务 → 启动
 *   2. 卡住的任务     → 重新入队
 */
export async function runWatchdog(env: Env): Promise<void> {
  await startDueCampaigns(env);
  await reviveStalledCampaigns(env);
}

/** 启动已到时间的定时任务 */
async function startDueCampaigns(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const due = await env.DB.prepare(
    `SELECT id FROM campaigns
      WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
      ORDER BY scheduled_at LIMIT 20`,
  )
    .bind(now)
    .all<{ id: number }>();

  for (const row of due.results ?? []) {
    try {
      const started = await materializeAndQueue(env, row.id);
      if (started) {
        console.log(`[scheduler] 定时任务 #${row.id} 已启动`);
      }
    } catch (e) {
      console.error(`[scheduler] 启动定时任务 #${row.id} 失败:`, e);
      await env.DB.prepare(
        "UPDATE campaigns SET status = 'paused', last_error = ?, updated_at = ? WHERE id = ?",
      )
        .bind(`定时启动失败: ${e instanceof Error ? e.message : String(e)}`, now, row.id)
        .run();
    }
  }
}

/**
 * 快照收件人并入队(定时启动与手动启动共用)。
 * @returns false 表示没有有效收件人
 */
export async function materializeAndQueue(env: Env, campaignId: number): Promise<boolean> {
  const db = drizzle(env.DB);
  const now = new Date().toISOString();
  const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!camp) return false;

  // 已有快照则不重复生成(恢复场景)
  const [{ n: existing }] = await db
    .select({ n: count() })
    .from(campaign_recipients)
    .where(eq(campaign_recipients.campaign_id, campaignId));

  if (existing === 0) {
    if (camp.test_email) {
      await db.insert(campaign_recipients).values({
        campaign_id: campaignId,
        recipient_id: null,
        email: camp.test_email,
        name: "测试收件人",
        status: "pending",
      });
    } else {
      // 排除抑制名单中的地址
      await db.run(
        sql`INSERT INTO campaign_recipients (campaign_id, recipient_id, email, name, status)
            SELECT ${campaignId}, r.id, r.email, r.name, 'pending'
              FROM recipients r
             WHERE r.status = 'active'
               AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email = r.email)`,
      );
    }
  }

  const [{ n: total }] = await db
    .select({ n: count() })
    .from(campaign_recipients)
    .where(eq(campaign_recipients.campaign_id, campaignId));
  if (total === 0) return false;

  await db
    .update(campaigns)
    .set({ total, pending: total, status: "queued", updated_at: now })
    .where(eq(campaigns.id, campaignId));

  await env.KV.put(tickKey(campaignId), Date.now().toString(), { expirationTtl: TICK_LOCK_TTL });
  await env.MAIL_QUEUE.send({ type: "campaign_tick", campaign_id: campaignId }, { delaySeconds: 0 });
  return true;
}

/** 恢复卡住的任务 */
async function reviveStalledCampaigns(env: Env): Promise<void> {
  const stale = await env.DB.prepare(
    "SELECT id, updated_at FROM campaigns WHERE status IN ('sending', 'queued')",
  ).all<{ id: number; updated_at: string }>();

  for (const c of stale.results ?? []) {
    const age = Date.now() - new Date(c.updated_at).getTime();
    const lock = await env.KV.get(tickKey(c.id));
    if ((age > 240_000 && lock === null) || age > 900_000) {
      await env.KV.put(tickKey(c.id), Date.now().toString(), { expirationTtl: TICK_LOCK_TTL });
      await env.MAIL_QUEUE.send({ type: "campaign_tick", campaign_id: c.id }, { delaySeconds: 0 });
    }
  }
}
