import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const MAX_TOASTS = 5;
// 导出给 useBoundWarning：它的限流窗口比这个短的话，第二条会在第一条还没消失时就堆上去。
export const TOAST_DURATION_MS = 3000;
const ToastContext = createContext(() => {});
let toastId = 0;

export function useToast() {
  return useContext(ToastContext);
}

export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Set());

  useEffect(() => () => {
    for (const id of timers.current) clearTimeout(id);
    timers.current.clear();
  }, []);

  const showToast = useCallback((message, type = 'error') => {
    const id = `toast-${++toastId}`;
    setToasts(prev => [...prev.slice(-(MAX_TOASTS - 1)), { id, message, type }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setToasts(prev => prev.filter(t => t.id !== id));
    }, TOAST_DURATION_MS);
    timers.current.add(timer);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id}
            className={`px-4 py-2 rounded-lg shadow-lg text-sm text-white pointer-events-auto animate-[fadeInUp_0.2s_ease-out] ${
              t.type === 'success' ? 'bg-green-600' : 'bg-red-600'
            }`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
