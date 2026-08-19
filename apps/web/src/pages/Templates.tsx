import { useState, useEffect } from "react";
import { api } from "../api";
import type { TemplateDTO } from "../types";
import { Button, Input, Field, Modal, Textarea, EmptyRow } from "../components/ui";
import { useToast } from "../toast";

export default function Templates() {
  const { toast } = useToast();
  const [list, setList] = useState<TemplateDTO[]>([]);
  const [edit, setEdit] = useState<Partial<TemplateDTO>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<TemplateDTO[]>("/api/templates").then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditingId(null);
    setEdit({ name: "", subject: "", html_body: "", text_body: "" });
    setEditOpen(true);
  };

  const openEdit = (item: TemplateDTO) => {
    setEditingId(item.id);
    setEdit({ ...item });
    setEditOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (editingId) {
        await api.put(`/api/templates/${editingId}`, edit);
      } else {
        await api.post("/api/templates", edit);
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
    if (!window.confirm("确定删除这个模板?")) return;
    try {
      await api.del(`/api/templates/${id}`);
      toast("已删除", "success");
      load();
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-200">邮件模板</h1>
        <Button onClick={openAdd}>+ 添加模板</Button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800">
              <th className="text-left px-4 py-3">名称</th>
              <th className="text-left px-4 py-3">主题</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((item) => (
              <tr key={item.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30">
                <td className="px-4 py-3 font-medium">{item.name}</td>
                <td className="px-4 py-3 text-slate-400 truncate max-w-md">{item.subject}</td>
                <td className="px-4 py-3 text-right space-x-1">
                  <Button variant="outline" size="sm" onClick={() => setPreview({ html: item.html_body, subject: item.subject })}>预览</Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>编辑</Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(item.id)}>删除</Button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <EmptyRow colSpan={3} />}
          </tbody>
        </table>
      </div>

      {/* 编辑 Modal */}
      <Modal open={editOpen} title={editingId ? "编辑模板" : "添加模板"} onClose={() => setEditOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setEditOpen(false)}>取消</Button><Button onClick={save} loading={busy}>保存</Button></>} wide>
        <Field label="模板名称"><Input value={edit.name ?? ""} onChange={(e: any) => setEdit({ ...edit, name: e.target.value })} required /></Field>
        <Field label="邮件主题" hint="支持 {{name}} {{email}} {{remark}} {{date}}">
          <Input value={edit.subject ?? ""} onChange={(e: any) => setEdit({ ...edit, subject: e.target.value })} required />
        </Field>
        <Field label="HTML 内容" hint="支持变量: {{name}} {{email}} {{remark}} {{date}}">
          <Textarea rows={12} value={edit.html_body ?? ""} onChange={(e: any) => setEdit({ ...edit, html_body: e.target.value })} />
        </Field>
        <Field label="纯文本内容(可选,自动从 HTML 生成)">
          <Textarea rows={6} value={edit.text_body ?? ""} onChange={(e: any) => setEdit({ ...edit, text_body: e.target.value })} />
        </Field>
      </Modal>

      {/* 预览 Modal */}
      <Modal open={!!preview} title={`预览: ${preview?.subject ?? ""}`} onClose={() => setPreview(null)} wide>
        {preview && (
          <iframe
            srcDoc={preview.html}
            className="w-full h-96 bg-white rounded-lg"
            title="preview"
          />
        )}
      </Modal>
    </div>
  );
}