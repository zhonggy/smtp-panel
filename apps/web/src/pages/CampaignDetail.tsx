import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { CampaignDTO, Paged, CampaignRecipientDTO, SendLogDTO } from "../types";
import { Button, Badge, Pagination, Spinner, EmptyRow } from "../components/ui";

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [camp, setCamp] = useState<CampaignDTO | null>(null);
  const [recipTab, setRecipTab] = useState("pending");
  const [recipPage, setRecipPage] = useState(1);
  const [recipData, setRecipData] = useState<Paged<CampaignRecipientDTO> | null>(null);
  const [logPage, setLogPage] = useState(1);
  const [logData, setLogData] = useState<Paged<SendLogDTO> | null>(null);
  const [recipLoading, setRecipLoading] = useState(false);
  const [logLoading, setLogLoading] = useState(false);

  const loadCamp = () => {
    api.get<CampaignDTO>(`/api/campaigns/${id}`).then(setCamp).catch(() => navigate("/campaigns"));
  };
  useEffect(() => { loadCamp(); const t = setInterval(loadCamp, 5000); return () => clearInterval(t); }, [id]);

  useEffect(() => {
    setRecipLoading(true);
    api.get<Paged<CampaignRecipientDTO>>(`/api/campaigns/${id}/recipients?status=${recipTab}&page=${recipPage}`)
      .then(setRecipData).catch(() => {}).finally(() => setRecipLoading(false));
  }, [id, recipTab, recipPage]);

  useEffect(() => {
    setLogLoading(true);
    api.get<Paged<SendLogDTO>>(`/api/campaigns/${id}/logs?page=${logPage}`)
      .then(setLogData).catch(() => {}).finally(() => setLogLoading(false));
  }, [id, logPage]);

  if (!camp) return <div className="text-center py-12"><Spinner /></div>;

  const pct = camp.total > 0 ? ((camp.success + camp.failed) / camp.total * 100).toFixed(1) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={() => navigate("/campaigns")}>&larr; 返回</Button>
        <h1 className="text-lg font-bold text-slate-200">{camp.name}</h1>
        <Badge color={camp.status}>{camp.status}</Badge>
      </div>

      {/* 概要 */}
      <div className="grid grid-cols-5 gap-3 text-sm">
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
          <div className="text-slate-500 text-xs">进度</div>
          <div className="text-xl font-bold text-indigo-300 mt-1">{pct}%</div>
        </div>
      </div>

      {/* 进度条 */}
      <div className="bg-slate-800 rounded-full h-2 overflow-hidden">
        <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>

      {camp.last_error && (
        <div className="bg-rose-900/30 text-rose-300 text-xs px-4 py-2 rounded-lg">
          错误: {camp.last_error}
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
              <th className="text-center px-4 py-2">状态</th><th className="text-center px-4 py-2">重试</th>
              <th className="text-left px-4 py-2">错误</th><th className="text-left px-4 py-2">发送时间</th>
            </tr></thead>
            <tbody>
              {recipLoading ? <EmptyRow colSpan={6}><Spinner /></EmptyRow> :
                recipData?.items.map((r) => (
                  <tr key={r.id} className="border-b border-slate-800/50 last:border-0">
                    <td className="px-4 py-2">{r.email}</td>
                    <td className="px-4 py-2 text-slate-400">{r.name ?? "-"}</td>
                    <td className="px-4 py-2 text-center"><Badge color={r.status}>{r.status}</Badge></td>
                    <td className="px-4 py-2 text-center text-slate-500">{r.retry_count}</td>
                    <td className="px-4 py-2 text-rose-400 text-xs max-w-[200px] truncate">{r.last_error ?? "-"}</td>
                    <td className="px-4 py-2 text-slate-500 text-xs">{r.sent_at ? r.sent_at.slice(0, 19).replace("T", " ") : "-"}</td>
                  </tr>
                ))}
              {!recipLoading && recipData?.items.length === 0 && <EmptyRow colSpan={6} />}
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
                <Badge color={l.status}>{l.status}</Badge>
                <span>{l.recipient}</span>
                <span className="text-slate-500 truncate">{l.subject}</span>
                {l.error && <span className="text-rose-400 truncate ml-auto">{l.error}</span>}
                <span className="text-slate-600 ml-auto">{l.created_at.slice(0, 19).replace("T", " ")}</span>
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