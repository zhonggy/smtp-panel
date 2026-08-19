// ===== 系统设置 =====
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { settings } from "@panel/db";
import type { AppEnv } from "../../env";
import { encryptText, decryptText, encryptionKeySource } from "../crypto";
import {
  EXTERNAL_API_BASE_URL_KEY,
  EXTERNAL_API_KEY_STORED,
  EXTERNAL_API_DEFAULT_GROUP,
} from "../../env";

const router = new Hono<AppEnv>();

/** 获取设置(不返回密钥明文) */
router.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const keyEncrypted = map.get(EXTERNAL_API_KEY_STORED);
  return c.json({
    external_api_base_url: map.get(EXTERNAL_API_BASE_URL_KEY) ?? null,
    external_api_default_group: map.get(EXTERNAL_API_DEFAULT_GROUP) ?? null,
    has_external_api_key: !!keyEncrypted,
    encryption_key_source: await encryptionKeySource(c.env),
  });
});

/** 更新设置 */
router.put("/", async (c) => {
  const body = await c.req.json();
  const now = new Date().toISOString();
  const db = drizzle(c.env.DB);

  const upsert = async (key: string, value: string) => {
    await db
      .insert(settings)
      .values({ key, value, updated_at: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updated_at: now } });
  };

  if (body.external_api_base_url !== undefined) {
    await upsert(EXTERNAL_API_BASE_URL_KEY, String(body.external_api_base_url ?? ""));
  }
  if (body.external_api_default_group !== undefined) {
    await upsert(EXTERNAL_API_DEFAULT_GROUP, String(body.external_api_default_group ?? ""));
  }
  if (typeof body.external_api_key === "string" && body.external_api_key) {
    const encrypted = await encryptText(c.env, body.external_api_key);
    await upsert(EXTERNAL_API_KEY_STORED, encrypted);
  }
  // 空字符串/未传 → 保持原值;显式 clear_api_key=true → 清除
  if (body.clear_api_key === true) {
    await db.delete(settings).where(eq(settings.key, EXTERNAL_API_KEY_STORED));
  }

  return c.json({ ok: true });
});

/** 测试外部 API 连接 */
router.post("/test-external", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const baseUrl = map.get(EXTERNAL_API_BASE_URL_KEY);
  const keyEncrypted = map.get(EXTERNAL_API_KEY_STORED);
  if (!baseUrl || !keyEncrypted) {
    return c.json({ ok: false, error: "未配置外部 API 地址或密钥" });
  }
  const apiKey = await decryptText(c.env, keyEncrypted);
  try {
    const url = new URL("/api/external/accounts", baseUrl);
    url.searchParams.set("limit", "1");
    const res = await fetch(url.toString(), {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return c.json({ ok: false, error: `HTTP ${res.status}` });
    }
    const data = (await res.json()) as { success?: boolean; total?: number; accounts?: unknown[]; error?: unknown };
    if (data.success === false) {
      const errMsg =
        typeof data.error === "string"
          ? data.error
          : ((data.error as { message?: string })?.message ?? "未知错误");
      return c.json({ ok: false, error: errMsg });
    }
    return c.json({ ok: true, total: data.total ?? (data.accounts?.length ?? 0) });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;