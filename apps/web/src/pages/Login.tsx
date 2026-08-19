import { useState, useEffect } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Button, Input, Field } from "../components/ui";

export default function Login() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/auth/status").then((d: any) => setNeedsSetup(d.needs_setup)).catch(() => {});
  }, []);

  if (user) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (needsSetup) {
        if (password !== confirm) { setError("两次密码不一致"); setBusy(false); return; }
        await api.post("/api/auth/setup", { username, password });
      } else {
        await api.post("/api/auth/login", { username, password });
      }
      await refresh();
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-950">
      <form onSubmit={handleSubmit} className="w-80 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4 shadow-2xl">
        <div className="text-center mb-2">
          <h1 className="text-lg font-bold text-indigo-400">SMTP Panel</h1>
          <p className="text-xs text-slate-500 mt-1">
            {needsSetup ? "初始化管理员账号" : "管理员登录"}
          </p>
        </div>
        {error && <div className="bg-rose-900/40 text-rose-300 text-xs px-3 py-2 rounded-lg">{error}</div>}
        <Field label="用户名">
          <Input value={username} onChange={(e: any) => setUsername(e.target.value)} required minLength={3} placeholder="输入用户名" />
        </Field>
        <Field label="密码">
          <Input type="password" value={password} onChange={(e: any) => setPassword(e.target.value)} required minLength={8} placeholder="输入密码" />
        </Field>
        {needsSetup && (
          <Field label="确认密码">
            <Input type="password" value={confirm} onChange={(e: any) => setConfirm(e.target.value)} required minLength={8} placeholder="再次输入密码" />
          </Field>
        )}
        <Button type="submit" loading={busy} className="w-full" size="lg">
          {needsSetup ? "初始化" : "登录"}
        </Button>
      </form>
    </div>
  );
}