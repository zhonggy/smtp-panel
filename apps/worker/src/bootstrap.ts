/**
 * 运行时数据库结构兜底(幂等)。
 *
 * 正常路径是 `wrangler d1 migrations apply DB` 在部署时执行迁移;
 * 本模块保证任何路径下(含跳过迁移的一键部署)首次访问即可自举,
 * 并能把已有库平滑升级到最新结构。
 *
 * 判定方式:
 *   1. users 表不存在      → 全新库,依次执行 0001 与 0002
 *   2. 新增列不存在        → 已有库,仅执行 0002
 *   3. 都存在              → 无需处理(每隔离实例只检查一次)
 *
 * ALTER TABLE ADD COLUMN 在 SQLite 中不支持 IF NOT EXISTS,
 * 因此逐条执行并忽略「列已存在」类错误。
 */
import initSql from "../../../packages/db/migrations/0001_init.sql";
import upgradeSql from "../../../packages/db/migrations/0002_scheduling_pool_bounce.sql";

let schemaChecked = false;

/** 可安全忽略的错误(重复应用迁移时出现) */
function isIgnorable(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return (
    msg.includes("duplicate column") ||
    msg.includes("already exists") ||
    msg.includes("duplicate index")
  );
}

/** 拆分 SQL 为独立语句(去掉注释行) */
function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 逐条执行,容忍幂等性错误;返回成功条数 */
async function runSql(db: D1Database, sql: string, label: string): Promise<number> {
  const statements = splitStatements(sql);
  let applied = 0;
  for (const stmt of statements) {
    try {
      await db.prepare(stmt).run();
      applied++;
    } catch (e) {
      if (!isIgnorable(e)) {
        console.error(`[bootstrap] ${label} 语句执行失败:`, e, `\nSQL: ${stmt.slice(0, 120)}`);
        throw e;
      }
    }
  }
  return applied;
}

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaChecked) return;
  try {
    const hasUsers = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1")
      .first();

    if (!hasUsers) {
      const a = await runSql(db, initSql, "0001_init");
      const b = await runSql(db, upgradeSql, "0002_upgrade");
      console.log(`[bootstrap] 已初始化数据库结构(${a} + ${b} 条语句)`);
      schemaChecked = true;
      return;
    }

    // 已有库:检查 0002 是否已应用(以 campaigns.scheduled_at 为标志)
    const cols = await db.prepare("PRAGMA table_info(campaigns)").all<{ name: string }>();
    const hasScheduled = (cols.results ?? []).some((c) => c.name === "scheduled_at");
    if (!hasScheduled) {
      const n = await runSql(db, upgradeSql, "0002_upgrade");
      console.log(`[bootstrap] 已升级数据库结构(${n} 条语句)`);
    }
    schemaChecked = true;
  } catch (e) {
    // 不缓存失败状态,后续请求会重试
    console.error("[bootstrap] 数据库结构检查失败:", e);
  }
}
