/**
 * 生成部署用的 Wrangler 配置。
 *
 * 设计目标:一键部署零配置,手动部署也尽量零配置。
 *
 * 工作方式:
 *   仓库中的 wrangler.toml 对资源 ID 使用「占位值」(全零 UUID / 全零 hex,
 *   或 ${VAR} 形式)。本脚本把占位值替换为真实 ID,输出 wrangler.generated.toml。
 *
 *   - 一键部署:Cloudflare 会在克隆仓库时把占位值直接改写为它创建的真实 ID,
 *     此时配置中已无占位值,脚本原样透传 → 用户无需任何配置。
 *   - 手动部署:按 环境变量 → .env.deploy → wrangler 精确发现 依次解析。
 *
 * 用法: node scripts/gen-config.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "wrangler.toml");
const OUTPUT = resolve(ROOT, "wrangler.generated.toml");
const ENV_FILE = resolve(ROOT, ".env.deploy");

/** 占位值:格式合法(便于 Deploy Button 解析与改写),但语义为「未设置」 */
const SENTINELS = {
  D1_DATABASE_ID: "00000000-0000-0000-0000-000000000000",
  KV_NAMESPACE_ID: "00000000000000000000000000000000",
};

const template = readFileSync(SOURCE, "utf8");
const workerName = /^\s*name\s*=\s*"([^"]+)"/m.exec(template)?.[1] ?? "smtp-panel";
const configuredDbName = /database_name\s*=\s*"([^"]+)"/.exec(template)?.[1] ?? workerName;
/** 本项目约定的 KV 命名空间标题(创建与匹配都用它,避免歧义) */
const expectedKvTitle = `${workerName}-KV`;

// ===== 判断哪些项仍是占位值 =====

/** 找出模板中出现的未解析项(${VAR} 形式 或 哨兵值形式) */
function findUnresolved(text) {
  const found = new Set();
  for (const [name] of Object.entries(SENTINELS)) {
    if (text.includes(`\${${name}}`)) found.add(name);
  }
  if (text.includes(SENTINELS.D1_DATABASE_ID)) found.add("D1_DATABASE_ID");
  if (text.includes(SENTINELS.KV_NAMESPACE_ID)) found.add("KV_NAMESPACE_ID");
  return [...found];
}

const unresolved = findUnresolved(template);

// 无占位值 → Cloudflare(或用户)已写入真实 ID,直接透传
if (unresolved.length === 0) {
  writeOutput(template, new Map());
  console.log("✔ wrangler.toml 已包含真实资源 ID,直接生成 wrangler.generated.toml");
  process.exit(0);
}

// ===== 变量来源 =====

/** 极简 dotenv 解析(KEY=VALUE,忽略注释与空行) */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // 文件里若写了哨兵值,视为未设置
    if (value && value !== SENTINELS[key]) out[key] = value;
  }
  return out;
}

const fileVars = loadEnvFile(ENV_FILE);

/** 调用 wrangler,返回 stdout;失败返回 null */
function wrangler(args) {
  try {
    return execFileSync("npx", ["wrangler", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 90_000,
      shell: process.platform === "win32",
    });
  } catch {
    return null;
  }
}

/** 调用 wrangler 并解析 JSON(截取首个 JSON 数组/对象,跳过横幅) */
function wranglerJson(args) {
  const out = wrangler(args);
  if (!out) return null;
  const start = out.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(out.slice(start));
  } catch {
    return null;
  }
}

/**
 * 精确发现已有资源。
 * 只做「确定性匹配」:D1 按 database_name 全等,KV 按约定标题全等。
 * 不做模糊/包含匹配 —— 曾因此误绑到账号下其他 KV 命名空间,
 * 导致 Session 与任务锁写入错误存储。
 */
function discover(name) {
  if (name === "D1_DATABASE_ID") {
    const list = wranglerJson(["d1", "list", "--json"]);
    if (!Array.isArray(list)) return "";
    const hit = list.find((d) => d.name === configuredDbName);
    return hit?.uuid || hit?.database_id || "";
  }
  if (name === "KV_NAMESPACE_ID") {
    const list = listKvNamespaces();
    const hit = list.find((n) => (n.title ?? "") === expectedKvTitle);
    return hit?.id ?? "";
  }
  return "";
}

let kvCache = null;
function listKvNamespaces() {
  if (kvCache === null) {
    const list = wranglerJson(["kv", "namespace", "list"]);
    kvCache = Array.isArray(list) ? list : [];
  }
  return kvCache;
}

/** CI / 构建环境:只发现,绝不创建资源(避免重复创建) */
const IS_CI = Boolean(
  process.env.CI ||
    process.env.WORKERS_CI ||
    process.env.CF_PAGES ||
    process.env.GITHUB_ACTIONS ||
    process.env.CLOUDFLARE_WORKERS_CI,
);

