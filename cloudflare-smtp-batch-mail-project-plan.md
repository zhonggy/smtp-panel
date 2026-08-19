# Cloudflare SMTP 批量发信项目规划

## 1. 项目目标

构建一个基于 Cloudflare 的 Web 邮件发送管理系统：

- 使用 Cloudflare Pages 提供 Web 管理面板
- 使用 Cloudflare Workers 提供后端 API
- 使用 Cloudflare D1 保存业务数据
- 使用 Cloudflare KV 保存 Session、缓存等数据
- 使用 Cloudflare Queues 构建异步发信队列
- 使用 Workers TCP Socket 连接第三方 SMTP
- 不自建邮件服务器
- 不依赖 VPS
- 使用第三方提供的 SMTP 邮箱/邮局进行发信

> 第一阶段目标是做一个稳定的 SMTP 管理、测试、队列和发送系统。

---

## 2. 总体架构

```text
                    用户浏览器
                        │
                        ▼
              ┌─────────────────┐
              │ Cloudflare Pages│
              │    Web 管理面板  │
              └────────┬────────┘
                       │ HTTPS API
                       ▼
              ┌─────────────────┐
              │ Cloudflare      │
              │ Workers         │
              │ 后端 API        │
              └───────┬─────────┘
                      │
          ┌───────────┼────────────┐
          ▼           ▼            ▼
        D1          KV          Queues
      数据库       配置/缓存      发信队列
          │           │            │
          │           │            ▼
          │           │      SMTP Consumer
          │           │            │
          │           │            │ TCP Socket
          │           │            ▼
          │           │       第三方 SMTP
          │           │            │
          └───────────┴────────────┴──→ 收件人
```

### 核心原则

- Pages：只负责前端
- Workers：负责 API、业务逻辑和 SMTP 连接
- D1：主要业务数据库
- KV：缓存、Session 等高频读取数据
- Queues：异步发送任务
- SMTP Consumer：实际执行邮件发送
- 第三方 SMTP：实际负责邮件投递

---

## 3. 为什么不需要 VPS

本项目不是自建邮件服务器。

VPS 主要在传统架构中承担：

- 运行 Web 后端
- 运行数据库
- 运行任务队列
- 建立 SMTP TCP 连接

这些功能可以分别由 Cloudflare Pages、Workers、D1、KV、Queues 和 Workers TCP Socket 承担。

因此第一版可以：

```text
Cloudflare Pages
        +
Cloudflare Workers
        +
Cloudflare D1
        +
Cloudflare KV
        +
Cloudflare Queues
        +
第三方 SMTP
```

不需要购买 VPS。

---

## 4. SMTP 连接方案

第一版重点支持：

### SMTP 465

```text
SMTP Host
Port: 465
Security: SSL/TLS
```

### SMTP 587

```text
SMTP Host
Port: 587
Security: STARTTLS
```

暂不考虑 25 端口。

### 连接流程

```text
Worker
  │
  ▼
建立 TCP Socket
  │
  ▼
TLS / STARTTLS
  │
  ▼
EHLO
  │
  ▼
AUTH
  │
  ▼
MAIL FROM
  │
  ▼
RCPT TO
  │
  ▼
DATA
  │
  ▼
邮件发送完成
```

> Workers 环境对 SMTP 出站连接存在端口限制，因此第一版应优先设计 465/587，不依赖 25 端口。

---

# 5. 功能规划

## 5.1 管理员登录

第一版：

- 管理员登录
- Session
- 登出
- Session 过期
- API 鉴权

后续：

- 多用户
- 用户角色
- 权限管理

---

## 5.2 SMTP 账号管理

可以添加多个 SMTP：

```text
SMTP名称
SMTP Host
SMTP Port
SMTP Username
SMTP Password
加密方式
发件人名称
发件人地址
每日发送上限
启用/禁用
```

示例：

```text
SMTP-01
smtp.example.com
465
user@example.com
SSL
每日限制：500
状态：正常
```

管理功能：

- 添加 SMTP
- 编辑 SMTP
- 删除 SMTP
- 启用/禁用
- 测试 SMTP
- 查看今日发送数量
- 查看失败数量
- 查看最近错误

---

# 6. SMTP 测试

添加 SMTP 后提供：

```text
[测试连接]
```

测试流程：

```text
连接 SMTP
    ↓
TLS
    ↓
EHLO
    ↓
AUTH
    ↓
验证成功
```

返回：

