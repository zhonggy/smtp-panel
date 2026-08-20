import { useState, useEffect } from "react";
import { api } from "../api";
import type {
  ReportOverviewDTO,
  BounceMatrixDTO,
  BounceSampleDTO,
  CampaignReportDTO,
  BounceCategoryKey,
} from "../types";
import { Badge, Button, Select, Spinner, StatCard, RatioBar, EmptyRow, fmtTime, pct } from "../components/ui";

const RANGES = [
  { label: "近 7 天", days: 7 },
  { label: "近 14 天", days: 14 },
  { label: "近 30 天", days: 30 },
  { label: "近 90 天", days: 90 },
];

/** 退信类别配色(与徽章一致的色系) */
const CAT_BAR: Record<string, string> = {
  invalid_recipient: "bg-amber-600",
  mailbox_full: "bg-amber-500",
  blocked: "bg-rose-700",
  rate_limited: "bg-sky-600",
  content_rejected: "bg-orange-600",
  sender_rejected: "bg-fuchsia-600",
  auth: "bg-rose-600",
  connection: "bg-rose-500",
  tls: "bg-red-600",
  timeout: "bg-yellow-600",
  temporary: "bg-slate-500",
  permanent: "bg-rose-400",
  unknown: "bg-slate-600",
};

export default function Reports() {
  const [days, setDays] = useState(7);
  const [overview, setOverview] = useState<ReportOverviewDTO | null>(null);
  const [matrix, setMatrix] = useState<BounceMatrixDTO | null>(null);
  const [samples, setSamples] = useState<BounceSampleDTO[]>([]);
  const [sampleCat, setSampleCat] = useState<string>("");
  const [campaignRows, setCampaignRows] = useState<CampaignReportDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "bounces" | "campaigns">("overview");

  const load = async () => {
    setLoading(true);
    try {
      const [ov, mx, cs] = await Promise.all([
        api.get<ReportOverviewDTO>(`/api/reports/overview?days=${days}`),
        api.get<BounceMatrixDTO>(`/api/reports/bounces?days=${days}`),
        api.get<CampaignReportDTO[]>(`/api/reports/campaigns?days=${days}`),
      ]);
      setOverview(ov);
      setMatrix(mx);
      setCampaignRows(cs);
    } catch {
      /* 忽略 */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [days]);

  const loadSamples = async (category: string) => {
    setSampleCat(category);
    try {
      const q = category ? `?category=${encodeURIComponent(category)}&limit=30` : "?limit=30";
      setSamples(await api.get<BounceSampleDTO[]>(`/api/reports/bounce-samples${q}`));
    } catch {
      setSamples([]);
    }
  };

  if (loading && !overview) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (!overview) return null;

  const maxTrend = Math.max(...overview.trend.map((t) => t.total), 1);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-200">统计报表</h1>
        <div className="flex items-center gap-2">
          <Select value={days} onChange={(e: any) => setDays(parseInt(e.target.value))} className="w-28">
            {RANGES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </Select>
          <Button variant="outline" size="sm" onClick={load} loading={loading}>
            刷新
          </Button>
        </div>
      </div>

      {/* 总览卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="发送尝试" value={overview.totals.total} tone="sky" />
        <StatCard label="成功" value={overview.totals.success} tone="emerald" />
        <StatCard label="失败" value={overview.totals.failed} tone="rose" />
        <StatCard label="成功率" value={pct(overview.totals.success_rate)} tone="indigo" />
        <StatCard
          label="抑制名单"
          value={overview.suppressed_total}
          sub="硬退信地址,后续自动跳过"
          tone="amber"
        />
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-slate-800">
        {[
          { key: "overview", label: "趋势与 SMTP" },
          { key: "bounces", label: "退信分析" },
          { key: "campaigns", label: "任务明细" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`px-3 py-2 text-sm transition ${
              tab === t.key
                ? "text-indigo-300 border-b-2 border-indigo-500"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          {/* 趋势 */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-medium text-slate-400 mb-3">发送趋势</h2>
            <div className="flex items-end gap-1 h-32">
              {overview.trend.map((t) => (
                <div key={t.date} className="flex-1 flex flex-col items-center gap-1 group">
                  <div className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition">
                    {t.total}
                  </div>
                  <div
                    className="w-full flex flex-col-reverse rounded-t overflow-hidden"
                    style={{ height: `${(t.total / maxTrend) * 100}%`, minHeight: t.total > 0 ? 2 : 0 }}
                    title={`${t.date}\n成功 ${t.success} / 失败 ${t.failed}`}
                  >
                    <div
                      className="w-full bg-emerald-600/70"
                      style={{ height: `${(t.success / Math.max(t.total, 1)) * 100}%` }}
                    />
                    <div
                      className="w-full bg-rose-600/70"
                      style={{ height: `${(t.failed / Math.max(t.total, 1)) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-600">{t.date.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded bg-emerald-600/70" /> 成功
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded bg-rose-600/70" /> 失败
              </span>
            </div>
          </div>

          {/* SMTP 表现 */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <h2 className="text-sm font-medium text-slate-400 px-4 pt-4 pb-2">SMTP 账号表现</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-800">
                  <th className="text-left px-4 py-2">账号</th>
                  <th className="text-right px-4 py-2">尝试</th>
                  <th className="text-right px-4 py-2">成功</th>
                  <th className="text-right px-4 py-2">失败</th>
                  <th className="text-right px-4 py-2">成功率</th>
                  <th className="text-left px-4 py-2 w-32">占比</th>
                  <th className="text-center px-4 py-2">状态</th>
                </tr>
              </thead>
              <tbody>
                {overview.smtp_performance.map((s) => (
                  <tr key={s.id} className="border-b border-slate-800/50 last:border-0">
                    <td className="px-4 py-2 font-medium">{s.name}</td>
                    <td className="px-4 py-2 text-right">{s.total}</td>
                    <td className="px-4 py-2 text-right text-emerald-400">{s.success}</td>
                    <td className="px-4 py-2 text-right text-rose-400">{s.failed}</td>
                    <td className="px-4 py-2 text-right">{pct(s.success_rate)}</td>
                    <td className="px-4 py-2">
                      <RatioBar
                        height={6}
                        segments={[
                          { value: s.success, className: "bg-emerald-600", label: "成功" },
                          { value: s.failed, className: "bg-rose-600", label: "失败" },
                        ]}
                      />
                    </td>
                    <td className="px-4 py-2 text-center space-x-1">
                      {s.cooling && <Badge color="cooling">冷却</Badge>}
                      {!s.enabled && <Badge color="blocked">禁用</Badge>}
                      {s.in_pool && s.enabled && !s.cooling && <Badge color="active">池中</Badge>}
                    </td>
                  </tr>
                ))}
                {overview.smtp_performance.length === 0 && <EmptyRow colSpan={7}>该时间段内无发送记录</EmptyRow>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "bounces" && (
        <>
          {/* 退信构成 */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-medium text-slate-400 mb-3">退信类别构成</h2>
            {overview.bounces.length === 0 ? (
              <div className="text-sm text-slate-500 py-4 text-center">该时间段内没有退信记录</div>
            ) : (
              <>
                <RatioBar
                  height={12}
                  segments={overview.bounces.map((b) => ({
                    value: b.count,
                    className: CAT_BAR[b.category] ?? "bg-slate-600",
                    label: b.label,
                  }))}
                />
                <div className="mt-3 space-y-1">
                  {overview.bounces.map((b) => (
                    <button
                      key={b.category}
                      onClick={() => loadSamples(b.category)}
                      className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-slate-800/60 transition text-left"
                    >
                      <span className={`w-2.5 h-2.5 rounded ${CAT_BAR[b.category] ?? "bg-slate-600"}`} />
                      <span className="flex-1">{b.label}</span>
                      <span className="text-slate-400">{b.count}</span>
                      <span className="text-slate-600 w-14 text-right">{pct(b.ratio)}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-600 mt-2">点击类别可查看具体样本</p>
              </>
            )}
          </div>

          {/* 退信热力表 */}
          {matrix && matrix.categories.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto">
              <h2 className="text-sm font-medium text-slate-400 mb-3">退信类别 × 日期</h2>
              <table className="text-xs w-full">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left py-1 pr-3 sticky left-0 bg-slate-900">类别</th>
                    {matrix.matrix.map((m) => (
                      <th key={m.date} className="text-center py-1 px-1 font-normal">
                        {m.date.slice(5)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.categories.map((cat) => {
                    const rowMax = Math.max(...matrix.matrix.map((m) => m.counts[cat.key] ?? 0), 1);
                    return (
                      <tr key={cat.key}>
                        <td className="py-1 pr-3 text-slate-400 whitespace-nowrap sticky left-0 bg-slate-900">
                          {cat.label}
                        </td>
                        {matrix.matrix.map((m) => {
                          const v = m.counts[cat.key] ?? 0;
                          const intensity = v === 0 ? 0 : 0.15 + (v / rowMax) * 0.85;
                          return (
                            <td key={m.date} className="p-0.5">
                              <div
                                className="h-6 rounded flex items-center justify-center text-[10px]"
                                style={{
                                  backgroundColor: v === 0 ? "transparent" : `rgba(244,63,94,${intensity})`,
                                  color: intensity > 0.5 ? "#fff" : "#94a3b8",
                                }}
                                title={`${cat.label} ${m.date}: ${v}`}
                              >
                                {v || ""}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 样本 */}
          {samples.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-slate-400">
                  退信样本{sampleCat && ` — ${overview.bounces.find((b) => b.category === sampleCat)?.label ?? sampleCat}`}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setSamples([])}>
                  收起
                </Button>
              </div>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {samples.map((s) => (
                  <div key={s.id} className="text-xs bg-slate-800/50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {s.bounce_category && <Badge color={s.bounce_category}>{s.label}</Badge>}
                      <span className="text-slate-300">{s.recipient}</span>
                      {s.smtp_code && <span className="text-slate-500">SMTP {s.smtp_code}</span>}
                      {s.enhanced_code && <span className="text-slate-600">{s.enhanced_code}</span>}
                      <span className="text-slate-600 ml-auto">{fmtTime(s.created_at)}</span>
                    </div>
                    {s.error && <div className="text-rose-400/80 mt-1 break-all">{s.error}</div>}
                    <div className="text-slate-600 mt-0.5">
                      {s.campaign_name && <span>任务: {s.campaign_name} </span>}
                      {s.smtp_name && <span>· {s.smtp_name}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "campaigns" && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-800">
                <th className="text-left px-4 py-2">任务</th>
                <th className="text-center px-4 py-2">状态</th>
                <th className="text-right px-4 py-2">总数</th>
                <th className="text-right px-4 py-2">成功</th>
                <th className="text-right px-4 py-2">失败</th>
                <th className="text-right px-4 py-2">抑制</th>
                <th className="text-right px-4 py-2">成功率</th>
                <th className="text-left px-4 py-2">完成时间</th>
              </tr>
            </thead>
            <tbody>
              {campaignRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-800/50 last:border-0">
                  <td className="px-4 py-2">
                    <div className="font-medium">{r.name}</div>
                    {r.use_pool && <span className="text-[10px] text-indigo-400">池轮换</span>}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <Badge color={r.status}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">{r.total}</td>
                  <td className="px-4 py-2 text-right text-emerald-400">{r.success}</td>
                  <td className="px-4 py-2 text-right text-rose-400">{r.failed}</td>
                  <td className="px-4 py-2 text-right text-amber-400">{r.suppressed || "-"}</td>
                  <td className="px-4 py-2 text-right">{r.total > 0 ? pct(r.success_rate) : "-"}</td>
                  <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                    {fmtTime(r.finished_at ?? r.scheduled_at ?? r.created_at)}
                  </td>
                </tr>
              ))}
              {campaignRows.length === 0 && <EmptyRow colSpan={8}>该时间段内没有任务</EmptyRow>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
