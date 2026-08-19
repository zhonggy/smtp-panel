import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * 用户(第一版单管理员,预留 role 字段)
 */
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    password_hash: text("password_hash").notNull(),
    role: text("role").notNull().default("admin"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("idx_users_username").on(t.username)],
);

/**
 * SMTP 账号(密码加密存储)
 */
export const smtp_accounts = sqliteTable("smtp_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(465),
  username: text("username").notNull(),
  password_encrypted: text("password_encrypted").notNull(),
  /** ssl(465) | starttls(587) | none(仅测试) */
  security: text("security").notNull().default("ssl"),
  from_name: text("from_name").notNull().default(""),
  from_email: text("from_email").notNull(),
  reply_to: text("reply_to"),
  /** 每日发送上限,0 = 不限制 */
  daily_limit: integer("daily_limit").notNull().default(0),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

/**
 * 邮件模板
 */
export const mail_templates = sqliteTable("mail_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  html_body: text("html_body").notNull().default(""),
  text_body: text("text_body"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

/**
 * 收件人
 */
export const recipients = sqliteTable(
  "recipients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name"),
    email: text("email").notNull(),
    remark: text("remark"),
    /** active | blocked */
    status: text("status").notNull().default("active"),
    /** manual | csv | external_api */
    source: text("source").notNull().default("manual"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("idx_recipients_email").on(t.email)],
);

/**
 * 发送任务
 */
export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  smtp_id: integer("smtp_id").notNull(),
  template_id: integer("template_id").notNull(),
  /** draft | queued | sending | paused | completed | cancelled */
  status: text("status").notNull().default("draft"),
  total: integer("total").notNull().default(0),
  pending: integer("pending").notNull().default(0),
  success: integer("success").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  /** 每分钟发送数(同时也是每个 tick 的批大小) */
  speed_limit: integer("speed_limit").notNull().default(5),
  /** 单个收件人最大尝试次数 */
  retry_limit: integer("retry_limit").notNull().default(3),
  /** 若设置,任务只发送到该邮箱(用于测试) */
  test_email: text("test_email"),
  last_error: text("last_error"),
  created_at: text("created_at").notNull(),
  started_at: text("started_at"),
  updated_at: text("updated_at").notNull(),
  finished_at: text("finished_at"),
});

/**
 * 任务-收件人关联(启动任务时快照)
 */
export const campaign_recipients = sqliteTable(
  "campaign_recipients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaign_id: integer("campaign_id").notNull(),
    recipient_id: integer("recipient_id"),
    email: text("email").notNull(),
    name: text("name"),
    /** pending | sent | failed */
    status: text("status").notNull().default("pending"),
    retry_count: integer("retry_count").notNull().default(0),
    last_error: text("last_error"),
    sent_at: text("sent_at"),
  },
  (t) => [
    index("idx_cr_campaign_status").on(t.campaign_id, t.status),
    index("idx_cr_campaign_id").on(t.campaign_id, t.id),
  ],
);

/**
 * 发送日志(每封邮件一条)
 */
export const send_logs = sqliteTable(
  "send_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaign_id: integer("campaign_id"),
    campaign_name: text("campaign_name"),
    smtp_id: integer("smtp_id"),
    smtp_name: text("smtp_name"),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull().default(""),
    /** success | failed */
    status: text("status").notNull(),
    error: text("error"),
    message_id: text("message_id"),
    duration_ms: integer("duration_ms"),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    index("idx_logs_created").on(t.created_at),
    index("idx_logs_campaign").on(t.campaign_id),
    index("idx_logs_status").on(t.status),
  ],
);

/**
 * SMTP 每日发送统计
 */
export const smtp_daily_stats = sqliteTable(
  "smtp_daily_stats",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    smtp_id: integer("smtp_id").notNull(),
    date: text("date").notNull(),
    total: integer("total").notNull().default(0),
    success: integer("success").notNull().default(0),
    failed: integer("failed").notNull().default(0),
  },
  (t) => [uniqueIndex("idx_sds_smtp_date").on(t.smtp_id, t.date)],
);

/**
 * 系统设置(键值对,敏感值加密存储)
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updated_at: text("updated_at").notNull(),
});
