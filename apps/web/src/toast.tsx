import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastCtx {
  toast: (message: string, type?: Toast["type"]) => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

let _id = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = _id++;
    setList((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setList((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const remove = (id: number) => {
    setList((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {list.map((t) => (
          <div
            key={t.id}
            onClick={() => remove(t.id)}
            className={`px-4 py-3 rounded-lg shadow-lg text-sm cursor-pointer animate-slide-up flex items-center gap-2 ${
              t.type === "success"
                ? "bg-emerald-700 text-white"
                : t.type === "error"
                  ? "bg-rose-700 text-white"
                  : "bg-slate-700 text-slate-200"
            }`}
          >
            <span className="text-lg">
              {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}