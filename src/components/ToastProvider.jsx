import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}

export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'error') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
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
