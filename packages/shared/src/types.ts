// ===== API DTO 类型定义(前后端共享) =====

/** SMTP 加密方式 */
export type SmtpSecurity = "ssl" | "starttls" | "none";

/** 收件人状态 */
export type RecipientStatus = "active" | "blocked";

/** 收件人来源 */
export type RecipientSource = "manual" | "csv" | "external_api";

/** 任务状态 */
export type CampaignStatus =
  | "draft"
  | "queued"
  | "sending"
  | "paused"
  | "completed"
  | "cancelled";

/** 任务内收件人发送状态 */
export type CampaignRecipientStatus = "pending" | "sent" | "failed";

/** 发送日志状态 */
export type SendLogStatus = "success" | "failed";

/** SMTP 账号(不含密码,安全返回给前端) */
export interface SmtpAccountDTO {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  security: SmtpSecurity;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  daily_limit: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  today_total: number;
  today_success: number;
  today_failed: number;
}

/** 邮件模板 */
export interface TemplateDTO {
  id: number;
  name: string;
  subject: string;
  html_body: string;
  text_body: string | null;
  created_at: string;
  updated_at: string;
}

/** 收件人 */
export interface RecipientDTO {
  id: number;
  name: string | null;
  email: string;
  remark: string | null;
  status: RecipientStatus;
  source: RecipientSource;
  created_at: string;
}

/** 发送任务 */
export interface CampaignDTO {
  id: number;
  name: string;
  smtp_id: number;
  template_id: number;
  smtp_name: string | null;
  template_name: string | null;
  status: CampaignStatus;
  total: number;
  pending: number;
  success: number;
  failed: number;
  speed_limit: number;
  retry_limit: number;
  test_email: string | null;
  last_error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** 任务内收件人明细 */
export interface CampaignRecipientDTO {
  id: number;
  email: string;
  name: string | null;
  status: CampaignRecipientStatus;
  retry_count: number;
  last_error: string | null;
  sent_at: string | null;
}

/** 发送日志 */
export interface SendLogDTO {
  id: number;
  campaign_id: number | null;
  campaign_name: string | null;
  smtp_id: number | null;
  smtp_name: string | null;
  recipient: string;
  subject: string;
  status: SendLogStatus;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

/** 设置(对外 API 对接配置) */
export interface SettingsDTO {
  external_api_base_url: string | null;
  external_api_default_group: string | null;
  has_external_api_key: boolean;
  encryption_key_source: "secret" | "auto";
}

/** 分页列表响应 */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** SMTP 测试结果 */
export interface SmtpTestResultDTO {
  ok: boolean;
  error: string | null;
  stage: string | null;
  transcript: string[];
  extensions: string[];
  auth_mechanisms: string[];
}

/** Dashboard 汇总 */
export interface DashboardDTO {
  today: { total: number; success: number; failed: number };
  smtp: { total: number; enabled: number };
  campaigns: { sending: number; queued: number; paused: number; draft: number };
  trend: { date: string; total: number; success: number; failed: number }[];
  recent_errors: {
    id: number;
    recipient: string;
    subject: string;
    error: string | null;
    created_at: string;
  }[];
  smtp_usage: {
    id: number;
    name: string;
    today_total: number;
    today_success: number;
    today_failed: number;
    daily_limit: number;
    enabled: boolean;
  }[];
}

/** 外部系统拉取导入结果 */
export interface ExternalImportResultDTO {
  fetched: number;
  remote_total: number | null;
  added: number;
  duplicate: number;
  invalid: number;
  pages: number;
  truncated: boolean;
}

/** CSV 导入结果 */
export interface CsvImportResultDTO {
  total: number;
  added: number;
  duplicate: number;
  invalid: number;
}

/** 收件人统计 */
export interface RecipientStatsDTO {
  total: number;
  active: number;
  blocked: number;
}

/** 可选的发送速度(封/分钟) */
export const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60] as const;
