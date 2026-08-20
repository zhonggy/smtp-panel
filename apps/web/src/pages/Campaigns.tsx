import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { CampaignDTO, SmtpAccountDTO, TemplateDTO } from "../types";
import { SPEED_OPTIONS, SCHEDULE_PRESETS } from "../types";
import {
  Button,
  Input,
  Select,
  Field,
  Modal,
  Badge,
  EmptyRow,
  DateTimeInput,
  fmtTime,
} from "../components/ui";
import { useToast } from "../toast";

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  scheduled: "定时中",
  queued: "排队中",
  sending: "发送中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
};

interface FormState {
  name: string;
  smtp_id: number;
  template_id: number;
  speed_limit: number;
  retry_limit: number;
  test_email: string;
  scheduled_at: string | null;
  use_pool: boolean;
  pool_ids: number[];
}

export default function Campaigns() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [list, setList] = useState<CampaignDTO[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [smtpList, setSmtpList] = useState<SmtpAccountDTO[]>([]);
  const [tplList, setTplList] = useState<TemplateDTO[]>([]);
  const [form, setForm] = useState<FormState>({
    name: "",
    smtp_id: 0,
    template_id: 0,
    speed_limit: 5,
    retry_limit: 3,
    test_email: "",
    scheduled_at: null,
    use_pool: false,
    pool_ids: [],
  });
  const [busy, setBusy] = useState(false);

  const load = () => api.get<CampaignDTO[]>("/api/campaigns").then(setList).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const openCreate = async () => {
    const [smtps, tpls] = await Promise.all([
      api.get<SmtpAccountDTO[]>("/api/smtp"),
      api.get<TemplateDTO[]>("/api/templates"),
    ]);
    const enabled = smtps.filter((s) => s.enabled);
    setSmtpList(enabled);
    setTplList(tpls);
    setForm({
      name: "",
      smtp_id: enabled[0]?.id ?? 0,
      template_id: tpls[0]?.id ?? 0,
      speed_limit: 5,
      retry_limit: 3,
      test_email: "",
      scheduled_at: null,
      use_pool: false,
      pool_ids: enabled.filter((s) => s.in_pool).map((s) => s.id),
    });
    setCreateOpen(true);
  };

  const create = async () => {
    if (!form.name || !form.template_id) {
      toast("请填写任务名称并选择模板", "error");
      return;
    }
    if (form.use_pool && form.pool_ids.length === 0) {
      toast("池模式下至少选择一个 SMTP 账号", "error");
      return;
    }
    if (!form.use_pool && !form.smtp_id) {
      toast("请选择 SMTP 账号", "error");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/campaigns", {
        name: form.name,
        smtp_id: form.use_pool ? undefined : form.smtp_id,
        template_id: form.template_id,
        speed_limit: form.speed_limit,
        retry_limit: form.retry_limit,
        test_email: form.test_email,
        scheduled_at: form.scheduled_at,
        use_pool: form.use_pool,
        pool_smtp_ids: form.use_pool ? form.pool_ids.join(",") : undefined,
      });
      toast(form.scheduled_at ? "定时任务已创建,启动后等待到点执行" : "任务已创建", "success");
      setCreateOpen(false);
      load();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const action = async (id: number, act: string, successMsg: string) => {
    try {
      await api.post(`/api/campaigns/${id}/${act}`);
      toast(successMsg, "success");
      load();
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("确定删除该任务?")) return;
    try {
      await api.del(`/api/campaigns/${id}`);
      toast("已删除", "success");
      load();
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const togglePoolId = (id: number) => {
    setForm((f) => ({
      ...f,
      pool_ids: f.pool_ids.includes(id) ? f.pool_ids.filter((x) => x !== id) : [...f.pool_ids, id],
    }));
  };

  const applyPreset = (minutes: number) => {
    setForm((f) => ({ ...f, scheduled_at: new Date(Date.now() + minutes * 60000).toISOString() }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-200">发送任务</h1>
        <Button onClick={openCreate}>+ 创建任务</Button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800">
              <th className="text-left px-4 py-3">名称</th>
              <th className="text-left px-4 py-3">SMTP</th>
              <th className="text-left px-4 py-3">模板</th>
              <th className="text-left px-4 py-3 min-w-[160px]">进度</th>
              <th className="text-left px-4 py-3">计划时间</th>
              <th className="text-center px-4 py-3">状态</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const done = c.success + c.failed;
              const pct = c.total > 0 ? ((done / c.total) * 100).toFixed(0) : "0";
              return (
                <tr
                  key={c.id}
                  className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30"
                >
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {c.use_pool ? (
                      <Badge color="indigo">
                        池轮换{c.pool_smtp_ids ? ` (${c.pool_smtp_ids.split(",").length})` : ""}
                      </Badge>
                    ) : (
                      (c.smtp_name ?? "-")
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{c.template_name ?? "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-700 rounded-full h-1.5 min-w-[60px]">
                        <div
                          className="bg-indigo-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        {c.success}/{c.total}
                        {c.failed > 0 && <span className="text-rose-400"> -{c.failed}</span>}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {c.scheduled_at ? fmtTime(c.scheduled_at) : "-"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={c.status}>{STATUS_LABELS[c.status] ?? c.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/campaigns/${c.id}`)}>
                      详情
                    </Button>
                    {["draft", "scheduled"].includes(c.status) && (
                      <Button
                        variant="success"
                        size="sm"
                        onClick={() =>
                          action(c.id, "start", c.scheduled_at ? "已排定定时" : "已启动")
                        }
                      >
                        {c.status === "scheduled" ? "重新排定" : c.scheduled_at ? "排定" : "启动"}
                      </Button>
                    )}
                    {c.status === "scheduled" && (
                      <Button variant="outline" size="sm" onClick={() => action(c.id, "unschedule", "已取消定时")}>
                        取消定时
                      </Button>
                    )}
                    {["queued", "sending"].includes(c.status) && (
                      <Button variant="danger" size="sm" onClick={() => action(c.id, "pause", "已暂停")}>
                        暂停
                      </Button>
                    )}
                    {c.status === "paused" && (
                      <Button variant="success" size="sm" onClick={() => action(c.id, "resume", "已恢复")}>
                        恢复
                      </Button>
                    )}
                    {["queued", "sending", "paused", "scheduled"].includes(c.status) && (
                      <Button variant="ghost" size="sm" onClick={() => action(c.id, "cancel", "已取消")}>
                        取消
                      </Button>
                    )}
                    {["draft", "scheduled", "paused", "cancelled", "completed"].includes(c.status) && (
                      <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>
                        删除
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && <EmptyRow colSpan={7} />}
          </tbody>
        </table>
      </div>

      {/* 创建任务 */}
      <Modal
        open={createOpen}
        title="创建发送任务"
        onClose={() => setCreateOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={create} loading={busy}>
              创建
            </Button>
          </>
        }
      >
        <Field label="任务名称">
          <Input value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} required />
        </Field>

        {tplList.length > 0 ? (
          <Field label="邮件模板">
            <Select
              value={form.template_id}
              onChange={(e: any) => setForm({ ...form, template_id: parseInt(e.target.value) })}
            >
              {tplList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div className="text-xs text-rose-400">请先创建邮件模板</div>
        )}

        {/* 发送方式 */}
        <div className="border border-slate-700 rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={!form.use_pool}
                onChange={() => setForm({ ...form, use_pool: false })}
              />
              单账号
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={form.use_pool}
                onChange={() => setForm({ ...form, use_pool: true })}
              />
              SMTP 池轮换
            </label>
          </div>

          {!form.use_pool ? (
            smtpList.length > 0 ? (
              <Field label="SMTP 账号">
                <Select
                  value={form.smtp_id}
                  onChange={(e: any) => setForm({ ...form, smtp_id: parseInt(e.target.value) })}
                >
                  {smtpList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.from_email})
                      {s.daily_limit > 0 ? ` · 限 ${s.daily_limit}/日` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <div className="text-xs text-rose-400">请先添加并启用 SMTP 账号</div>
            )
          ) : (
            <Field
              label={`参与轮换的账号(已选 ${form.pool_ids.length} 个)`}
              hint="按剩余额度与权重自动分配;单个账号故障会自动冷却并切换到其他账号"
            >
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {smtpList.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-slate-800/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form.pool_ids.includes(s.id)}
                      onChange={() => togglePoolId(s.id)}
                    />
                    <span className="flex-1">{s.name}</span>
                    <span className="text-xs text-slate-500">
                      {s.daily_limit > 0 ? `剩 ${Math.max(0, s.daily_limit - s.today_total)}` : "不限"}
                      {s.weight > 1 && ` · 权重 ${s.weight}`}
                    </span>
                    {s.cooling && <Badge color="cooling">冷却中</Badge>}
                  </label>
                ))}
                {smtpList.length === 0 && (
                  <div className="text-xs text-rose-400">没有可用的 SMTP 账号</div>
                )}
              </div>
            </Field>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="发送速度(封/分钟)">
            <Select
              value={form.speed_limit}
              onChange={(e: any) => setForm({ ...form, speed_limit: parseInt(e.target.value) })}
            >
              {SPEED_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v} 封/分钟
                </option>
              ))}
            </Select>
          </Field>
          <Field label="失败重试次数">
            <Select
              value={form.retry_limit}
              onChange={(e: any) => setForm({ ...form, retry_limit: parseInt(e.target.value) })}
            >
              {[1, 2, 3, 5, 10].map((v) => (
                <option key={v} value={v}>
                  {v} 次
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* 定时发送 */}
        <Field
          label="定时发送(可选)"
          hint="留空 = 点击启动后立即发送;设置后需点「排定」,到点由系统自动启动"
        >
          <div className="space-y-2">
            <DateTimeInput
              value={form.scheduled_at}
              onChange={(iso: string | null) => setForm({ ...form, scheduled_at: iso })}
            />
            <div className="flex flex-wrap gap-1">
              {SCHEDULE_PRESETS.map((p) => (
                <Button key={p.label} variant="outline" size="sm" onClick={() => applyPreset(p.minutes)}>
                  {p.label}
                </Button>
              ))}
              {form.scheduled_at && (
                <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, scheduled_at: null })}>
                  清除
                </Button>
              )}
            </div>
          </div>
        </Field>

        <Field label="测试邮箱(可选)" hint="设置后只发送给该邮箱用于验证,不影响收件人列表">
          <Input
            value={form.test_email}
            onChange={(e: any) => setForm({ ...form, test_email: e.target.value })}
            placeholder="留空 = 发送给全部有效收件人"
          />
        </Field>
      </Modal>
    </div>
  );
}
