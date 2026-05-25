import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const MAX_TOASTS = 5;
const ToastContext = createContext(() => {});

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
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-(MAX_TOASTS - 1)), { id, message, type }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
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
