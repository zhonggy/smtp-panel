import { useState, useEffect } from "react";
import { api } from "../api";
import type { Paged, SuppressionDTO, SuppressionStatsDTO } from "../types";
import {
  Button,
  Input,
  Select,
  Field,
  Modal,
  Badge,
  Pagination,
  EmptyRow,
  Textarea,
  fmtTime,
} from "../components/ui";
import { useToast } from "../toast";

const REASON_LABELS: Record<string, string> = {
  invalid_recipient: "地址无效",
  blocked: "被拒投递",
  manual: "手动添加",
  complaint: "投诉举报",
};

export default function Suppressions() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [data, setData] = useState<Paged<SuppressionDTO> | null>(null);
  const [stats, setStats] = useState<SuppressionStatsDTO | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const pageSize = 20;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) params.set("search", search);
    if (reason) params.set("reason", reason);
    api.get<Paged<SuppressionDTO>>(`/api/suppressions?${params}`).then(setData).catch(() => {});
    api.get<SuppressionStatsDTO>("/api/suppressions/stats").then(setStats).catch(() => {});
  };
  useEffect(() => {
    load();
  }, [page, search, reason]);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ added: number; duplicate: number; invalid: number }>(
        "/api/suppressions",
        { text },
      );
      toast(`已添加 ${r.added} 个,重复 ${r.duplicate},无效 ${r.invalid}`, "success");
      setText("");
      setAddOpen(false);
      load();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, email: string) => {
    if (!window.confirm(`将 ${email} 从抑制名单移除?移除后该地址会重新接收投递。`)) return;
    try {
      await api.del(`/api/suppressions/${id}`);
      toast("已移除", "success");
      load();
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-200">抑制名单</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            硬退信与手动屏蔽的地址,创建任务时自动排除,避免反复投递损害发信声誉
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>+ 手动添加</Button>
      </div>

      {stats && (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-slate-500">
            总计 <b className="text-slate-300">{stats.total}</b>
          </span>
          {stats.by_reason.map((r) => (
            <button
              key={r.reason}
              onClick={() => {
                setReason(r.reason === reason ? "" : r.reason);
                setPage(1);
              }}
              className={`px-2 py-0.5 rounded transition ${
                reason === r.reason ? "bg-indigo-600/30 text-indigo-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {REASON_LABELS[r.reason] ?? r.reason} {r.count}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <Input
          placeholder="搜索邮箱或错误详情..."
          value={search}
          onChange={(e: any) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
        <Select
          value={reason}
          onChange={(e: any) => {
            setReason(e.target.value);
            setPage(1);
          }}
          className="w-36"
        >
          <option value="">全部原因</option>
          {Object.entries(REASON_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800">
              <th className="text-left px-4 py-3">邮箱</th>
              <th className="text-center px-4 py-3">原因</th>
              <th className="text-left px-4 py-3">SMTP 码</th>
              <th className="text-left px-4 py-3">详情</th>
              <th className="text-left px-4 py-3">加入时间</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((s) => (
              <tr key={s.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30">
                <td className="px-4 py-3 font-medium">{s.email}</td>
                <td className="px-4 py-3 text-center">
                  <Badge color={s.bounce_category ?? s.reason}>
                    {s.label ?? REASON_LABELS[s.reason] ?? s.reason}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{s.smtp_code ?? "-"}</td>
                <td className="px-4 py-3 text-slate-500 text-xs max-w-[280px] truncate" title={s.detail ?? ""}>
                  {s.detail ?? "-"}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtTime(s.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => remove(s.id, s.email)}>
                    移除
                  </Button>
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && <EmptyRow colSpan={6}>暂无抑制记录</EmptyRow>}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={page} total={data.total} pageSize={pageSize} onChange={setPage} />}

      <Modal
        open={addOpen}
        title="手动添加到抑制名单"
        onClose={() => setAddOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <Button onClick={add} loading={busy}>
              添加
            </Button>
          </>
        }
      >
        <Field label="邮箱列表" hint="每行一个,或粘贴 CSV;重复的会自动跳过">
          <Textarea
            rows={10}
            value={text}
            onChange={(e: any) => setText(e.target.value)}
            placeholder={"unsubscribe@example.com\ncomplaint@example.com"}
          />
        </Field>
      </Modal>
    </div>
  );
}
