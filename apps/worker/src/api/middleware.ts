// ===== 会话鉴权中间件 =====
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { users } from "@panel/db";
import type { AppEnv, Env } from "../env";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "../env";

/** 无需登录即可访问的路径(相对 /api) */
const PUBLIC_PATHS = new Set(["/auth/login", "/auth/setup", "/auth/status"]);

interface SessionData {
  userId: number;
  username: string;
  expires_at: number;
}

export function createSessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function createSession(
  env: Env,
  userId: number,
  username: string,
): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const session: SessionData = {
    userId,
    username,
    expires_at: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  await env.KV.put(`session:${token}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.KV.delete(`session:${token}`);
}

export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const path = c.req.path.replace(/^\/api/, "");
  if (PUBLIC_PATHS.has(path)) return next();

  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: "未登录" }, 401);

  const raw = await c.env.KV.get(`session:${token}`);
  if (!raw) return c.json({ error: "未登录或会话已过期" }, 401);

  let session: SessionData;
  try {
    session = JSON.parse(raw);
  } catch {
    return c.json({ error: "会话数据无效" }, 401);
  }
  if (session.expires_at < Date.now()) {
    await destroySession(c.env, token);
    return c.json({ error: "会话已过期,请重新登录" }, 401);
  }

  // 校验用户仍存在且启用
  const db = drizzle(c.env.DB);
  const [user] = await db
    .select({ id: users.id, username: users.username, enabled: users.enabled })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!user || !user.enabled) {
    await destroySession(c.env, token);
    return c.json({ error: "账号不可用" }, 401);
  }

  c.set("userId", user.id);
  c.set("username", user.username);
  return next();
}

/** 登录限流:KV 计数(滑动窗口,10 次 / 10 分钟) */
export async function checkLoginRateLimit(env: Env, ip: string): Promise<boolean> {
  const key = `rl:login:${ip}`;
  const current = parseInt((await env.KV.get(key)) ?? "0", 10);
  if (current >= 10) return false;
  await env.KV.put(key, String(current + 1), { expirationTtl: 600 });
  return true;
}
