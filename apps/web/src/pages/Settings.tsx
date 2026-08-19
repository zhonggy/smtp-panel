import { useState, useEffect } from "react";
import { api } from "../api";
import type { SettingsDTO } from "../types";
import { Button, Input, Field } from "../components/ui";
import { useToast } from "../toast";

export default function Settings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SettingsDTO>({ external_api_base_url: "", external_api_default_group: "", has_external_api_key: false, encryption_key_source: "auto" });
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultGroup, setDefaultGroup] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; total?: number; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);

  // 密码修改
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const load = () => {
    api.get<SettingsDTO>("/api/settings").then((s) => {
      setSettings(s);
      setBaseUrl(s.external_api_base_url ?? "");
      setDefaultGroup(s.external_api_default_group ?? "");
    }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const saveSettings = async () => {
    setBusy(true);
    try {
      await api.put("/api/settings", {
        external_api_base_url: baseUrl,
        external_api_default_group: defaultGroup,
        external_api_key: apiKey || undefined,
      });
      toast("设置已保存", "success");
      setApiKey("");
      load();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setTestBusy(true);
    setTestResult(null);
    try {
      const r = await api.post<{ ok: boolean; total?: number; error?: string }>("/api/settings/test-external");
      setTestResult(r);
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message });
    } finally {
      setTestBusy(false);
    }
  };

  const changePassword = async () => {
    if (newPw !== confirmPw) { toast("两次密码不一致", "error"); return; }
    if (newPw.length < 8) { toast("新密码至少 8 个字符", "error"); return; }
    setPwBusy(true);
    try {
      await api.put("/api/auth/password", { old_password: oldPw, new_password: newPw });
      toast("密码已修改", "success");
      setOldPw(""); setNewPw(""); setConfirmPw("");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-lg font-bold text-slate-200">设置</h1>

      {/* 密钥来源提示 */}
      {settings.encryption_key_source === "auto" && (
        <div className="text-xs text-amber-300 bg-amber-900/20 border border-amber-800/40 rounded-lg px-3 py-2">
          ⚠ 当前使用自动生成的加密密钥(存储在数据库中)。生产环境建议执行
          <code className="mx-1 px-1 bg-slate-800 rounded">npx wrangler secret put ENCRYPTION_KEY</code>
          配置独立密钥;更换密钥后已保存的 SMTP 密码 / API Key 需重新录入。
        </div>
      )}

      {/* 外部对接 */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">外部邮箱系统对接</h2>
        <p className="text-xs text-slate-500">配置 outlookEmail 项目的对外 API,可在收件人管理中拉取邮箱。</p>

        <Field label="API 地址(含协议和端口)">
          <Input
            value={baseUrl}
            onChange={(e: any) => setBaseUrl(e.target.value)}
            placeholder="https://your-server.com"
          />
        </Field>
        <Field label="API Key" hint={settings.has_external_api_key ? "已配置,留空则保持不变" : undefined}>
          <Input
            type="password"
            value={apiKey}
            onChange={(e: any) => setApiKey(e.target.value)}
            placeholder={settings.has_external_api_key ? "已配置(留空不修改)" : "输入 API Key"}
          />
        </Field>
        <Field label="默认分组 ID(可选)">
          <Input
            type="number"
            value={defaultGroup}
            onChange={(e: any) => setDefaultGroup(e.target.value)}
            placeholder="留空=全部"
          />
        </Field>

        <div className="flex gap-2">
          <Button onClick={saveSettings} loading={busy}>保存配置</Button>
          <Button variant="outline" onClick={testConnection} loading={testBusy}>测试连接</Button>
        </div>

        {testResult && (
          <div className={`text-xs px-3 py-2 rounded-lg ${testResult.ok ? "bg-emerald-900/30 text-emerald-300" : "bg-rose-900/30 text-rose-300"}`}>
            {testResult.ok ? `✓ 连接成功, 远程共 ${testResult.total ?? 0} 个账号` : `✕ ${testResult.error}`}
          </div>
        )}
      </div>

      {/* 修改密码 */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">修改管理员密码</h2>
        <Field label="当前密码">
          <Input type="password" value={oldPw} onChange={(e: any) => setOldPw(e.target.value)} />
        </Field>
        <Field label="新密码(至少 8 位)">
          <Input type="password" value={newPw} onChange={(e: any) => setNewPw(e.target.value)} />
        </Field>
        <Field label="确认新密码">
          <Input type="password" value={confirmPw} onChange={(e: any) => setConfirmPw(e.target.value)} />
        </Field>
        <Button onClick={changePassword} loading={pwBusy} variant="outline">修改密码</Button>
      </div>
    </div>
  );
}