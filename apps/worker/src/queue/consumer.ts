/**
 * Queue Consumer: 处理发信 tick。
 *
 * 每个 tick 处理一批收件人(batch = speed_limit),发送完毕后再入队下个 tick(delay 60s)。
 * 单 SMTP 连接复用;连接级错误会暂停任务。
 * DB 更新使用 D1 batch,避免逐条往返。
 */
import { eq, and, count, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  campaigns,
  campaign_recipients,
  smtp_accounts,
  mail_templates,
  smtp_daily_stats,
} from "@panel/db";
import { SmtpClient, buildMime, SmtpError } from "@panel/mail";
import { renderTemplate, recipientTemplateVars, todayUTC, sleep, chunk } from "@panel/shared";
import { decryptText } from "../api/crypto";
import { tickKey, TICK_LOCK_TTL } from "../api/queue";
import type { Env, QueueMessage } from "../env";

interface SendResult {
  id: number;
  email: string;
  retry_count: number;
  ok: boolean;
  error?: string;
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
      .set({ status: "sending", started_at: now, updated_at: now })
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

  // 4) 加载 SMTP 配置
  const [smtp] = await db.select().from(smtp_accounts).where(eq(smtp_accounts.id, camp.smtp_id)).limit(1);
  if (!smtp || !smtp.enabled) {
    await pauseCampaign(env, campaignId, "SMTP 账号不存在或已禁用");
    return;
  }

  // 5) 每日限额检查
  const today = todayUTC();
  const [stat] = await db
    .select()
    .from(smtp_daily_stats)
    .where(and(eq(smtp_daily_stats.smtp_id, smtp.id), eq(smtp_daily_stats.date, today)))
    .limit(1);
  const used = stat?.total ?? 0;
  const allowed = smtp.daily_limit > 0 ? smtp.daily_limit - used : pendingCount;
  if (allowed <= 0) {
    await pauseCampaign(env, campaignId, `SMTP 每日发送额度已用完(${smtp.daily_limit}/日)`);
    return;
  }
  const batchSize = Math.max(1, Math.min(camp.speed_limit, pendingCount, allowed));

  // 6) 加载模板
  const [tpl] = await db.select().from(mail_templates).where(eq(mail_templates.id, camp.template_id)).limit(1);
  if (!tpl) {
    await pauseCampaign(env, campaignId, "邮件模板不存在");
    return;
  }

  // 7) 解密密码
  const password = await decryptText(env, smtp.password_encrypted);

  // 8) 取批量收件人
  const batch = await db
    .select()
    .from(campaign_recipients)
    .where(
      and(eq(campaign_recipients.campaign_id, campaignId), eq(campaign_recipients.status, "pending")),
    )
    .orderBy(campaign_recipients.id)
    .limit(batchSize);

  // 9) 发送
  let client: SmtpClient | null = null;
  const results: SendResult[] = [];
  let connectionError: string | null = null;
  const pacingMs = Math.max(1000, Math.min(10000, Math.floor(60000 / batchSize)));

