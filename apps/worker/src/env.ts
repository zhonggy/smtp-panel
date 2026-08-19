import type { SmtpSecurity } from "@panel/shared";

/** 队列消息 */
export interface QueueMessage {
  type: "campaign_tick";
  campaign_id: number;
}

/** Worker 绑定 */
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  MAIL_QUEUE: Queue<QueueMessage>;
  ASSETS: Fetcher;
  /** 加密密钥(可选:未设置时自动生成并存储于 D1) */
  ENCRYPTION_KEY?: string;
}

/** Hono 环境类型 */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    userId: number;
    username: string;
  };
};

export const SESSION_COOKIE = "sp_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export const EXTERNAL_API_BASE_URL_KEY = "external_api_base_url";
export const EXTERNAL_API_KEY_STORED = "external_api_key_encrypted";
export const EXTERNAL_API_DEFAULT_GROUP = "external_api_default_group";

export type { SmtpSecurity };
