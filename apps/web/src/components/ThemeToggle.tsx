import { useEffect, useState } from "react";

const THEME_KEY = "smtp-panel-theme";
const LIGHT_CLASS = "light";

/**
 * 主题状态:light(白天) / dark(夜晚,默认)。
 * 通过切换 <html> 上的 .light 类实现,选择持久化到 localStorage。
 */
export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains(LIGHT_CLASS)
      ? "light"
      : "dark",
  );

  useEffect(() => {
    document.documentElement.classList.toggle(LIGHT_CLASS, theme === "light");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* 隐私模式等场景下忽略写入失败 */
    }
  }, [theme]);

  return {
    theme,
    toggle: () => setTheme((t) => (t === "light" ? "dark" : "light")),
  };
}

/** 白天/夜晚切换按钮(显示将要切换到的模式) */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const toLight = theme === "dark";

  return (
    <button
      onClick={toggle}
      title={toLight ? "切换到白天模式" : "切换到夜晚模式"}
      aria-label="切换白天/夜晚主题"
      className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer
                 bg-slate-800/60 hover:bg-slate-700/60 text-slate-400 hover:text-slate-200"
    >
      <span className="text-sm leading-none">{toLight ? "☀️" : "🌙"}</span>
      {toLight ? "白天" : "夜晚"}
    </button>
  );
}
