import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { CampaignDTO, Paged, CampaignRecipientDTO, SendLogDTO, BounceCategoryMeta } from "../types";
import { Button, Badge, Pagination, Spinner, EmptyRow, RatioBar, fmtTime, pct } from "../components/ui";

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [camp, setCamp] = useState<CampaignDTO | null>(null);
  const [recipTab, setRecipTab] = useState("pending");
  const [recipPage, setRecipPage] = useState(1);
  const [recipCategory, setRecipCategory] = useState("");
  const [recipData, setRecipData] = useState<Paged<CampaignRecipientDTO> | null>(null);
  const [logPage, setLogPage] = useState(1);
  const [logData, setLogData] = useState<Paged<SendLogDTO> | null>(null);
  const [recipLoading, setRecipLoading] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [cats, setCats] = useState<BounceCategoryMeta[]>([]);
  const [bounces, setBounces] = useState<{ category: string; count: number }[]>([]);

  useEffect(() => {
    api.get<BounceCategoryMeta[]>("/api/reports/categories").then(setCats).catch(() => {});
  }, []);

  useEffect(() => {
    api
      .get<{ category: string; count: number }[]>(`/api/campaigns/${id}/bounces`)
      .then(setBounces)
      .catch(() => {});
  }, [id, camp?.failed]);

  const catLabel = (key: string | null) =>
    key ? (cats.find((c) => c.key === key)?.label ?? key) : null;

  const loadCamp = () => {
    api.get<CampaignDTO>(`/api/campaigns/${id}`).then(setCamp).catch(() => navigate("/campaigns"));
  };
  useEffect(() => { loadCamp(); const t = setInterval(loadCamp, 5000); return () => clearInterval(t); }, [id]);

  useEffect(() => {
    setRecipLoading(true);
    const q = new URLSearchParams({ page: String(recipPage) });
    if (recipTab !== "all") q.set("status", recipTab);
    if (recipCategory) q.set("category", recipCategory);
    api.get<Paged<CampaignRecipientDTO>>(`/api/campaigns/${id}/recipients?${q}`)
      .then(setRecipData).catch(() => {}).finally(() => setRecipLoading(false));
  }, [id, recipTab, recipPage, recipCategory]);

  useEffect(() => {
    setLogLoading(true);
    api.get<Paged<SendLogDTO>>(`/api/campaigns/${id}/logs?page=${logPage}`)
      .then(setLogData).catch(() => {}).finally(() => setLogLoading(false));
  }, [id, logPage]);

  if (!camp) return <div className="text-center py-12"><Spinner /></div>;

  const progress = camp.total > 0 ? (((camp.success + camp.failed) / camp.total) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={() => navigate("/campaigns")}>&larr; 返回</Button>
        <h1 className="text-lg font-bold text-slate-200">{camp.name}</h1>
        <Badge color={camp.status}>{camp.status}</Badge>
      </div>

      {/* 元信息 */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
        {camp.use_pool ? (
          <span>
            发送方式: <span className="text-indigo-300">SMTP 池轮换</span>
            {camp.pool_smtp_ids && ` (${camp.pool_smtp_ids.split(",").length} 个账号)`}
          </span>
        ) : (
          <span>SMTP: <span className="text-slate-300">{camp.smtp_name ?? "-"}</span></span>
        )}
        <span>模板: <span className="text-slate-300">{camp.template_name ?? "-"}</span></span>
        <span>速度: <span className="text-slate-300">{camp.speed_limit} 封/分钟</span></span>
        <span>重试: <span className="text-slate-300">{camp.retry_limit} 次</span></span>
        {camp.scheduled_at && (
          <span>计划: <span className="text-violet-300">{fmtTime(camp.scheduled_at)}</span></span>
        )}
        {camp.started_at && <span>开始: <span className="text-slate-300">{fmtTime(camp.started_at)}</span></span>}
        {camp.finished_at && <span>完成: <span className="text-slate-300">{fmtTime(camp.finished_at)}</span></span>}
      </div>

      {/* 概要 */}
      <div className="grid grid-cols-6 gap-3 text-sm">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="text-slate-500 text-xs">总计</div>
          <div className="text-xl font-bold mt-1">{camp.total}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="text-slate-500 text-xs">待发送</div>
          <div className="text-xl font-bold text-sky-300 mt-1">{camp.pending}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="text-slate-500 text-xs">成功</div>
          <div className="text-xl font-bold text-emerald-300 mt-1">{camp.success}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="text-slate-500 text-xs">失败</div>
          <div className="text-xl font-bold text-rose-300 mt-1">{camp.failed}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="text-slate-500 text-xs">抑制跳过</div>
          <div className="text-xl font-bold text-amber-300 mt-1">{camp.suppressed}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="text-slate-500 text-xs">进度</div>
          <div className="text-xl font-bold text-indigo-300 mt-1">{progress}%</div>
        </div>
      </div>

      {/* 进度条 */}
      <div className="bg-slate-800 rounded-full h-2 overflow-hidden">
        <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
      </div>

      {camp.last_error && (
        <div className="bg-rose-900/30 text-rose-300 text-xs px-4 py-2 rounded-lg">
          错误: {camp.last_error}
        </div>
      )}

      {/* 池内账号使用情况 */}
      {camp.use_pool && camp.pool_usage && camp.pool_usage.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-medium text-slate-400 mb-3">池内账号分配</h2>
          <div className="space-y-2">
            {camp.pool_usage.map((u) => {
              const t = u.sent + u.failed;
              return (
                <div key={u.id} className="flex items-center gap-3 text-sm">
                  <span className="w-32 truncate">{u.name}</span>
                  <div className="flex-1">
                    <RatioBar
                      height={6}
                      segments={[
                        { value: u.sent, className: "bg-emerald-600", label: "成功" },
                        { value: u.failed, className: "bg-rose-600", label: "失败" },
                      ]}
                    />
                  </div>
                  <span className="text-xs text-slate-500 w-28 text-right">
                    {u.sent} 成功 / {u.failed} 失败
                  </span>
                  <span className="text-xs text-slate-600 w-14 text-right">
                    {t > 0 ? pct(u.sent / t, 0) : "-"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 退信构成 */}
      {bounces.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-sm font-medium text-slate-400 mb-3">失败原因分布</h2>
          <div className="flex flex-wrap gap-2">
            {bounces.map((b) => (
              <button
                key={b.category}
                onClick={() => {
                  setRecipTab("failed");
                  setRecipCategory(b.category === recipCategory ? "" : b.category);
                  setRecipPage(1);
                }}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition ${
                  recipCategory === b.category ? "ring-1 ring-indigo-500" : ""
                } hover:bg-slate-800`}
              >
                <Badge color={b.category}>{catLabel(b.category)}</Badge>
                <span className="text-slate-400">{b.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 收件人明细 */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl">
        <div className="flex items-center gap-1 px-4 pt-3">
          <span className="text-sm font-medium text-slate-400">收件人明细</span>
          {["pending", "sent", "failed", "all"].map((t) => (
            <button key={t} onClick={() => { setRecipTab(t); setRecipPage(1); }}
              className={`text-xs px-2 py-1 rounded ${recipTab === t ? "bg-indigo-600/30 text-indigo-300" : "text-slate-500 hover:text-slate-300"}`}>
              {t === "pending" ? "待发送" : t === "sent" ? "已发送" : t === "failed" ? "失败" : "全部"}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-slate-500 text-xs border-b border-slate-800">
              <th className="text-left px-4 py-2">邮箱</th><th className="text-left px-4 py-2">姓名</th>
              <th className="text-center px-4 py-2">状态</th><th className="text-center px-4 py-2">类别</th>
              <th className="text-center px-4 py-2">重试</th>
              <th className="text-left px-4 py-2">错误</th><th className="text-left px-4 py-2">发送时间</th>
            </tr></thead>
            <tbody>
              {recipLoading ? <EmptyRow colSpan={7}><Spinner /></EmptyRow> :
                recipData?.items.map((r) => (
                  <tr key={r.id} className="border-b border-slate-800/50 last:border-0">
                    <td className="px-4 py-2">{r.email}</td>
                    <td className="px-4 py-2 text-slate-400">{r.name ?? "-"}</td>
                    <td className="px-4 py-2 text-center">
                      <Badge color={r.suppressed ? "blocked" : r.status}>
                        {r.suppressed ? "已抑制" : r.status === "sent" ? "已发送" : r.status === "failed" ? "失败" : "待发送"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {r.bounce_category ? (
                        <Badge color={r.bounce_category}>{catLabel(r.bounce_category)}</Badge>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center text-slate-500">{r.retry_count}</td>
                    <td className="px-4 py-2 text-rose-400 text-xs max-w-[200px] truncate">{r.last_error ?? "-"}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">{fmtTime(r.sent_at)}</td>
                  </tr>
                ))}
              {!recipLoading && recipData?.items.length === 0 && <EmptyRow colSpan={7} />}
            </tbody>
          </table>
        </div>
        {recipData && <div className="px-4 pb-2"><Pagination page={recipPage} total={recipData.total} pageSize={50} onChange={setRecipPage} /></div>}
      </div>

      {/* 日志 */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h2 className="text-sm font-medium text-slate-400 mb-2">发送日志</h2>
        {logLoading ? <Spinner /> : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {logData?.items.map((l) => (
              <div key={l.id} className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/50 rounded px-3 py-1.5">
                <Badge color={l.status}>{l.status === "success" ? "成功" : "失败"}</Badge>
                {l.bounce_category && <Badge color={l.bounce_category}>{catLabel(l.bounce_category)}</Badge>}
                <span>{l.recipient}</span>
                <span className="text-slate-500 truncate">{l.subject}</span>
                {l.error && <span className="text-rose-400 truncate ml-auto">{l.error}</span>}
                <span className="text-slate-600 ml-auto whitespace-nowrap">{fmtTime(l.created_at)}</span>
              </div>
            ))}
            {logData?.items.length === 0 && <div className="text-slate-500 text-xs py-4 text-center">暂无日志</div>}
          </div>
        )}
        {logData && <div className="mt-2"><Pagination page={logPage} total={logData.total} pageSize={50} onChange={setLogPage} /></div>}
      </div>
    </div>
  );
}