```text
连接成功
认证成功
SMTP 服务正常
```

失败时显示：

```text
连接失败
认证失败
TLS 失败
服务器拒绝
超时
```

这样可以在真正发信之前确认 SMTP 是否可用。

---

# 7. 邮件模板

支持创建邮件模板：

```text
模板名称
邮件主题
HTML 内容
纯文本内容
```

后续可以支持变量：

```text
{{name}}
{{email}}
{{company}}
{{date}}
```

例如：

```html
<h2>Hello {{name}}</h2>

<p>这是邮件内容。</p>
```

---

# 8. 收件人管理

第一版支持：

- 手动添加
- CSV 导入
- 删除
- 搜索
- 去重
- 邮箱格式校验

数据：

```text
姓名
邮箱
备注
状态
创建时间
```

---

# 9. 批量发送任务

用户创建一个发送任务：

```text
任务名称：
活动通知

SMTP：
SMTP-01

邮件模板：
活动模板

收件人：
1000 个

发送速度：
5 封/分钟

失败重试：
3 次
```

任务状态：

```text
等待中
发送中
已暂停
已完成
失败
```

---

# 10. Queue 异步发送

不要让 API Worker 一次发送大量邮件。

错误方案：

```text
用户点击发送
      ↓
Worker
      ↓
连续发送 1000 封
```

推荐方案：

```text
用户创建任务
      ↓
API Worker
      ↓
拆分发送任务
      ↓
Cloudflare Queue
      ↓
SMTP Consumer
      ↓
发送邮件
```

优势：

- 不阻塞 HTTP 请求
- 可以重试
- 可以控制并发
- 可以控制发送速度
- 可以记录每封邮件状态
- 单封失败不会导致整个任务失败

---

# 11. SMTP Pool

如果拥有多个合法授权的 SMTP 账号，可以建立 SMTP Pool：

```text
SMTP-01
SMTP-02
SMTP-03
SMTP-04
```

系统根据配置选择可用 SMTP。

每个 SMTP 保存：

```text
今日发送数量
成功数量
失败数量
每日上限
当前状态
最近错误
最后使用时间
```

示例：

```text
任务
 ↓
选择可用 SMTP
 ↓
SMTP-01
 ↓
达到设定额度
 ↓
SMTP-02
 ↓
继续发送
```

> SMTP 轮换应遵守各邮局的服务条款、发送额度和反垃圾邮件规则，不用于绕过封禁或发送未经许可的垃圾邮件。

---

# 12. 数据库设计

使用 Cloudflare D1。

建议第一版数据库表：

```text
users
smtp_accounts
mail_templates
recipients
campaigns
campaign_recipients
send_logs
smtp_daily_stats
```

---

## 12.1 users

```text
id
username
password_hash
role
enabled
created_at
updated_at
```

---

## 12.2 smtp_accounts

```text
id
name
host
port
username
password_encrypted
security
from_name
from_email
daily_limit
enabled
created_at
updated_at
```

SMTP 密码不能以明文形式返回给前端。

---

## 12.3 mail_templates

```text
id
name
subject
html_body
text_body
created_at
updated_at
```

---

## 12.4 recipients

```text
id
name
email
remark
status
created_at
updated_at
```

---

## 12.5 campaigns

```text
id
name
smtp_id
template_id
status
total
pending
success
failed
speed_limit
retry_limit
created_at
started_at
finished_at
```

---

## 12.6 campaign_recipients

```text
id
campaign_id
recipient_id
status
retry_count
last_error
sent_at
```

---

## 12.7 send_logs

```text
id
campaign_id
smtp_id
recipient
subject
status
error
message_id
created_at
```

---

## 12.8 smtp_daily_stats

```text
id
smtp_id
date
total
success
failed
```

---

# 13. SMTP 密码安全

SMTP 密码属于敏感凭据。

推荐：

```text
用户输入密码
      ↓
Workers
      ↓
加密
      ↓
D1
```

读取：

```text
D1
 ↓
Workers
 ↓
解密
 ↓
仅在 Worker 内存中使用
 ↓
连接 SMTP
```

前端：

```text
禁止返回 SMTP 明文密码
```

编辑 SMTP 时只显示：

```text
********
```

---

# 14. KV 使用规划

KV 不作为主要数据库。

适合：

```text
管理员 Session
登录状态
缓存
临时配置
SMTP 状态缓存
限流数据
```

结构化业务数据全部优先放 D1。

---

# 15. 前端页面规划

