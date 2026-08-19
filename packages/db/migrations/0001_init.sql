-- 初始化:所有业务表(幂等,可重复执行)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username);

CREATE TABLE IF NOT EXISTS smtp_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 465,
  username TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  security TEXT NOT NULL DEFAULT 'ssl',
  from_name TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL,
  reply_to TEXT,
  daily_limit INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL DEFAULT '',
  text_body TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT NOT NULL,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipients_email ON recipients (email);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  smtp_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  speed_limit INTEGER NOT NULL DEFAULT 5,
  retry_limit INTEGER NOT NULL DEFAULT 3,
  test_email TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  recipient_id INTEGER,
  email TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cr_campaign_status ON campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_cr_campaign_id ON campaign_recipients (campaign_id, id);

CREATE TABLE IF NOT EXISTS send_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER,
  campaign_name TEXT,
  smtp_id INTEGER,
  smtp_name TEXT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  error TEXT,
  message_id TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON send_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_logs_campaign ON send_logs (campaign_id);
CREATE INDEX IF NOT EXISTS idx_logs_status ON send_logs (status);

CREATE TABLE IF NOT EXISTS smtp_daily_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  smtp_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sds_smtp_date ON smtp_daily_stats (smtp_id, date);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
