// ===== 认证路由 =====
import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { eq, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { users } from "@panel/db";
import type { AppEnv } from "../../env";
import { SESSION_COOKIE } from "../../env";
import {
  createSession,
  createSessionCookieOptions,
  destroySession,
  checkLoginRateLimit,
} from "../middleware";
import { hashPassword, verifyPassword } from "../crypto";

const router = new Hono<AppEnv>();

/** 是否已初始化(管理员是否存在) */
router.get("/status", async (c) => {
  const db = drizzle(c.env.DB);
  const [{ n }] = await db.select({ n: count() }).from(users);
  return c.json({ needs_setup: n === 0 });
});

/** 初始化管理员 */
router.post("/setup", async (c) => {
  const db = drizzle(c.env.DB);
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n > 0) return c.json({ error: "管理员已初始化,不可重复设置" }, 400);

  const { username, password } = await c.req.json();
  if (!username || typeof username !== "string" || username.length < 3 || username.length > 32) {
    return c.json({ error: "用户名需 3-32 个字符" }, 400);
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return c.json({ error: "密码至少 8 个字符" }, 400);
  }

  const now = new Date().toISOString();
  const password_hash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({
      username,
      password_hash,
      role: "admin",
      enabled: true,
      created_at: now,
      updated_at: now,
    })
    .returning({ id: users.id, username: users.username });

  // 自动登录
  const token = await createSession(c.env, user.id, user.username);
  setCookie(c, SESSION_COOKIE, token, createSessionCookieOptions(c.req.url.startsWith("https://")));
  return c.json({ ok: true });
});

/** 登录 */
router.post("/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "local";
  if (!(await checkLoginRateLimit(c.env, ip))) {
    return c.json({ error: "登录尝试过于频繁,请稍后再试" }, 429);
  }

  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: "请输入用户名和密码" }, 400);

  const db = drizzle(c.env.DB);
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: "用户名或密码错误" }, 401);
  }
  if (!user.enabled) return c.json({ error: "账号已被禁用" }, 403);

  const token = await createSession(c.env, user.id, user.username);
  setCookie(c, SESSION_COOKIE, token, createSessionCookieOptions(c.req.url.startsWith("https://")));
  return c.json({ ok: true, user: { id: user.id, username: user.username } });
});

/** 登出 */
router.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(c.env, token);
  deleteCookie(c, SESSION_COOKIE);
  return c.json({ ok: true });
});

/** 当前用户信息 */
router.get("/me", (c) => {
  return c.json({ id: c.var.userId, username: c.var.username });
});

/** 修改密码 */
router.put("/password", async (c) => {
  const { old_password, new_password } = await c.req.json();
  if (!old_password || !new_password || new_password.length < 8) {
    return c.json({ error: "旧密码不可为空,新密码至少 8 个字符" }, 400);
  }
  const db = drizzle(c.env.DB);
  const [user] = await db.select().from(users).where(eq(users.id, c.var.userId)).limit(1);
  if (!user || !(await verifyPassword(old_password, user.password_hash))) {
    return c.json({ error: "旧密码错误" }, 403);
  }
  const hash = await hashPassword(new_password);
  await db
    .update(users)
    .set({ password_hash: hash, updated_at: new Date().toISOString() })
    .where(eq(users.id, c.var.userId));
  return c.json({ ok: true });
});

export default router;