/** 创建缺失资源并返回新 ID(仅本地) */
function create(name) {
  if (IS_CI) return "";
  if (name === "D1_DATABASE_ID") {
    console.log(`… 未找到 D1 数据库 "${configuredDbName}",正在创建`);
    const out = wrangler(["d1", "create", configuredDbName]);
    return out ? extractId(out, /database_id\s*=\s*"([^"]+)"/) || extractId(out, /"uuid"\s*:\s*"([^"]+)"/) : "";
  }
  if (name === "KV_NAMESPACE_ID") {
    console.log(`… 未找到 KV 命名空间 "${expectedKvTitle}",正在创建`);
    // wrangler 会把 binding 名与 Worker 名拼成标题,直接指定完整标题更可控
    const out = wrangler(["kv", "namespace", "create", "KV"]);
    if (!out) return "";
    const id = extractId(out, /id\s*=\s*"([^"]+)"/) || extractId(out, /"id"\s*:\s*"([^"]+)"/);
    if (id) return id;
    // 兜底:创建成功但输出格式未知 → 重新列举
    kvCache = null;
    return discover("KV_NAMESPACE_ID");
  }
  return "";
}

function extractId(text, re) {
  return re.exec(text)?.[1] ?? "";
}

function resolveVar(name) {
  if (process.env[name] && process.env[name] !== SENTINELS[name]) {
    return { value: process.env[name], from: "环境变量" };
  }
  if (fileVars[name]) return { value: fileVars[name], from: ".env.deploy" };
  const found = discover(name);
  if (found) return { value: found, from: "wrangler 精确匹配" };
  const created = create(name);
  if (created) return { value: created, from: "新建资源" };
  return { value: "", from: null };
}

// ===== 渲染 =====

const missing = [];
const used = new Map();

for (const name of unresolved) {
  const { value, from } = resolveVar(name);
  if (!value) missing.push(name);
  else used.set(name, { value, from });
}

if (missing.length > 0) {
  reportMissing(missing);
  process.exit(1);
}

let rendered = template;
for (const [name, { value }] of used) {
  rendered = rendered.split(`\${${name}}`).join(value);
  rendered = rendered.split(SENTINELS[name]).join(value);
}

writeOutput(rendered, used);
persistEnvFile(used);

console.log(
  `✔ 已生成 wrangler.generated.toml\n` +
    [...used.entries()].map(([k, v]) => `    ${k}=${maskId(v.value)} (${v.from})`).join("\n"),
);

// ===== 辅助 =====

function writeOutput(content, usedMap) {
  const banner =
    `# 此文件由 scripts/gen-config.mjs 自动生成,请勿手动编辑或提交。\n` +
    `# 源文件: wrangler.toml` +
    (usedMap.size > 0 ? `  |  资源 ID 来源: 环境变量 / .env.deploy / wrangler` : "") +
    `\n`;
  writeFileSync(OUTPUT, banner + content, "utf8");
}

/** 把新发现/新建的 ID 写入 .env.deploy,后续运行免去重复查询 */
function persistEnvFile(usedMap) {
  const toPersist = [...usedMap.entries()].filter(
    ([k, v]) => v.from !== "环境变量" && v.from !== ".env.deploy",
  );
  if (toPersist.length === 0 || IS_CI) return;
  const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  let next = existing;
  for (const [key, { value }] of toPersist) {
    const line = `${key}=${value}`;
    next = new RegExp(`^${key}=.*$`, "m").test(next)
      ? next.replace(new RegExp(`^${key}=.*$`, "m"), line)
      : `${next.replace(/\s*$/, "")}\n${line}\n`;
  }
  if (next !== existing) {
    writeFileSync(ENV_FILE, next.replace(/^\n/, ""), "utf8");
    console.log(`… 已把资源 ID 记入 .env.deploy(该文件不入版本库)`);
  }
}

function reportMissing(names) {
  let hint = "";
  if (names.includes("KV_NAMESPACE_ID")) {
    const list = listKvNamespaces();
    if (list.length > 0) {
      hint =
        `\n你账号下现有的 KV 命名空间(可选一个填入 KV_NAMESPACE_ID):\n` +
        list.map((n) => `     ${n.id}  "${n.title ?? ""}"`).join("\n") +
        `\n`;
    }
  }
  console.error(`
✖ 无法解析以下资源 ID:

${names.map((n) => `    ${n}`).join("\n")}
${hint}
${
  IS_CI
    ? `当前为构建环境(不会自动创建资源)。请在
     Cloudflare Dashboard → 你的 Worker → Settings → Build → Variables and Secrets
   中添加同名变量。`
    : `请任选一种方式:

  1) 让脚本自动处理 —— 先登录,再重新执行
     npx wrangler login

  2) 手动指定 —— 写入 ${ENV_FILE}
     cp .env.deploy.example .env.deploy   然后填入真实值

  查询已有资源:
     npx wrangler d1 list
     npx wrangler kv namespace list`
}
`);
}

/** 资源 ID 非机密,日志中仍做部分遮挡,避免误复制到公开场合 */
function maskId(value) {
  return value.length <= 10 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}