第一版建议：

```text
/login
/dashboard
/smtp
/smtp/add
/smtp/:id
/templates
/templates/add
/recipients
/campaigns
/campaigns/create
/campaigns/:id
/logs
/settings
```

---

# 16. Dashboard

首页显示：

```text
今日发送
成功数量
失败数量
成功率

SMTP账号数量
正常 SMTP
异常 SMTP

进行中任务
等待任务

今日发送趋势
SMTP 使用情况
最近错误
```

示例：

```text
今日发送：1,284
成功：1,251
失败：33
成功率：97.43%

SMTP：
8 个

正常：
7 个

异常：
1 个

进行中任务：
3 个
```

---

# 17. API 设计

推荐 REST API。

### Authentication

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

### SMTP

```text
GET    /api/smtp
POST   /api/smtp
GET    /api/smtp/:id
PUT    /api/smtp/:id
DELETE /api/smtp/:id
POST   /api/smtp/:id/test
```

### Templates

```text
GET    /api/templates
POST   /api/templates
GET    /api/templates/:id
PUT    /api/templates/:id
DELETE /api/templates/:id
```

### Recipients

```text
GET    /api/recipients
POST   /api/recipients
POST   /api/recipients/import
DELETE /api/recipients/:id
```

### Campaigns

```text
GET  /api/campaigns
POST /api/campaigns
GET  /api/campaigns/:id
POST /api/campaigns/:id/start
POST /api/campaigns/:id/pause
POST /api/campaigns/:id/resume
POST /api/campaigns/:id/cancel
```

### Logs

```text
GET /api/logs
GET /api/logs/:id
```

---

# 18. Worker 架构

不要把所有功能写进一个 Worker。

建议：

```text
API Worker
     │
     ├── Auth
     ├── SMTP 管理
     ├── 模板管理
     ├── 收件人管理
     └── Campaign 管理
              │
              ▼
         Cloudflare Queue
              │
              ▼
       SMTP Consumer Worker
              │
              ▼
        SMTP TCP Socket
```

这样后期扩展更加容易。

---

# 19. 发信流程

完整流程：

```text
用户登录
   ↓
添加 SMTP
   ↓
测试 SMTP
   ↓
添加邮件模板
   ↓
导入收件人
   ↓
创建 Campaign
   ↓
设置 SMTP
   ↓
设置发送速度
   ↓
创建任务
   ↓
任务进入 Queue
   ↓
Consumer 获取任务
   ↓
读取 SMTP 配置
   ↓
连接 SMTP
   ↓
认证
   ↓
发送
   ↓
记录结果
   ↓
成功 → success
失败 → retry
   ↓
超过重试次数 → failed
```

---

# 20. 发送速度控制

必须加入发送速度限制。

例如：

```text
1 封/分钟
5 封/分钟
10 封/分钟
30 封/分钟
```

也可以设置：

```text
SMTP-01
每日最多 500 封

SMTP-02
每日最多 1000 封
```

实际限制应该遵守对应 SMTP 服务商的额度和政策。

---

# 21. 重试机制

例如：

```text
第一次发送失败
      ↓
等待
      ↓
第二次
      ↓
失败
      ↓
等待
      ↓
第三次
      ↓
失败
      ↓
标记 FAILED
```

记录：

```text
retry_count
last_error
last_attempt_at
```

---

# 22. 错误分类

建议把 SMTP 错误分成：

```text
连接错误
TLS 错误
认证错误
收件人错误
发送额度限制
服务器临时错误
服务器永久拒绝
超时
未知错误
```

这样后台更容易排查。

---

# 23. 邮件内容

建议支持：

```text
HTML
纯文本
主题
From Name
From Email
Reply-To
自定义 Headers
```

第一版不建议加入过于复杂的邮件编辑器。

可以先使用：

```text
HTML Textarea
```

后续再加入：

```text
富文本编辑器
模板变量
附件
图片
```

---

# 24. 安全设计

必须考虑：

### Web 安全

- HTTPS
- Session
- CSRF 防护
- XSS 防护
- SQL 参数化
- API 权限检查
- 登录限流
- 密码哈希

### SMTP 安全

- SMTP 密码加密存储
- 前端禁止获取密码
- SMTP 配置权限控制
- 发送速度限制
- 单账号每日额度
- 失败重试限制

### 管理后台

不要允许：

```text
未登录访问 SMTP
未授权读取 SMTP 密码
未授权创建发送任务
未授权查看发送日志
```