  for (let i = 0; i < batch.length; i++) {
    const r = batch[i];
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
      if (!client) {
        client = await SmtpClient.connect({
          host: smtp.host,
          port: smtp.port,
          security: smtp.security as "ssl" | "starttls" | "none",
          username: smtp.username,
          password,
          timeoutMs: 15000,
        });
      }
      await client.sendMail(smtp.from_email, r.email, mime);
      results.push({ id: r.id, email: r.email, retry_count: r.retry_count, ok: true, duration_ms: Date.now() - t0, subject });
    } catch (err) {
      const se = err as SmtpError;
      results.push({
        id: r.id,
        email: r.email,
        retry_count: r.retry_count,
        ok: false,
        error: `${se.stage ?? ""}${se.code ? ` ${se.code}` : ""} ${se.message}`.trim(),
        duration_ms: Date.now() - t0,
        subject,
      });
      client?.close();
      client = null; // 下一个收件人重连
      // 连接级/认证级/超时错误 → 暂停整个任务
      if (se.stage === "connect" || se.stage === "auth" || se.stage === "timeout") {
        connectionError = se.message;
        break;
      }
    }
    if (i < batch.length - 1) await sleep(pacingMs);
  }

  // 关闭连接
  if (client) {
    try {
      await client.quit();
    } catch {
      /* ignore */
    }
  }

  // 10) 应用结果:D1 batch 更新收件人状态 + 写日志
  const sentAt = new Date().toISOString();
  let okCount = 0,
    failCount = 0,
    retryCount = 0;

  const stmts: D1PreparedStatement[] = [];
  for (const res of results) {
    if (res.ok) {
      okCount++;
      stmts.push(
        env.DB.prepare(
          "UPDATE campaign_recipients SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?",
        ).bind(sentAt, res.id),
      );
    } else {
      const willRetry = res.retry_count + 1 < camp.retry_limit;
      if (willRetry) {
        retryCount++;
        stmts.push(
          env.DB.prepare(
            "UPDATE campaign_recipients SET retry_count = retry_count + 1, last_error = ? WHERE id = ?",
          ).bind(res.error ?? "", res.id),
        );
      } else {
        failCount++;
        stmts.push(
          env.DB.prepare(
            "UPDATE campaign_recipients SET status = 'failed', last_error = ? WHERE id = ?",
          ).bind(res.error ?? "", res.id),
        );
      }
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO send_logs (campaign_id, campaign_name, smtp_id, smtp_name, recipient, subject, status, error, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        campaignId,
        camp.name,
        smtp.id,
        smtp.name,
        res.email,
        res.subject,
        res.ok ? "success" : "failed",
        res.error ?? null,
        res.duration_ms,
        sentAt,
      ),
    );
  }

  // 每日统计 upsert(尝试次数计数,含待重试的失败)
  const attempts = okCount + failCount + retryCount;
  if (attempts > 0) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO smtp_daily_stats (smtp_id, date, total, success, failed) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(smtp_id, date) DO UPDATE SET
           total = total + ?, success = success + ?, failed = failed + ?`,
      ).bind(smtp.id, today, attempts, okCount, failCount, attempts, okCount, failCount),
    );
  }

  // 分批执行(每批 ≤ 100 条语句)
  for (const part of chunk(stmts, 100)) {
    await env.DB.batch(part);
  }

  // 11) 重新计算任务计数(权威来源:campaign_recipients 分组计数)
  const counts = await db
    .select({ status: campaign_recipients.status, n: count() })
    .from(campaign_recipients)
    .where(eq(campaign_recipients.campaign_id, campaignId))
    .groupBy(campaign_recipients.status);
  const cntMap = new Map(counts.map((x) => [x.status, x.n]));
  const newPending = cntMap.get("pending") ?? 0;
  const newSuccess = cntMap.get("sent") ?? 0;
  const newFailed = cntMap.get("failed") ?? 0;

  await db
    .update(campaigns)
    .set({
      pending: newPending,
      success: newSuccess,
      failed: newFailed,
      updated_at: new Date().toISOString(),
    })
    .where(eq(campaigns.id, campaignId));

  // 12) 决定下一步(重新读取状态,防止期间被暂停/取消)
  const [current] = await db
    .select({ status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!current || !["sending", "queued"].includes(current.status)) return;

  if (connectionError) {
    await pauseCampaign(env, campaignId, `SMTP 连接异常: ${connectionError}`);
  } else if (newPending > 0) {
    // 继续下个 tick(60 秒后)
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
    .bind(error, now, campaignId)
    .run();
}

/**
 * 定时巡检:恢复卡住的任务
 * - status=sending/queued 且 updated_at 超过 4 分钟且无锁 → 重新入队
 * - 超过 15 分钟强制恢复(忽略锁)
 */
export async function runWatchdog(env: Env): Promise<void> {
  const stale = await env.DB.prepare(
    "SELECT id, updated_at FROM campaigns WHERE status IN ('sending', 'queued')",
  ).all<{ id: number; updated_at: string }>();
  for (const c of stale.results ?? []) {
    const age = Date.now() - new Date(c.updated_at).getTime();
    const lock = await env.KV.get(tickKey(c.id));
    if ((age > 240_000 && lock === null) || age > 900_000) {
      await env.KV.put(tickKey(c.id), Date.now().toString(), { expirationTtl: TICK_LOCK_TTL });
      await env.MAIL_QUEUE.send(
        { type: "campaign_tick", campaign_id: c.id },
        { delaySeconds: 0 },
      );
    }
  }
}
