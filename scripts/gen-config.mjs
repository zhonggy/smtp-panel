/**
 * 生成部署用的 Wrangler 配置。
 *
 * 读取 wrangler.toml(含 ${VAR} 占位符),解析后输出 wrangler.generated.toml
 * (已被 .gitignore 忽略),供 deploy / dev / 迁移命令使用。
 *
 * 变量解析优先级:
 *   1. process.env             —— CI / Workers Builds / 临时覆盖
 *   2. .env.deploy 文件         —— 本地开发
 *   3. 通过已登录的 wrangler 自动发现 —— 免配置兜底
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

const template = readFileSync(SOURCE, "utf8");

// 无占位符(例如一键部署时 Cloudflare 已写入真实 ID)→ 直接透传
const placeholders = [...new Set([...template.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]))];
if (placeholders.length === 0) {
  write(template, new Map());
  console.log("✔ wrangler.toml 无占位符,已直接生成 wrangler.generated.toml");
  process.exit(0);
}

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
    if (value) out[key] = value;
  }
  return out;
}

const fileVars = loadEnvFile(ENV_FILE);

/** 调用 wrangler 并解析 JSON 输出;失败返回 null(不中断流程) */
function wranglerJson(args) {
  try {
    const out = execFileSync("npx", ["wrangler", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 60_000,
      shell: process.platform === "win32",
    });
    // 输出可能带有 wrangler 头部横幅,截取首个 JSON 数组/对象
    const start = out.search(/[[{]/);
    if (start < 0) return null;
    return JSON.parse(out.slice(start));
  } catch {
    return null;
  }
}

const configuredDbName = /database_name\s*=\s*"([^"]+)"/.exec(template)?.[1] ?? "smtp-panel";

/**
 * 自动发现仅适用于 D1——配置中的 database_name 提供了确定的匹配依据。
 * KV 配置中只有 binding 名(与命名空间标题无关),无法可靠推断,
 * 因此必须显式配置,避免错绑到同账号下其他命名空间。
 */
let kvListCache = null;
function discover(name) {
  if (name === "D1_DATABASE_ID") {
    const list = wranglerJson(["d1", "list", "--json"]);
    if (!Array.isArray(list)) return "";
    // 严格按名称精确匹配
    const hit = list.find((d) => d.name === configuredDbName);
    return hit?.uuid || hit?.database_id || "";
  }
  return "";
}

/** 列出账号下的 KV 命名空间,仅用于错误提示 */
function listKvForHint() {
  if (kvListCache === null) {
    const list = wranglerJson(["kv", "namespace", "list"]);
    kvListCache = Array.isArray(list) ? list : [];
  }
  return kvListCache;
}

function resolveVar(name) {
  if (process.env[name]) return { value: process.env[name], from: "env" };
  if (fileVars[name]) return { value: fileVars[name], from: ".env.deploy" };
  const found = discover(name);
  return found ? { value: found, from: "wrangler 自动发现" } : { value: "", from: null };
}

const missing = [];
const used = new Map();
const rendered = template.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => {
  const { value, from } = resolveVar(name);
  if (!value) {
    missing.push(name);
    return match;
  }
  used.set(name, { value, from });
  return value;
});

if (missing.length > 0) {
  const needsKv = missing.includes("KV_NAMESPACE_ID");
  let kvHint = "";
  if (needsKv) {
    const namespaces = listKvForHint();
    if (namespaces.length > 0) {
      kvHint = `
你账号下现有的 KV 命名空间(选一个填入 KV_NAMESPACE_ID):
${namespaces.map((n) => `     ${n.id}  "${n.title ?? ""}"`).join("\n")}
`;
    }
  }

  console.error(`
✖ 无法解析以下配置项:

${missing.map((n) => `    ${n}`).join("\n")}
${kvHint}
请任选一种方式提供:

  1) 本地开发 —— 写入 ${ENV_FILE}
     cp .env.deploy.example .env.deploy   然后填入真实值

  2) Workers Builds / CI —— 添加同名构建变量
     Cloudflare Dashboard → 你的 Worker → Settings → Build → Variables and Secrets

查询已有资源:
     npx wrangler d1 list
     npx wrangler kv namespace list

若资源尚未创建:
     npx wrangler login
     npx wrangler d1 create ${configuredDbName}
     npx wrangler kv namespace create KV
     npx wrangler queues create smtp-panel-mail

说明：D1 可根据配置中的 database_name("${configuredDbName}")自动发现；
KV 配置中只有 binding 名，无法可靠对应到具体命名空间，必须显式配置。
`);
  process.exit(1);
}

write(rendered, used);

const summary = [...used.entries()]
  .map(([k, v]) => `${k}=${maskId(v.value)} (${v.from})`)
  .join("\n    ");
console.log(`✔ 已生成 wrangler.generated.toml\n    ${summary}`);

function write(content, usedMap) {
  const banner = `# 此文件由 scripts/gen-config.mjs 自动生成,请勿手动编辑或提交。
# 源文件: wrangler.toml${usedMap.size > 0 ? "  |  变量来源: 环境变量 / .env.deploy / wrangler 自动发现" : ""}
`;
  writeFileSync(OUTPUT, banner + content, "utf8");
}

/** 资源 ID 非机密,日志中仍做部分遮挡,避免误复制到公开场合 */
function maskId(value) {
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
