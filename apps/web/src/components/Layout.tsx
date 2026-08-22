import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import ThemeToggle from "./ThemeToggle";

const NAVS = [
  { to: "/dashboard", label: "仪表盘", icon: "📊" },
  { to: "/smtp", label: "SMTP 账号", icon: "📧" },
  { to: "/templates", label: "邮件模板", icon: "📄" },
  { to: "/recipients", label: "收件人", icon: "👥" },
  { to: "/campaigns", label: "发送任务", icon: "🚀" },
  { to: "/logs", label: "发送日志", icon: "📋" },
  { to: "/reports", label: "统计报表", icon: "📈" },
  { to: "/suppressions", label: "抑制名单", icon: "🚫" },
  { to: "/settings", label: "设置", icon: "⚙️" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-slate-800">
          <h1 className="text-sm font-bold tracking-wide">
            <span className="text-indigo-400">SMTP</span> Panel
          </h1>
        </div>
        <nav className="flex-1 overflow-y-auto py-2 space-y-0.5">
          {NAVS.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 text-sm transition ${
                  isActive
                    ? "bg-indigo-600/20 text-indigo-300 border-r-2 border-indigo-500"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`
              }
            >
              <span className="text-base">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-3 text-xs text-slate-500">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="truncate">{user?.username}</span>
            <ThemeToggle />
          </div>
          <button onClick={logout} className="text-rose-400 hover:text-rose-300 transition">
            退出登录
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}