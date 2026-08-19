import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { CampaignDTO, SmtpAccountDTO, TemplateDTO } from "../types";
import { Button, Input, Select, Field, Modal, Badge, EmptyRow } from "../components/ui";
import { SPEED_OPTIONS } from "../types";
import { useToast } from "../toast";

export default function Campaigns() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [list, setList] = useState<CampaignDTO[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [smtpList, setSmtpList] = useState<SmtpAccountDTO[]>([]);
  const [tplList, setTplList] = useState<TemplateDTO[]>([]);
  const [form, setForm] = useState({ name: "", smtp_id: 0, template_id: 0, speed_limit: 5, retry_limit: 3, test_email: "" });
  const [busy, setBusy] = useState(false);

  const load = () => api.get<CampaignDTO[]>("/api/campaigns").then(setList).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  const openCreate = async () => {
    const [smtps, tpls] = await Promise.all([
      api.get<SmtpAccountDTO[]>("/api/smtp"),
      api.get<TemplateDTO[]>("/api/templates"),
    ]);
    setSmtpList(smtps.filter((s) => s.enabled));
    setTplList(tpls);
    setForm({ name: "", smtp_id: smtps[0]?.id ?? 0, template_id: tpls[0]?.id ?? 0, speed_limit: 5, retry_limit: 3, test_email: "" });
    setCreateOpen(true);
  };

  const create = async () => {
    if (!form.name || !form.smtp_id || !form.template_id) { toast("请填写完整信息", "error"); return; }
    setBusy(true);
    try {
      const r = await api.post<{ id: number }>("/api/campaigns", form);
      toast("任务已创建", "success");
      setCreateOpen(false);
      load();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const action = async (id: number, act: string, successMsg: string) => {
    try {
      await api.post(`/api/campaigns/${id}/${act}`);
      toast(successMsg, "success");
      load();
    } catch (e: any) { toast(e.message, "error"); }
  };

  const remove = async (id: number) => {
    if (!window.confirm("确定删除该任务?")) return;
    try { await api.del(`/api/campaigns/${id}`); toast("已删除", "success"); load(); }
    catch (e: any) { toast(e.message, "error"); }
  };

  const statusColor = (s: string) => {
    const map: Record<string, string> = { draft: "draft", queued: "queued", sending: "sending", paused: "paused", completed: "completed", cancelled: "cancelled" };
    return map[s] || "draft";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-200">发送任务</h1>
        <Button onClick={openCreate}>+ 创建任务</Button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800">
              <th className="text-left px-4 py-3">名称</th>
              <th className="text-left px-4 py-3">SMTP</th>
              <th className="text-left px-4 py-3">模板</th>
              <th className="text-left px-4 py-3">进度</th>
              <th className="text-center px-4 py-3">状态</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const pct = c.total > 0 ? ((c.success + c.failed) / c.total * 100).toFixed(0) : 0;
              return (
                <tr key={c.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-slate-400">{c.smtp_name ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-400">{c.template_name ?? "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                        <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">{c.success}/{c.total}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={statusColor(c.status)}>{c.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/campaigns/${c.id}`)}>详情</Button>
                    {c.status === "draft" && <Button variant="success" size="sm" onClick={() => action(c.id, "start", "已启动")}>启动</Button>}
                    {c.status === "queued" && <Button variant="danger" size="sm" onClick={() => action(c.id, "pause", "已暂停")}>暂停</Button>}
                    {c.status === "sending" && <Button variant="danger" size="sm" onClick={() => action(c.id, "pause", "已暂停")}>暂停</Button>}
                    {c.status === "paused" && <Button variant="success" size="sm" onClick={() => action(c.id, "resume", "已恢复")}>恢复</Button>}
                    {["queued", "sending", "paused"].includes(c.status) && <Button variant="ghost" size="sm" onClick={() => action(c.id, "cancel", "已取消")}>取消</Button>}
                    {["draft", "paused", "cancelled", "completed"].includes(c.status) && <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>删除</Button>}
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && <EmptyRow colSpan={6} />}
          </tbody>
        </table>
      </div>

      {/* 创建任务 Modal */}
      <Modal open={createOpen} title="创建发送任务" onClose={() => setCreateOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button><Button onClick={create} loading={busy}>创建</Button></>}>
        <Field label="任务名称"><Input value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} required /></Field>
        {smtpList.length > 0 ? (
          <Field label="SMTP 账号">
            <Select value={form.smtp_id} onChange={(e: any) => setForm({ ...form, smtp_id: parseInt(e.target.value) })}>
              {smtpList.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.from_email})</option>)}
            </Select>
          </Field>
        ) : <div className="text-xs text-rose-400">请先添加并启用 SMTP 账号</div>}
        {tplList.length > 0 ? (
          <Field label="邮件模板">
            <Select value={form.template_id} onChange={(e: any) => setForm({ ...form, template_id: parseInt(e.target.value) })}>
              {tplList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        ) : <div className="text-xs text-rose-400">请先创建邮件模板</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="发送速度(封/分钟)">
            <Select value={form.speed_limit} onChange={(e: any) => setForm({ ...form, speed_limit: parseInt(e.target.value) })}>
              {SPEED_OPTIONS.map((v) => <option key={v} value={v}>{v} 封/分钟</option>)}
            </Select>
          </Field>
          <Field label="失败重试次数">
            <Select value={form.retry_limit} onChange={(e: any) => setForm({ ...form, retry_limit: parseInt(e.target.value) })}>
              {[1, 2, 3, 5, 10].map((v) => <option key={v} value={v}>{v} 次</option>)}
            </Select>
          </Field>
        </div>
        <Field label="测试邮箱(可选)" hint="设置后只发送给该邮箱用于测试,不设置则发送给所有有效收件人">
          <Input value={form.test_email} onChange={(e: any) => setForm({ ...form, test_email: e.target.value })} placeholder="留空=发送给全部收件人" />
        </Field>
      </Modal>
    </div>
  );
}