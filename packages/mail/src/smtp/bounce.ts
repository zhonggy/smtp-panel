/**
 * 退信分类引擎。
 *
 * 把 SMTP 协议错误(阶段 + 响应码 + 文本)归一化为稳定的类别,用于:
 *  - 决定是否重试(临时性 vs 永久性)
 *  - 决定是否暂停任务 / 冷却 SMTP 账号
 *  - 决定是否把收件人加入抑制名单
 *  - 统计报表分组
 *
 * 依据 RFC 5321(基础响应码)与 RFC 3463(增强状态码 x.y.z)。
 */
import type { SmtpStage } from "./client";

/** 退信类别 */
export type BounceCategory =
  /** 连接失败:DNS / 端口不可达 / 网络中断 */
  | "connection"
  /** TLS / STARTTLS 协商失败 */
  | "tls"
  /** 认证失败:账号密码错误、需要授权码 */
  | "auth"
  /** 硬退信:收件人不存在、域名不存在(永久) */
  | "invalid_recipient"
  /** 邮箱满、暂时不可用(临时) */
  | "mailbox_full"
  /** 发件人被拒:from 地址不被接受、缺少 SPF/DKIM */
  | "sender_rejected"
  /** 内容被拒:被判定为垃圾邮件、含病毒、超大 */
  | "content_rejected"
  /** 超出配额 / 频率限制(临时,需降速) */
  | "rate_limited"
  /** 被列入黑名单 / 声誉问题 */
  | "blocked"
  /** 服务器临时错误(4xx 未细分) */
  | "temporary"
  /** 服务器永久拒绝(5xx 未细分) */
  | "permanent"
  /** 操作超时 */
  | "timeout"
  /** 未能归类 */
  | "unknown";

/** 分类结果 */
export interface BounceClassification {
  category: BounceCategory;
  /** true = 可以重试(临时性问题) */
  retryable: boolean;
  /** true = 应停止整个任务(配置/凭据问题,重试无意义) */
  fatal: boolean;
  /** true = 该收件人地址无效,应加入抑制名单不再投递 */
  suppress: boolean;
  /** SMTP 响应码 */
  code?: number;
  /** RFC 3463 增强状态码,如 5.1.1 */
  enhanced?: string;
  /** 人类可读的中文说明 */
  label: string;
}

/** 各类别的中文标签(用于报表与前端展示) */
export const BOUNCE_LABELS: Record<BounceCategory, string> = {
  connection: "连接失败",
  tls: "TLS 失败",
  auth: "认证失败",
  invalid_recipient: "收件人无效",
  mailbox_full: "邮箱已满",
  sender_rejected: "发件人被拒",
  content_rejected: "内容被拒",
  rate_limited: "超出限额",
  blocked: "被拒绝投递",
  temporary: "服务器临时错误",
  permanent: "服务器永久拒绝",
  timeout: "超时",
  unknown: "未知错误",
};

/** 按类别的默认处置策略 */
const POLICY: Record<BounceCategory, { retryable: boolean; fatal: boolean; suppress: boolean }> = {
  connection: { retryable: true, fatal: true, suppress: false },
  tls: { retryable: false, fatal: true, suppress: false },
  auth: { retryable: false, fatal: true, suppress: false },
  invalid_recipient: { retryable: false, fatal: false, suppress: true },
  mailbox_full: { retryable: true, fatal: false, suppress: false },
  sender_rejected: { retryable: false, fatal: true, suppress: false },
  content_rejected: { retryable: false, fatal: false, suppress: false },
  rate_limited: { retryable: true, fatal: true, suppress: false },
  blocked: { retryable: false, fatal: true, suppress: false },
  temporary: { retryable: true, fatal: false, suppress: false },
  permanent: { retryable: false, fatal: false, suppress: false },
  timeout: { retryable: true, fatal: true, suppress: false },
  unknown: { retryable: true, fatal: false, suppress: false },
};

/** 提取 RFC 3463 增强状态码(如 "5.1.1") */
function extractEnhanced(text: string): string | undefined {
  return /\b([245]\.\d{1,3}\.\d{1,3})\b/.exec(text)?.[1];
}

/**
 * 按增强状态码分类(优先级最高,语义最明确)。
 * 参考 RFC 3463 第 3 节的子类定义。
 */
function fromEnhanced(enhanced: string): BounceCategory | null {
  const [cls, subject, detail] = enhanced.split(".").map((n) => parseInt(n, 10));
  const permanent = cls === 5;

  // x.1.x —— 地址相关
  if (subject === 1) {
    if (detail === 1 || detail === 3 || detail === 6 || detail === 10) {
      return permanent ? "invalid_recipient" : "temporary";
    }
    if (detail === 2) return permanent ? "invalid_recipient" : "temporary"; // 系统/域名不存在
    if (detail === 8) return "sender_rejected"; // 发件人地址无效
    if (detail === 0) return null; // x.1.0 语义模糊 → 交由关键词判定
  }
  // x.2.x —— 邮箱状态
  if (subject === 2) {
    if (detail === 2) return "mailbox_full";
    if (detail === 1) return permanent ? "invalid_recipient" : "temporary"; // 邮箱已禁用
    if (detail === 3) return "content_rejected"; // 消息长度超限
    if (detail === 4) return permanent ? "permanent" : "temporary";
  }
  // x.3.x —— 邮件系统状态
  if (subject === 3) {
    if (detail === 1) return "temporary"; // 存储空间不足
    if (detail === 4) return "content_rejected"; // 消息过大
    return permanent ? "permanent" : "temporary";
  }
  // x.4.x —— 网络与路由
  if (subject === 4) {
    if (detail === 1) return "temporary"; // 无应答
    if (detail === 2) return "timeout";
    if (detail === 5) return "rate_limited"; // 系统拥塞
    if (detail === 7) return "temporary";
    return "temporary";
  }
  // x.5.x —— 协议错误
  if (subject === 5) return permanent ? "permanent" : "temporary";
  // x.6.x —— 内容与转换
  if (subject === 6) return "content_rejected";
  // x.7.x —— 安全与策略
  if (subject === 7) {
    if (detail === 1) return permanent ? "blocked" : "rate_limited"; // 投递被策略拒绝
    if (detail >= 20 && detail <= 29) return "sender_rejected"; // SPF/DKIM/DMARC/ARC 域认证失败
    if (detail === 8 || detail === 9 || detail === 14) return "auth";
    if (detail === 13) return "sender_rejected"; // 账号被禁用
    if (detail === 0) return null; // x.7.0 语义模糊 → 交由关键词判定
    return permanent ? "blocked" : "temporary";
  }
  return null;
}

