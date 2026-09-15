"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { X, CheckCircle, AlertTriangle, Info, XCircle } from "lucide-react";

type ToastVariant = "success" | "error" | "warning" | "info";

export type Toast = {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
};

type ToastContextType = {
  toast: (options: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, description, variant }: Omit<Toast, "id">) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { id, title, description, variant }]);
      
      // Auto-dismiss after 5 seconds
      setTimeout(() => removeToast(id), 5000);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toast, removeToast }}>
      {children}
      <div className="fixed bottom-0 right-0 z-50 m-4 flex flex-col gap-2 w-full max-w-sm">
        {toasts.map((t) => (
          <ToastMessage key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}

function ToastMessage({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const variants = {
    success: { bg: "bg-emerald-50 dark:bg-emerald-950", border: "border-emerald-200 dark:border-emerald-800", text: "text-emerald-800 dark:text-emerald-200", icon: <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> },
    error: { bg: "bg-red-50 dark:bg-red-950", border: "border-red-200 dark:border-red-800", text: "text-red-800 dark:text-red-200", icon: <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" /> },
    warning: { bg: "bg-yellow-50 dark:bg-yellow-950", border: "border-yellow-200 dark:border-yellow-800", text: "text-yellow-800 dark:text-yellow-200", icon: <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" /> },
    info: { bg: "bg-blue-50 dark:bg-blue-950", border: "border-blue-200 dark:border-blue-800", text: "text-blue-800 dark:text-blue-200", icon: <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" /> },
  };

  const style = variants[toast.variant];

  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 shadow-lg animate-in slide-in-from-right-5 fade-in duration-300 ${style.bg} ${style.border}`}>
      {style.icon}
      <div className="flex-1 space-y-1">
        <h3 className={`text-sm font-medium ${style.text}`}>{toast.title}</h3>
        {toast.description && (
          <p className={`text-xs opacity-90 ${style.text}`}>{toast.description}</p>
        )}
      </div>
      <button onClick={onDismiss} className={`opacity-70 hover:opacity-100 ${style.text}`}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
