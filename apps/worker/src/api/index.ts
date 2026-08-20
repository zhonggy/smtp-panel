// ===== API 路由装配 =====
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { authMiddleware } from "./middleware";

import authRoutes from "./routes/auth";
import smtpRoutes from "./routes/smtp";
import templateRoutes from "./routes/templates";
import recipientRoutes from "./routes/recipients";
import campaignRoutes from "./routes/campaigns";
import logRoutes from "./routes/logs";
import dashboardRoutes from "./routes/dashboard";
import settingsRoutes from "./routes/settings";
import reportRoutes from "./routes/reports";
import suppressionRoutes from "./routes/suppressions";

export const apiApp = new Hono<AppEnv>();

// 鉴权(公开路径在中间件内放行)
apiApp.use("*", authMiddleware);

// 安全响应头(在响应生成后设置)
apiApp.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
});

// 404
apiApp.notFound((c) => c.json({ error: "接口不存在" }, 404));

// 500
apiApp.onError((err, c) => {
  console.error("API Error:", err);
  return c.json({ error: err.message || "服务器内部错误" }, 500);
});

// 路由挂载
apiApp.route("/auth", authRoutes);
apiApp.route("/smtp", smtpRoutes);
apiApp.route("/templates", templateRoutes);
apiApp.route("/recipients", recipientRoutes);
apiApp.route("/campaigns", campaignRoutes);
apiApp.route("/logs", logRoutes);
apiApp.route("/dashboard", dashboardRoutes);
apiApp.route("/settings", settingsRoutes);
apiApp.route("/reports", reportRoutes);
apiApp.route("/suppressions", suppressionRoutes);