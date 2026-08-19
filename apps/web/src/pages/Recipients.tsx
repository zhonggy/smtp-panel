import { useState, useEffect } from "react";
import { api } from "../api";
import type { Paged, RecipientDTO, CsvImportResultDTO, ExternalImportResultDTO, RecipientStatsDTO, SettingsDTO } from "../types";
import { Button, Input, Select, Field, Modal, Badge, Pagination, EmptyRow, Textarea } from "../components/ui";
import { useToast } from "../toast";

export default function Recipients() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState<Paged<RecipientDTO> | null>(null);
  const [stats, setStats] = useState<RecipientStatsDTO | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [extOpen, setExtOpen] = useState(false);
  const [extSettings, setExtSettings] = useState<SettingsDTO | null>(null);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addRemark, setAddRemark] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvResult, setCsvResult] = useState<CsvImportResultDTO | null>(null);
  const [extResult, setExtResult] = useState<ExternalImportResultDTO | null>(null);
  const [extGroupId, setExtGroupId] = useState("");
  const [extLimit, setExtLimit] = useState(1000);
  const [extOnlyActive, setExtOnlyActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const pageSize = 20;

  const load = () => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    api.get<Paged<RecipientDTO>>(`/api/recipients?${params}`).then(setData).catch(() => {});
    api.get<RecipientStatsDTO>("/api/recipients/stats").then(setStats).catch(() => {});
  };
  useEffect(() => { load(); }, [page, search, status]);

  const add = async () => {
    if (!addEmail.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/recipients", { name: addName, email: addEmail, remark: addRemark });
      toast("已添加", "success");
      setAddOpen(false); setAddName(""); setAddEmail(""); setAddRemark("");
      load();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    if (!window.confirm("确定删除该收件人?")) return;
    try { await api.del(`/api/recipients/${id}`); toast("已删除", "success"); load(); }
    catch (e: any) { toast(e.message, "error"); }
  };

  const toggleStatus = async (id: number, current: string) => {
    const newStatus = current === "active" ? "blocked" : "active";
    try { await api.put(`/api/recipients/${id}`, { status: newStatus }); load(); }
    catch (e: any) { toast(e.message, "error"); }
  };

  // CSV 导入
  const importCsv = async () => {
    if (!csvText.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<CsvImportResultDTO>("/api/recipients/import", { text: csvText });
      setCsvResult(r);
      toast(`导入完成: 新增 ${r.added}, 重复 ${r.duplicate}, 无效 ${r.invalid}`, "success");
      load();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  // 外部系统导入
  const openExt = () => {
    api.get<SettingsDTO>("/api/settings").then(setExtSettings).catch(() => {});
    setExtResult(null);
    setExtOpen(true);
  };

  const importExt = async () => {
    setBusy(true);
    try {
      const r = await api.post<ExternalImportResultDTO>("/api/recipients/import-external", {
        group_id: extGroupId ? Number(extGroupId) : undefined,
        limit: extLimit,
        only_active: extOnlyActive,
      });
      setExtResult(r);
      toast(`导入完成: 新增 ${r.added}, 重复 ${r.duplicate}, 无效 ${r.invalid}`, "success");
      load();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-200">收件人</h1>
        <div className="flex gap-2">
          <Button onClick={() => { setCsvOpen(true); setCsvResult(null); }}>CSV 导入</Button>
          <Button onClick={openExt}>从外部系统拉取</Button>
          <Button onClick={() => setAddOpen(true)}>+ 添加</Button>
        </div>
      </div>

      {/* 统计 */}
      {stats && (
        <div className="flex gap-4 text-xs text-slate-500">
          <span>总计: <b className="text-slate-300">{stats.total}</b></span>
          <span>有效: <b className="text-emerald-400">{stats.active}</b></span>
          <span>屏蔽: <b className="text-rose-400">{stats.blocked}</b></span>
        </div>
      )}

      {/* 搜索 + 筛选 */}
      <div className="flex gap-3">
        <Input placeholder="搜索邮箱/姓名/备注..." value={search} onChange={(e: any) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select value={status} onChange={(e: any) => { setStatus(e.target.value); setPage(1); }} className="w-32">
          <option value="">全部状态</option>
          <option value="active">有效</option>
          <option value="blocked">屏蔽</option>
        </Select>
      </div>

      {/* 表格 */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800">
              <th className="text-left px-4 py-3">邮箱</th>
              <th className="text-left px-4 py-3">姓名</th>
              <th className="text-left px-4 py-3">备注</th>
              <th className="text-left px-4 py-3">来源</th>
              <th className="text-center px-4 py-3">状态</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r) => (
              <tr key={r.id} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30">
                <td className="px-4 py-3 font-medium">{r.email}</td>
                <td className="px-4 py-3 text-slate-400">{r.name ?? "-"}</td>
                <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{r.remark ?? "-"}</td>
                <td className="px-4 py-3 text-slate-500">{r.source}</td>
                <td className="px-4 py-3 text-center">
                  <Badge color={r.status}>{r.status === "active" ? "有效" : "屏蔽"}</Badge>
                </td>
                <td className="px-4 py-3 text-right space-x-1">
                  <Button variant="ghost" size="sm" onClick={() => toggleStatus(r.id, r.status)}>
                    {r.status === "active" ? "屏蔽" : "恢复"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(r.id)}>删除</Button>
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && <EmptyRow colSpan={6} />}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={page} total={data.total} pageSize={pageSize} onChange={setPage} />}

      {/* 添加 Modal */}
      <Modal open={addOpen} title="添加收件人" onClose={() => setAddOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setAddOpen(false)}>取消</Button><Button onClick={add} loading={busy}>添加</Button></>}>
        <Field label="邮箱"><Input value={addEmail} onChange={(e: any) => setAddEmail(e.target.value)} required /></Field>
        <Field label="姓名(可选)"><Input value={addName} onChange={(e: any) => setAddName(e.target.value)} /></Field>
        <Field label="备注(可选)"><Input value={addRemark} onChange={(e: any) => setAddRemark(e.target.value)} /></Field>
      </Modal>

      {/* CSV 导入 Modal */}
      <Modal open={csvOpen} title="CSV / 文本导入" onClose={() => setCsvOpen(false)} wide
        footer={<><Button variant="ghost" onClick={() => setCsvOpen(false)}>关闭</Button><Button onClick={importCsv} loading={busy}>导入</Button></>}>
        <Field label="粘贴 CSV 或每行一个邮箱" hint="支持 name,email,remark 格式,或纯邮箱列表">
          <Textarea rows={10} value={csvText} onChange={(e: any) => setCsvText(e.target.value)} placeholder={`name,email,remark\n张三,zhangsan@example.com,客户\n李四,lisi@example.com`} />
        </Field>
        {csvResult && (
          <div className="text-xs text-slate-400 bg-slate-800 rounded-lg p-3">
            共 {csvResult.total} 条 | 新增 <b className="text-emerald-400">{csvResult.added}</b> | 重复 <b className="text-amber-400">{csvResult.duplicate}</b> | 无效 <b className="text-rose-400">{csvResult.invalid}</b>
          </div>
        )}
      </Modal>

      {/* 外部系统拉取 Modal */}
      <Modal open={extOpen} title="从外部系统拉取邮箱" onClose={() => setExtOpen(false)} wide
        footer={<>
          <Button variant="ghost" onClick={() => setExtOpen(false)}>关闭</Button>
          {extSettings?.external_api_base_url && extSettings?.has_external_api_key && (
            <Button onClick={importExt} loading={busy} variant="primary">拉取并导入</Button>
          )}
        </>}>
        {!extSettings?.external_api_base_url || !extSettings?.has_external_api_key ? (
          <div className="text-sm text-amber-300 bg-amber-900/30 rounded-lg px-4 py-3">
            请先在 <a href="/settings" className="underline">设置页面</a> 配置外部 API 地址和密钥。
          </div>
        ) : (
          <>
            <div className="text-xs text-slate-400 mb-3">
              从 <span className="text-slate-300">{extSettings.external_api_base_url}</span> 拉取邮箱账号。
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="分组 ID(可选)">
                <Input type="number" value={extGroupId} onChange={(e: any) => setExtGroupId(e.target.value)} placeholder="留空=全部" />
              </Field>
              <Field label="数量上限(最多 10000)">
                <Input type="number" value={extLimit} onChange={(e: any) => setExtLimit(Math.max(1, Math.min(10000, parseInt(e.target.value) || 1000)))} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={extOnlyActive} onChange={(e: any) => setExtOnlyActive(e.target.checked)} className="rounded" />
              仅导入 active 状态的账号
            </label>
            {extResult && (
              <div className="text-xs text-slate-400 bg-slate-800 rounded-lg p-3">
                拉取 {extResult.fetched} 条 | 新增 <b className="text-emerald-400">{extResult.added}</b> | 重复 <b className="text-amber-400">{extResult.duplicate}</b> | 无效 <b className="text-rose-400">{extResult.invalid}</b>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}