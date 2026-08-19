import { useState, useEffect } from "react";
import { api } from "../api";
import type { DashboardDTO } from "../types";
import { Badge } from "../components/ui";

export default function Dashboard() {
  const [data, setData] = useState<DashboardDTO | null>(null);

  const load = () => api.get<DashboardDTO>("/api/dashboard").then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  if (!data) return null;

  const successRate = data.today.total > 0 ? ((data.today.success / data.today.total) * 100).toFixed(1) : "-";

  const maxTrend = Math.max(...data.trend.map((t) => t.total), 1);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-slate-200">仪表盘</h1>

      {/* 今日统计 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="今日发送" value={data.today.total} color="sky" />
        <StatCard label="成功" value={data.today.success} color="emerald" />
        <StatCard label="失败" value={data.today.failed} color="rose" />
        <StatCard label="成功率" value={`${successRate}%`} color="indigo" />
      </div>

      {/* 概要 */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-slate-400 mb-2">SMTP 账号</div>
          <div className="text-2xl font-bold">{data.smtp.enabled}/{data.smtp.total}</div>
          <div className="text-xs text-slate-500 mt-1">正常 / 总计</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-slate-400 mb-2">发送任务</div>
          <div className="flex gap-3 text-lg font-bold">
            {data.campaigns.sending > 0 && <span className="text-sky-400">进行中 {data.campaigns.sending}</span>}
            {data.campaigns.queued > 0 && <span className="text-indigo-400">排队 {data.campaigns.queued}</span>}
            {data.campaigns.paused > 0 && <span className="text-amber-400">暂停 {data.campaigns.paused}</span>}
            {data.campaigns.draft > 0 && <span className="text-slate-400">草稿 {data.campaigns.draft}</span>}
            {!data.campaigns.sending && !data.campaigns.queued && !data.campaigns.paused && !data.campaigns.draft && (
              <span className="text-slate-500 text-base">暂无任务</span>
            )}
          </div>
        </div>
      </div>

      {/* 趋势 */}
      {data.trend.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-medium text-slate-400 mb-3">近 7 天发送趋势</h2>
          <div className="flex items-end gap-2 h-24">
            {data.trend.map((t) => (
              <div key={t.date} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col-reverse" style={{ height: `${(t.total / maxTrend) * 100}%` }}>
                  <div className="w-full bg-emerald-600/60 rounded-t" style={{ height: `${(t.success / Math.max(t.total, 1)) * 100}%` }} />
                  <div className="w-full bg-rose-600/60 rounded-t" style={{ height: `${(t.failed / Math.max(t.total, 1)) * 100}%` }} />
                </div>
                <span className="text-[10px] text-slate-500">{t.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SMTP 用量 */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h2 className="text-sm font-medium text-slate-400 mb-3">SMTP 今日用量</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs">
              <th className="text-left py-1">名称</th><th className="text-right py-1">发送</th><th className="text-right py-1">成功</th><th className="text-right py-1">失败</th><th className="text-right py-1">限额</th><th className="text-right py-1">状态</th>
            </tr>
          </thead>
          <tbody>
            {data.smtp_usage.map((s) => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="py-2">{s.name}</td>
                <td className="text-right">{s.today_total}</td>
                <td className="text-right text-emerald-400">{s.today_success}</td>
                <td className="text-right text-rose-400">{s.today_failed}</td>
                <td className="text-right text-slate-500">{s.daily_limit > 0 ? s.daily_limit : "不限"}</td>
                <td className="text-right"><Badge color={s.enabled ? "active" : "blocked"}>{s.enabled ? "正常" : "禁用"}</Badge></td>
              </tr>
            ))}
            {data.smtp_usage.length === 0 && <tr><td colSpan={6} className="text-center py-4 text-slate-500">暂无 SMTP 账号</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 最近错误 */}
      {data.recent_errors.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-medium text-slate-400 mb-3">最近发送失败</h2>
          <div className="space-y-2">
            {data.recent_errors.map((e) => (
              <div key={e.id} className="text-xs bg-slate-800/50 rounded-lg px-3 py-2">
                <span className="text-rose-400">{e.recipient}</span>
                <span className="text-slate-500 mx-1">|</span>
                <span className="text-slate-400">{e.subject}</span>
                {e.error && <div className="text-slate-500 mt-0.5 truncate">{e.error}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colors: Record<string, string> = {
    sky: "border-sky-700/30 text-sky-300",
    emerald: "border-emerald-700/30 text-emerald-300",
    rose: "border-rose-700/30 text-rose-300",
    indigo: "border-indigo-700/30 text-indigo-300",
  };
  return (
    <div className={`bg-slate-900 border ${colors[color] || "border-slate-700/30"} rounded-xl p-4`}>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}