---

# 25. 技术栈

推荐：

| 模块 | 技术 |
|---|---|
| 前端 | React + Vite |
| UI | Tailwind CSS |
| 部署 | Cloudflare Pages |
| 后端 | Cloudflare Workers |
| 数据库 | Cloudflare D1 |
| 缓存 | Cloudflare KV |
| 队列 | Cloudflare Queues |
| SMTP | Workers TCP Sockets |
| ORM | Drizzle |
| API | REST |
| 配置 | Wrangler |
| 语言 | TypeScript |

---

# 26. 项目目录规划

建议：

```text
smtp-panel/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   └── package.json
│   │
│   └── worker/
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   ├── smtp/
│       │   ├── queue/
│       │   ├── auth/
│       │   └── index.ts
│       │
│       └── wrangler.toml
│
├── packages/
│   ├── db/
│   ├── types/
│   └── shared/
│
├── migrations/
│
├── scripts/
│
├── package.json
└── README.md
```

---

# 27. 开发阶段

## Phase 1：基础环境

- 创建 Cloudflare 项目
- Pages
- Workers
- D1
- KV
- Queues
- Wrangler
- 本地开发环境

## Phase 2：用户系统

- 管理员登录
- Session
- 权限
- Dashboard

## Phase 3：SMTP

- SMTP CRUD
- SMTP 加密保存
- SMTP 测试
- 465
- 587 STARTTLS

## Phase 4：邮件

- 邮件模板
- 收件人
- CSV 导入
- HTML 邮件

## Phase 5：Queue

- Campaign
- Queue
- Consumer
- 发送
- 重试
- 限速

## Phase 6：统计

- 成功
- 失败
- SMTP统计
- 发送日志
- Dashboard

## Phase 7：优化

- 定时发送
- 变量替换
- 附件
- 多用户
- 权限管理
- Webhook
- 更完善的错误处理

---

# 28. MVP 第一版范围

第一版不要做太复杂。

只做：

```text
✓ 管理员登录
✓ SMTP 添加
✓ SMTP 删除
✓ SMTP 编辑
✓ SMTP 测试
✓ 邮件模板
✓ 收件人管理
✓ CSV 导入
✓ 创建发送任务
✓ Queue
✓ SMTP Consumer
✓ 批量发送
✓ 发送速度限制
✓ 失败重试
✓ 发送日志
✓ Dashboard
```

暂时不做：

```text
✗ 多租户
✗ 复杂权限
✗ 邮件营销自动化
✗ 复杂富文本编辑器
✗ 高级统计
✗ 复杂附件系统
```

---

# 29. 最终架构

```text
                        Internet
                           │
                           ▼
                  ┌─────────────────┐
                  │ Cloudflare Pages│
                  │   React 前端    │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ Workers API     │
                  │                 │
                  │ Auth            │
                  │ SMTP管理        │
                  │ 模板管理        │
                  │ 收件人管理      │
                  │ Campaign        │
                  └───┬─────┬─────┬─┘
                      │     │     │
                      ▼     ▼     ▼
                     D1    KV   Queue
                                  │
                                  ▼
                         ┌────────────────┐
                         │ SMTP Consumer  │
                         │ Worker         │
                         └───────┬────────┘
                                 │
                         TCP Socket
                         465 / 587
                                 │
                                 ▼
                       ┌─────────────────┐
                       │ 第三方 SMTP 邮局 │
                       └────────┬────────┘
                                │
                                ▼
                             收件人
```

---

# 30. 最终结论

这个项目第一版可以做到：

**不购买 VPS、不自建邮件服务器。**

核心基础设施：

```text
Cloudflare Pages
       +
Cloudflare Workers
       +
Cloudflare D1
       +
Cloudflare KV
       +
Cloudflare Queues
       +
第三方 SMTP
```

其中：

- Pages = 前端
- Workers = 后端
- D1 = 数据库
- KV = Session/缓存
- Queues = 发信队列
- SMTP Consumer = 发信执行器
- 第三方 SMTP = 实际邮件投递

后续开发时建议按照：

**SMTP 单封测试 → Queue → 批量发送 → 日志 → Dashboard**

这个顺序逐步实现，而不是一开始把全部功能一次性写完。

---

## 合规说明

批量邮件发送应仅用于你有权发送的邮件和收件人，并遵守所使用 SMTP 邮局的服务条款、发送额度以及适用的反垃圾邮件和隐私法规。
