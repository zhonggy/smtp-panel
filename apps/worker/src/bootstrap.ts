/**
 * 运行时建表兜底:
 * 导入与 `wrangler d1 migrations` 完全相同的 SQL 文件(IF NOT EXISTS,幂等)。
 * 正常情况下迁移由部署脚本执行;此兜底保证任何路径下首次访问即可自举,
 * 每个隔离实例只检查一次(内存标志)。
 */
import schemaSql from "../../../packages/db/migrations/0001_init.sql";

let schemaChecked = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaChecked) return;
  try {
    const existing = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1")
      .first();
    if (existing) {
      schemaChecked = true;
      return;
    }
    // 去掉注释行后按分号拆分为独立语句
    const statements = schemaSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await db.prepare(stmt).run();
    }
    schemaChecked = true;
    console.log(`[bootstrap] 已自动初始化数据库结构(${statements.length} 条语句)`);
  } catch (e) {
    // 不缓存失败,后续请求重试;若表确实缺失,业务查询会返回明确错误
    console.error("[bootstrap] 数据库结构检查失败:", e);
  }
}
