# SMTP Panel — Cloudflare 批量发信管理系统

基于 **Cloudflare Workers 全家桶**(Workers + D1 + KV + Queues + TCP Sockets)的 Web 邮件批量发送管理系统。

**不购买 VPS、不自建邮件服务器** —— 前端、后端、数据库、缓存、队列全部运行在 Cloudflare 免费额度可覆盖的架构上,邮件实际投递由第三方 SMTP(支持 465 SSL / 587 STARTTLS)完成。

> 项目规划文档见 [`cloudflare-smtp-batch-mail-project-plan.md`](./cloudflare-smtp-batch-mail-project-plan.md)

---

## 功能总览

| 模块 | 功能 |
|---|---|
| **管理员认证** | 首次访问初始化管理员、登录/登出、修改密码、Session(KV 存储,7 天有效)、登录限流 |
| **SMTP 账号** | 增删改查、密码 AES-GCM 加密存储、连接测试(逐阶段日志)、每日发送上限、启用/禁用、今日用量统计 |
| **邮件模板** | HTML + 纯文本、主题、变量替换 `{{name}}` `{{email}}` `{{remark}}` `{{date}}`、实时预览 |
| **收件人** | 手动添加、CSV/文本批量导入、**从外部系统拉取(outlookEmail 对外 API)**、搜索、去重、屏蔽/恢复 |
| **发送任务** | 任务创建(快照收件人)、测试模式(仅发一封)、启动/暂停/恢复/取消、进度条、收件人明细、失败重试 |
| **异步发送** | Cloudflare Queues + Consumer,每分钟一个 tick 按速度批量发送,单连接复用,失败自动重试(可配置次数) |
| **日志与统计** | 每封邮件一条日志(状态/耗时/错误)、Dashboard 汇总(今日发送/成功率/SMTP 用量/7 天趋势/最近错误) |
| **自愈巡检** | Cron 每分钟检查卡住的任务并自动恢复(消息丢失/异常退出场景) |

### 收件人外部拉取(对接 outlookEmail)