/** 关键词规则表(按顺序匹配,先命中者胜) */
const KEYWORD_RULES: { re: RegExp; category: BounceCategory }[] = [
  // 频率 / 配额
  { re: /rate limit|too many|throttl|slow down|try again later.*limit|quota exceed|exceeded.*(quota|limit)|sending limit|daily limit|message limit|限制|频率|超出配额/i, category: "rate_limited" },
  // 黑名单 / 声誉
  { re: /blacklist|blocklist|blocked using|spamhaus|barracuda|reputation|listed at|denied by policy|access denied|not allowed to send|禁止发送|黑名单/i, category: "blocked" },
  // 收件人不存在
  { re: /user unknown|unknown user|no such user|user not found|does not exist|doesn't exist|recipient (not found|unknown|rejected|address rejected)|invalid recipient|mailbox unavailable|no mailbox|address not found|unrouteable|unroutable|relay access denied|用户不存在|收件人不存在/i, category: "invalid_recipient" },
  // 邮箱满
  { re: /mailbox full|over quota|quota exceeded|insufficient (system )?storage|mailbox is full|邮箱已满|空间不足/i, category: "mailbox_full" },
  // 内容 / 垃圾判定
  { re: /spam|virus|malware|phishing|content reject|message reject.*content|too large|size exceed|message too big|attachment|垃圾邮件|病毒|内容/i, category: "content_rejected" },
  // 发件人
  { re: /sender (rejected|denied|verify|not allowed)|from address|spf|dkim|dmarc|domain.*not (allowed|permitted)|发件人/i, category: "sender_rejected" },
  // 认证
  { re: /auth|credential|password|login|535|not authenticated|需要认证|认证/i, category: "auth" },
  // TLS
  { re: /tls|ssl|certificate|handshake|加密|证书/i, category: "tls" },
  // 连接
  { re: /connection (refused|reset|closed|timed out)|econnrefused|enotfound|dns|network|unreachable|无法连接|连接/i, category: "connection" },
  // 超时
  { re: /timeout|timed out|超时/i, category: "timeout" },
];

/** 按阶段推断(兜底,粒度最粗) */
function fromStage(stage: SmtpStage | undefined, permanent: boolean): BounceCategory {
  switch (stage) {
    case "connect":
    case "greeting":
    case "closed":
      return "connection";
    case "starttls":
      return "tls";
    case "auth":
      return "auth";
    case "mail_from":
      return "sender_rejected";
    case "rcpt_to":
      return permanent ? "invalid_recipient" : "temporary";
    case "data":
      return permanent ? "content_rejected" : "temporary";
    case "timeout":
      return "timeout";
    default:
      return permanent ? "permanent" : "unknown";
  }
}

/**
 * 对一次发送失败进行分类。
 *
 * 判定顺序:增强状态码 → 关键词 → 基础响应码 + 阶段。
 */
export function classifyBounce(input: {
  stage?: SmtpStage;
  code?: number;
  message?: string;
}): BounceClassification {
  const message = input.message ?? "";
  const code = input.code;
  const enhanced = extractEnhanced(message);
  const permanent = code !== undefined ? code >= 500 : enhanced?.startsWith("5") ?? false;

  let category: BounceCategory | null = null;

  // 1) 增强状态码
  if (enhanced) category = fromEnhanced(enhanced);

  // 2) 关键词
  if (!category) {
    for (const rule of KEYWORD_RULES) {
      if (rule.re.test(message)) {
        category = rule.category;
        break;
      }
    }
  }

  // 3) 基础响应码的特殊值
  if (!category && code !== undefined) {
    if (code === 535 || code === 530) category = "auth";
    else if (code === 550 || code === 551 || code === 553) category = "invalid_recipient";
    else if (code === 552) category = "mailbox_full";
    else if (code === 554) category = "blocked";
    else if (code === 421) category = "rate_limited";
    else if (code === 450 || code === 451) category = "temporary";
    else if (code === 452) category = "mailbox_full";
    else if (code >= 500) category = "permanent";
    else if (code >= 400) category = "temporary";
  }

  // 4) 阶段兜底
  if (!category) category = fromStage(input.stage, permanent);

  const policy = POLICY[category];
  return {
    category,
    ...policy,
    code,
    enhanced,
    label: BOUNCE_LABELS[category],
  };
}

/** 全部类别(用于报表补零) */
export const ALL_BOUNCE_CATEGORIES: BounceCategory[] = Object.keys(BOUNCE_LABELS) as BounceCategory[];
