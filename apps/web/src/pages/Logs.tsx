import { useState, useEffect } from "react";
import { api } from "../api";
import type { Paged, SendLogDTO, BounceCategoryMeta } from "../types";
import { Input, Select, Badge, Pagination, EmptyRow, fmtTime } from "../components/ui";

export default function Logs() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [cats, setCats] = useState<BounceCategoryMeta[]>([]);
  const [data, setData] = useState<Paged<SendLogDTO> | null>(null);
  const pageSize = 30;

  useEffect(() => {
    api.get<BounceCategoryMeta[]>("/api/reports/categories").then(setCats).catch(() => {});
  }, []);

  const load = () => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (status) params.set("status", status);
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    api.get<Paged<SendLogDTO>>(`/api/logs?${params}`).then(setData).catch(() => {});
  };
  useEffect(() => { load(); }, [page, status, search, category]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-slate-200">发送日志</h1>

      <div className="flex gap-3">
        <Input placeholder="搜索收件人/主题/错误..." value={search} onChange={(e: any) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select value={status} onChange={(e: any) => { setStatus(e.target.value); setPage(1); }} className="w-32">
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
        </Select>
        <Select value={category} onChange={(e: any) => { setCategory(e.target.value); setPage(1); }} className="w-40">
          <option value="">全部退信类别</option>
          {cats.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </Select>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800">
              <th className="text-left px-4 py-3">收件人</th>
              <th className="text-left px-4 py-3">主题</th>
              <th className="text-left px-4 py-3">任务</th>
              <th className="text-left px-4 py-3">SMTP</th>
              <th className="text-center px-4 py-3">状态</th>
              <th className="text-center px-4 py-3">退信类别</th>
              <th className="text-left px-4 py-3">错误</th>
              <th className="text-left px-4 py-3">耗时</th>
              <th className="text-left px-4 py-3">时间</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((l) => (
              <tr key={l.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30">
                <td className="px-4 py-3">{l.recipient}</td>
                <td className="px-4 py-3 text-slate-400 max-w-[200px] truncate">{l.subject || "-"}</td>
                <td className="px-4 py-3 text-slate-500">{l.campaign_name ?? "-"}</td>
                <td className="px-4 py-3 text-slate-500">{l.smtp_name ?? "-"}</td>
                <td className="px-4 py-3 text-center"><Badge color={l.status}>{l.status === "success" ? "成功" : "失败"}</Badge></td>
                <td className="px-4 py-3 text-center">
                  {l.bounce_category ? (
                    <Badge color={l.bounce_category}>
                      {cats.find((c) => c.key === l.bounce_category)?.label ?? l.bounce_category}
                    </Badge>
                  ) : (
                    <span className="text-slate-600">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-rose-400 text-xs max-w-[200px] truncate" title={l.error ?? ""}>
                  {l.error ?? "-"}
                  {l.smtp_code ? <span className="text-slate-600 ml-1">({l.smtp_code})</span> : null}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{l.duration_ms != null ? `${l.duration_ms}ms` : "-"}</td>
                <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtTime(l.created_at)}</td>
              </tr>
            ))}
            {data?.items.length === 0 && <EmptyRow colSpan={9} />}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={page} total={data.total} pageSize={pageSize} onChange={setPage} />}
    </div>
  );
}