在「设置」中配置 [outlookEmail](https://github.com/assast/outlookEmail) 项目的对外 API 地址和 Key 后,可直接在「收件人」页一键拉取该系统管理的全部邮箱账号并去重导入:

- 使用 `GET /api/external/accounts`,`X-API-Key` 请求头认证
- 支持按 `group_id` 分组过滤、仅导入 `active` 状态账号
- 自动分页拉取(单次最多 10000 个),自动去重(库内 + 批内),来源标记为 `external_api`
- 提供「测试连接」按钮,验证配置并显示远端账号总数

---

## 架构

```
                     浏览器
                        │ HTTPS
                        ▼
        ┌───────────────────────────────┐
        │ Cloudflare Worker (smtp-panel) │
        │                               │
        │  Workers 静态资产 (React SPA)   │
        │  Hono REST API (/api/*)        │
        │  Queue Consumer (发信执行器)    │
        │  Cron 巡检 (每分钟)            │
        └──────┬─────────┬─────────┬───┘
               │         │         │
               ▼         ▼         ▼
              D1         KV      Queues
           业务数据库   Session/锁  发信队列
                                       │
                                       ▼
                              Consumer tick:
                              读取配置 → 连接 SMTP
                              → 批量发送 → 写日志
                              → 入队下个 tick(60s)
                                       │
                              TCP Socket 465/587
                                       ▼
                              第三方 SMTP 邮局
                                       ▼
                                    收件人
```

**与原规划的差异说明**(均为工程权衡,不影响后续演进):

1. **前端用 Workers 静态资产承载,而非独立 Pages** —— 前后端同源,免 CORS、Session Cookie 简单、一条命令部署。前端构建产物是标准静态文件,如需仍可单独部署到 Cloudflare Pages。
2. **API 与 SMTP Consumer 在同一个 Worker 内,代码按模块分层**(`src/api/` 与 `src/queue/`)—— 本地 `wrangler dev` 单进程即可完整模拟队列流转;后期如需拆分为独立 Consumer Worker(规划 Section 18),把 `src/queue/consumer.ts` 移入新 Worker 并复用 D1/KV/Queue 绑定即可。

### 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + Vite 7 + Tailwind CSS 4 + react-router 6 |
| 后端 | Hono 4(TypeScript) |
| 数据库 | Cloudflare D1 + Drizzle ORM |
| 缓存/会话 | Cloudflare KV |
| 队列 | Cloudflare Queues |
| SMTP | Workers TCP Sockets(`cloudflare:sockets`) |
| 部署 | Wrangler 4 |

### 项目结构

```
├── apps/
│   ├── worker/                 # Cloudflare Worker(API + Consumer + 静态资产)
│   │   ├── src/
│   │   │   ├── api/            # REST API
│   │   │   │   ├── routes/     # auth / smtp / templates / recipients / campaigns / logs / dashboard / settings
│   │   │   │   ├── services/   # 外部 API 拉取服务
│   │   │   │   ├── crypto.ts   # PBKDF2 密码哈希 + AES-GCM 加解密
│   │   │   │   ├── middleware.ts # 会话鉴权 + 登录限流
│   │   │   │   └── queue.ts    # 入队辅助(KV tick 锁)
│   │   │   ├── queue/consumer.ts # 队列消费者:批量发送/重试/限速/自愈
│   │   │   └── index.ts        # 入口:fetch + queue + scheduled
│   │   └── wrangler.toml
│   └── web/                    # React 前端(SPA)
│       └── src/pages/          # Login / Dashboard / Smtp / Templates / Recipients / Campaigns / Logs / Settings
├── packages/
│   ├── db/                     # Drizzle schema + D1 迁移(migrations/0001_init.sql)
│   ├── mail/                   # SMTP 客户端(TCP + 465/587)+ MIME 构建
│   └── shared/                 # 前后端共享类型与工具(校验/CSV/模板变量)
├── scripts/
│   ├── fake-smtp-server.mjs    # 本地假 SMTP 服务器(测试用)
│   └── hash-password.mjs       # PBKDF2 哈希生成(CLI 种子用)
└── package.json                # npm workspaces
```

---

## 部署指南(生产环境)

### 前置条件

- Node.js ≥ 20.19(推荐 22/24)
- 一个 Cloudflare 账号(免费套餐即可运行全部功能)
- 至少一个可用的第三方 SMTP 账号(465 或 587 端口)
- 已安装并登录 Wrangler:`npm install -g wrangler && wrangler login`(或使用项目内 `npx wrangler`)

### 第 1 步:安装依赖

```bash
git clone <本项目> && cd 本项目目录
npm install
```

> 若 `npm install` 在 Windows 上报 `workerd ... spawn cmd.exe ENOENT`,改用:
> ```bash
> npm install --ignore-scripts
> ```
> 不影响功能(wrangler 所需的平台二进制以依赖包形式安装)。
> 若 npm 源超时,可切换镜像:`npm config set registry https://mirrors.cloud.tencent.com/npm/` 或换回官方源。

### 第 2 步:创建 Cloudflare 资源(每个账号只需一次)

```bash
# 1. 创建 D1 数据库 —— 记下输出中的 database_id
npx wrangler d1 create smtp-panel

# 2. 创建 KV 命名空间 —— 记下输出中的 id
npx wrangler kv namespace create KV

# 3. 创建发信队列
npx wrangler queues create smtp-panel-mail
```

### 第 3 步:填写配置

编辑 `apps/worker/wrangler.toml`,替换两个占位符:

```toml
[[d1_databases]]
database_id = "第2步获得的-database-id"

[[kv_namespaces]]
id = "第2步获得的-kv-id"
```

其余(队列名、Cron、消费者并发)保持默认即可。

### 第 4 步:设置加密密钥

```bash
npx wrangler secret put ENCRYPTION_KEY --config apps/worker/wrangler.toml
```

输入一段 **至少 32 位的随机字符串**(可用 `openssl rand -base64 32` 生成)。它用于加密 SMTP 密码与外部 API Key(AES-GCM),**忘记/更换后将无法解密已存的凭据,需重新录入**。

### 第 5 步:初始化数据库

```bash
npm run db:migrate:remote
```

### 第 6 步:构建并部署

```bash
npm run deploy        # = 构建前端 + wrangler deploy
```

部署完成后记下输出的域名(如 `https://smtp-panel.<你的子域>.workers.dev`)。首次打开会进入「初始化管理员」页面,设置用户名和密码(密码至少 8 位)即可登录使用。

### (可选)绑定自定义域名

Cloudflare Dashboard → Workers & Pages → `smtp-panel` → Settings → Domains & Routes → Add Custom Domain。域名自动获得 HTTPS 证书。

---

## 本地开发

> 首次运行前先构建一次前端（`wrangler dev` 启动时需要 `apps/web/dist` 目录存在）：
> ```bash
> npm run build:web
> ```

```bash
# 终端 1:启动 Worker(端口 8787,本地模拟 D1/KV/Queue/Cron)
npm run dev:worker

# 终端 2:启动前端 Vite 热更新(端口 5173,/api 代理到 8787)
npm run dev:web

# 浏览器打开 http://localhost:5173
```

本地首次运行前,先初始化本地数据库(生成 `.wrangler/state` 下的 SQLite):

```bash
npm run db:migrate:local
```

本地密钥放在 `apps/worker/.dev.vars`(已内置一个开发用 Key,生产请勿复用)。

### 本地完整链路测试(无需真实 SMTP)

项目内置一个假 SMTP 服务器,接受任意账号密码,把收到的邮件打印到控制台:

```bash
npm run dev:smtp        # 监听 127.0.0.1:2525
```

然后在面板中:

1. SMTP 账号 → 添加:主机 `127.0.0.1`,端口 `2525`,加密方式选 **无加密(测试)**,用户名/密码任意 → 点「测试」应显示连接成功
2. 创建模板 → 添加几个收件人 → 创建任务时填写「测试邮箱」(只发一封,安全)
3. 启动任务 → 观察 `dev:smtp` 终端打印出的完整 MIME 邮件,面板日志页出现 success 记录

> 本地若要测试真实的 465/587 发送,直接在面板里添加你的真实 SMTP 信息即可(`wrangler dev` 的出站 TCP 走本机网络)。
> 说明:Cloudflare 出站 TCP 封锁 25 端口,请使用 465(SSL)或 587(STARTTLS);「无加密」仅供内网/本地调试。

---

## 使用手册

### 1. SMTP 账号

- **端口与加密方式必须匹配**:465 → `SSL`;587 → `STARTTLS`
- 「测试」按钮会执行 连接 → TLS → EHLO → 认证 全流程,并展示协议往返日志,失败时标明出错阶段(连接失败 / TLS 失败 / 认证失败 / 超时 等)
- **每日上限**:该账号每天最多发送的封数(0 = 不限),Consumer 发送前会检查,额度用尽自动暂停任务并在任务详情显示原因
- 密码加密存储,任何接口不会返回明文;编辑时留空表示保持原密码

### 2. 邮件模板

- 主题与正文均支持变量:`{{name}}` `{{email}}` `{{remark}}` `{{date}}`
- 纯文本部分留空会自动从 HTML 生成
- 邮件以 `multipart/alternative`(文本 + HTML)发送,UTF-8 base64 编码,自动生成 Message-ID / Date 头

### 3. 收件人

三种导入方式:

| 方式 | 说明 |
|---|---|
| 手动添加 | 单个邮箱,自动校验格式、去重 |
| CSV 导入 | 支持表头 `name,email,remark`(或无表头 `邮箱` / `姓名,邮箱`),也支持每行一个邮箱的纯文本;自动去重,返回 新增/重复/无效 统计 |
| **从外部系统拉取** | 见下节 |

**外部系统拉取(outlookEmail 对接)**:

1. 进入「设置 → 外部邮箱系统对接」,填写:
   - **API 地址**:你的 outlookEmail 部署地址,如 `https://mail.example.com`(含协议,不带末尾斜杠)
   - **API Key**:outlookEmail Web 界面 `设置 → 对外 API Key` 中配置的值(加密存储)
2. 点「测试连接」验证(成功会显示远端账号总数)
3. 「收件人 → 从外部系统拉取」:可选分组 ID、数量上限(默认 1000,最大 10000)、仅导入 active 账号
4. 拉取结果:新增 / 重复 / 无效 统计;重复的不会覆盖本地已有记录

> 单次拉取最多分页 40 页 × 250 条(Workers 免费版子请求限制);更大规模分多次拉取即可(增量自动去重)。

### 4. 发送任务

**强烈建议先用「测试邮箱」模式验证**:创建任务时填写一个你自己的邮箱,任务将只发给该地址,确认收到、格式正确后再创建正式任务。

- **创建**:选择 SMTP、模板、速度(1-60 封/分钟)、重试次数(1-10,默认 3)
- **启动**:快照当前全部「有效」收件人(此后新增收件人不影响已启动任务)
- **暂停/恢复**:暂停后正在发送中的当批会发完,之后停止;恢复从断点继续
- **取消**:停止后续发送,已发的不回滚
- 任务详情页:实时进度、按状态筛选的收件人明细(含重试次数/最后错误)、本任务发送日志(发送中每 5 秒自动刷新)

**发送机制说明**:

- 队列每分钟消费一个「tick」,每 tick 最多发送 `速度` 封,单 SMTP 连接复用顺序发送
- 单封失败:自动在下个 tick 重试,超过重试次数标记 `failed`
- 连接/认证/超时级错误:整个任务自动**暂停**并在详情页显示原因(避免拿坏配置硬打服务器),修复 SMTP 后点「恢复」继续
- Cron 每分钟巡检,自动恢复因消息丢失卡住的任务(>4 分钟无进度且无锁,或 >15 分钟僵死强制恢复)

### 5. Dashboard 与日志

- 今日发送/成功/失败/成功率、SMTP 账号与今日用量、进行中任务数
- 近 7 天发送趋势(成功/失败堆叠)
- 最近 5 条失败记录
- 日志页支持按状态/关键字过滤,显示任务名、SMTP 名、耗时、错误信息

---

## API 概览(全部需登录,除标注外)

```
POST   /api/auth/setup             初始化管理员(仅首次,公开)
POST   /api/auth/login             登录(公开,限流 10次/10分钟)
POST   /api/auth/logout            登出
GET    /api/auth/me                当前用户
PUT    /api/auth/password          修改密码

GET/POST        /api/smtp          列表 / 添加
GET/PUT/DELETE  /api/smtp/:id      详情 / 更新 / 删除
POST            /api/smtp/:id/test 连接测试

GET/POST        /api/templates     (同上 CRUD)
GET/PUT/DELETE  /api/templates/:id

GET/POST        /api/recipients    列表(分页/搜索/筛选) / 添加
PUT/DELETE      /api/recipients/:id
POST            /api/recipients/import            CSV/文本导入
POST            /api/recipients/import-external   外部系统拉取导入
GET             /api/recipients/stats             统计

GET/POST        /api/campaigns     列表 / 创建
GET/DELETE      /api/campaigns/:id
GET             /api/campaigns/:id/recipients     收件人明细
GET             /api/campaigns/:id/logs           任务日志
POST            /api/campaigns/:id/start|pause|resume|cancel

GET             /api/logs          发送日志(分页/过滤)
GET             /api/dashboard     汇总统计

GET/PUT         /api/settings      设置读写
POST            /api/settings/test-external       外部 API 连接测试
```

---

## 安全设计

- **密码**:PBKDF2-SHA256,100,000 轮迭代 + 随机盐,常量时间比较
- **敏感凭据**(SMTP 密码、外部 API Key):AES-256-GCM 加密落库,密钥仅存于 Worker Secret,任何 API 不回显明文
- **会话**:随机 token 存 KV(7 天 TTL),HttpOnly + SameSite=Lax Cookie;每次请求校验用户仍存在且启用
- **登录限流**:同 IP 10 次 / 10 分钟(KV 计数)
- **SQL 注入**:全部走 Drizzle 参数化 / D1 预编译语句
- **响应头**:API 统一附加 `X-Content-Type-Options` / `X-Frame-Options`
- **发送侧保护**:速度限制、单账号每日上限、重试上限、连接级故障自动暂停

> 合规提醒:批量邮件应仅发送给你有权触达的收件人,并遵守所用 SMTP 服务商的服务条款、发送额度及适用的反垃圾邮件与隐私法规(如 CAN-SPAM / GDPR)。

---

## 常见问题(FAQ)

**Q: SMTP 测试显示「连接失败」?**
检查主机/端口是否可达、加密方式与端口是否匹配(465=SSL,587=STARTTLS)。国内部分邮局需在服务商处开启 SMTP/授权码(密码填授权码而非登录密码)。

**Q: 任务被自动暂停,提示 SMTP 连接异常?**
任务详情页会显示具体错误(认证失败/超时等)。修正 SMTP 账号(或等服务商恢复)后,任务列表点「恢复」即可从断点续发。

**Q: 外部拉取报「拉取失败: ...」?**
确认 API 地址含协议且能被公网访问、API Key 正确、outlookEmail 侧已启用对外 API。Workers 出站访问需目标服务允许 Cloudflare IP 段。

**Q: 为什么速度最大 60 封/分钟?**
系统按「每分钟一个 tick」的节奏发送以精确控速。需要更快速度时可添加多个 SMTP 账号并创建多个任务并行(每个任务独立限速)。

**Q: 免费套餐够用吗?**
D1(5GB 存储 / 500 万行读每天)、KV、Queues、Workers(10 万请求/天)对中小规模发信完全够用;单次外部拉取上限 1 万邮箱由免费版 50 子请求/次推导而来。

**Q: wrangler 命令卡住?**
多为网络问题(版本检查/登录态)。重试即可;涉及远程资源的命令可加 `--remote`。本地迁移数据库用 `npm run db:migrate:local`。

---

## 后续路线(规划 Phase 7)

- [ ] 定时发送(指定时间启动任务)
- [ ] SMTP Pool 自动轮换(多账号额度联动)
- [ ] 附件 / 图片内嵌
- [ ] 多用户与角色权限
- [ ] 发送完成后 Webhook 通知
- [ ] 独立 Consumer Worker 拆分(横向扩展)
- [ ] 更丰富的退信分类与统计报表

---

## 许可与免责

本项目仅供学习与合法用途。使用者需自行确保邮件发送行为符合相关法律法规与邮件服务商条款,作者不承担滥用产生的任何责任。
