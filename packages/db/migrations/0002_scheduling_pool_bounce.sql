-- 0002: 定时发送 + SMTP Pool 轮换 + 退信分类与报表
-- 全部语句幂等,可重复执行

-- ===== 定时发送 =====
-- campaigns.scheduled_at: ISO 时间,到点由 Cron 自动启动
ALTER TABLE campaigns ADD COLUMN scheduled_at TEXT;
-- campaigns.smtp_pool: 1 = 使用 SMTP 池轮换(忽略 smtp_id)
ALTER TABLE campaigns ADD COLUMN use_pool INTEGER NOT NULL DEFAULT 0;
-- 池模式下可限定候选 SMTP(逗号分隔 id;空 = 全部启用账号)
ALTER TABLE campaigns ADD COLUMN pool_smtp_ids TEXT;
-- 记录任务实际使用过的 SMTP 数量(报表用)
ALTER TABLE campaigns ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled
  ON campaigns (status, scheduled_at);

-- ===== SMTP Pool 轮换 =====
-- 冷却截止时间:遇到限额/连接错误时临时跳过该账号
ALTER TABLE smtp_accounts ADD COLUMN cooldown_until TEXT;
-- 最近一次错误与错误类别(池调度与前端展示)
ALTER TABLE smtp_accounts ADD COLUMN last_error TEXT;
ALTER TABLE smtp_accounts ADD COLUMN last_error_at TEXT;
-- 连续失败计数,达到阈值自动进入冷却
ALTER TABLE smtp_accounts ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
-- 最后一次成功发送时间(轮换时优先选最久未用的)
ALTER TABLE smtp_accounts ADD COLUMN last_used_at TEXT;
-- 池内权重(>=1,权重越高被选中概率越大)
ALTER TABLE smtp_accounts ADD COLUMN weight INTEGER NOT NULL DEFAULT 1;
-- 是否参与池轮换
ALTER TABLE smtp_accounts ADD COLUMN in_pool INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_smtp_pool
  ON smtp_accounts (enabled, in_pool, cooldown_until);

-- ===== 退信分类 =====
-- send_logs 增加分类字段
ALTER TABLE send_logs ADD COLUMN bounce_category TEXT;
ALTER TABLE send_logs ADD COLUMN smtp_code INTEGER;
ALTER TABLE send_logs ADD COLUMN enhanced_code TEXT;

CREATE INDEX IF NOT EXISTS idx_logs_bounce
  ON send_logs (bounce_category, created_at);

-- campaign_recipients 记录最后一次退信类别
ALTER TABLE campaign_recipients ADD COLUMN bounce_category TEXT;
-- suppressed: 命中硬退信,不再重试也不计入 failed 重发
ALTER TABLE campaign_recipients ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0;

-- 每次尝试实际使用的 SMTP(池模式下每封可能不同)
ALTER TABLE campaign_recipients ADD COLUMN last_smtp_id INTEGER;

-- ===== 抑制名单(硬退信地址,后续任务自动跳过) =====
CREATE TABLE IF NOT EXISTS suppressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  -- invalid_recipient | blocked | manual | complaint
  reason TEXT NOT NULL DEFAULT 'invalid_recipient',
  bounce_category TEXT,
  smtp_code INTEGER,
  detail TEXT,
  campaign_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppressions_email ON suppressions (email);
CREATE INDEX IF NOT EXISTS idx_suppressions_created ON suppressions (created_at);

-- ===== 每日退信分类统计(报表加速) =====
CREATE TABLE IF NOT EXISTS bounce_daily_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  smtp_id INTEGER,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bds_date_cat_smtp
  ON bounce_daily_stats (date, category, smtp_id);
CREATE INDEX IF NOT EXISTS idx_bds_date ON bounce_daily_stats (date);
