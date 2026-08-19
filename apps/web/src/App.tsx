import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./auth";
import { Spinner } from "./components/ui";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Smtp from "./pages/Smtp";
import Templates from "./pages/Templates";
import Recipients from "./pages/Recipients";
import Campaigns from "./pages/Campaigns";
import CampaignDetail from "./pages/CampaignDetail";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";

/** 登录保护 */
function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/smtp" element={<Smtp />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/recipients" element={<Recipients />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}