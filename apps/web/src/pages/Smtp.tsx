import { useState, useEffect } from "react";
import { api } from "../api";
import type { SmtpAccountDTO, SmtpTestResultDTO } from "../types";
import { Button, Input, Select, Field, Modal, Badge, Spinner, EmptyRow } from "../components/ui";
import { useToast } from "../toast";

export default function Smtp() {
  const { toast } = useToast();
  const [list, setList] = useState<SmtpAccountDTO[]>([]);
  const [edit, setEdit] = useState<Partial<SmtpAccountDTO> & { password?: string }>({});
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<SmtpTestResultDTO | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<SmtpAccountDTO[]>("/api/smtp").then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditingId(null);
    setEdit({ name: "", host: "", port: 465, username: "", password: "", security: "ssl", from_name: "", from_email: "", reply_to: "", daily_limit: 0, enabled: true });
    setEditOpen(true);
  };

  const openEdit = (item: SmtpAccountDTO) => {
    setEditingId(item.id);
    setEdit({ ...item, password: "" });
    setEditOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (editingId) {
        await api.put(`/api/smtp/${editingId}`, edit);
      } else {
        await api.post("/api/smtp", edit);
      }
      toast(editingId ? "已更新" : "已添加", "success");
      setEditOpen(false);
      load();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("确定删除这个 SMTP 账号?")) return;
    try {
      await api.del(`/api/smtp/${id}`);
      toast("已删除", "success");
      load();
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const testConn = async (id: number) => {
    setTestResult(null);
    setTestLoading(true);
    setTestOpen(true);
    try {
      const r = await api.post<SmtpTestResultDTO>(`/api/smtp/${id}/test`);
      setTestResult(r);
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message, stage: null, transcript: [], extensions: [], auth_mechanisms: [] });
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-200">SMTP 账号</h1>
        <Button onClick={openAdd}>+ 添加 SMTP</Button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800">
              <th className="text-left px-4 py-3">名称</th>
              <th className="text-left px-4 py-3">主机</th>
              <th className="text-left px-4 py-3">加密</th>
              <th className="text-left px-4 py-3">发件人</th>
              <th className="text-right px-4 py-3">今日发送</th>
              <th className="text-center px-4 py-3">状态</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((item) => (
              <tr key={item.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30">
                <td className="px-4 py-3 font-medium">{item.name}</td>
                <td className="px-4 py-3 text-slate-400">{item.host}:{item.port}</td>
                <td className="px-4 py-3"><Badge color={item.security}>{item.security}</Badge></td>
                <td className="px-4 py-3 text-slate-400">{item.from_email}</td>
                <td className="px-4 py-3 text-right">
                  <span className="text-emerald-400">{item.today_success}</span>
                  <span className="text-slate-600 mx-1">/</span>
                  <span className="text-rose-400">{item.today_failed}</span>
                  {item.daily_limit > 0 && <span className="text-slate-500 ml-1">/ {item.daily_limit}</span>}
                </td>
                <td className="px-4 py-3 text-center"><Badge color={item.enabled ? "active" : "blocked"}>{item.enabled ? "正常" : "禁用"}</Badge></td>
                <td className="px-4 py-3 text-right space-x-1">
                  <Button variant="outline" size="sm" onClick={() => testConn(item.id)}>测试</Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>编辑</Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(item.id)}>删除</Button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <EmptyRow colSpan={7} />}
          </tbody>
        </table>
      </div>

      {/* 编辑 Modal */}
      <Modal
        open={editOpen}
        title={editingId ? "编辑 SMTP 账号" : "添加 SMTP 账号"}
        onClose={() => setEditOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setEditOpen(false)}>取消</Button><Button onClick={save} loading={busy}>保存</Button></>}
        wide
      >
        <Field label="名称"><Input value={edit.name ?? ""} onChange={(e: any) => setEdit({ ...edit, name: e.target.value })} required /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="主机"><Input value={edit.host ?? ""} onChange={(e: any) => setEdit({ ...edit, host: e.target.value })} required /></Field>
          <Field label="端口"><Input type="number" value={edit.port ?? 465} onChange={(e: any) => setEdit({ ...edit, port: parseInt(e.target.value) || 465 })} /></Field>
          <Field label="加密">
            <Select value={edit.security ?? "ssl"} onChange={(e: any) => setEdit({ ...edit, security: e.target.value })}>
              <option value="ssl">SSL (465)</option>
              <option value="starttls">STARTTLS (587)</option>
              <option value="none">无加密(测试)</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="用户名"><Input value={edit.username ?? ""} onChange={(e: any) => setEdit({ ...edit, username: e.target.value })} required /></Field>
          <Field label="密码" hint={editingId ? "留空则不修改" : undefined}>
            <Input type="password" value={edit.password ?? ""} onChange={(e: any) => setEdit({ ...edit, password: e.target.value })} required={!editingId} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="发件人名称"><Input value={edit.from_name ?? ""} onChange={(e: any) => setEdit({ ...edit, from_name: e.target.value })} /></Field>
          <Field label="发件人邮箱"><Input value={edit.from_email ?? ""} onChange={(e: any) => setEdit({ ...edit, from_email: e.target.value })} required /></Field>
        </div>
        <Field label="回复地址(可选)"><Input value={edit.reply_to ?? ""} onChange={(e: any) => setEdit({ ...edit, reply_to: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="每日发送上限(0=不限)"><Input type="number" value={edit.daily_limit ?? 0} onChange={(e: any) => setEdit({ ...edit, daily_limit: parseInt(e.target.value) || 0 })} /></Field>
          <Field label="状态">
            <Select value={edit.enabled ? "true" : "false"} onChange={(e: any) => setEdit({ ...edit, enabled: e.target.value === "true" })}>
              <option value="true">启用</option>
              <option value="false">禁用</option>
            </Select>
          </Field>
        </div>
      </Modal>

      {/* 测试结果 Modal */}
      <Modal open={testOpen} title="SMTP 测试结果" onClose={() => setTestOpen(false)} wide>
        {testLoading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
            <Spinner /> 正在测试连接,请稍候…
          </div>
        )}
        {!testLoading && testResult && (
          <div className="space-y-3">
            <div className={`text-sm font-medium ${testResult.ok ? "text-emerald-400" : "text-rose-400"}`}>
              {testResult.ok ? "✓ 连接成功" : "✕ 连接失败"}
            </div>
            {testResult.error && <div className="text-xs bg-rose-900/30 text-rose-300 px-3 py-2 rounded-lg">{testResult.error}</div>}
            {testResult.extensions.length > 0 && (
              <div className="text-xs text-slate-400">扩展: {testResult.extensions.join(", ")}</div>
            )}
            {testResult.auth_mechanisms.length > 0 && (
              <div className="text-xs text-slate-400">认证方式: {testResult.auth_mechanisms.join(", ")}</div>
            )}
            {testResult.transcript.length > 0 && (
              <div className="bg-slate-800 rounded-lg p-3 max-h-48 overflow-y-auto">
                {testResult.transcript.map((l, i) => (
                  <div key={i} className={`text-xs font-mono ${l.startsWith(">") ? "text-indigo-400" : "text-slate-400"}`}>{l}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}