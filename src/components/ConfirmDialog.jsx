import { useCallback, useRef } from 'react';

export function useConfirm() {
  const resolveRef = useRef(null);
  const dialogRef = useRef(null);

  const confirm = useCallback((message) => {
    return new Promise((resolve) => {
      // Settle any still-pending confirm as cancelled so its awaiter never hangs.
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      const el = dialogRef.current;
      if (!el) { resolveRef.current = null; resolve(false); return; }
      el.querySelector('[data-confirm-message]').textContent = message;
      if (!el.open) el.showModal();
      el.querySelector('[autofocus]')?.focus();
    });
  }, []);

  const handleClose = useCallback((result) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    dialogRef.current?.close();
  }, []);

  const dialog = (
    <dialog ref={dialogRef} onClose={() => handleClose(false)}
      className="bg-transparent p-0 backdrop:bg-black/50 open:animate-[fadeIn_0.15s_ease] max-w-sm w-full">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 mx-4 shadow-xl">
        <p data-confirm-message className="text-gray-900 dark:text-gray-100 mb-4" />
        <div className="flex justify-end gap-3">
          <button onClick={() => handleClose(false)}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">取消</button>
          <button onClick={() => handleClose(true)} autoFocus
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600">确认</button>
        </div>
      </div>
    </dialog>
  );

  return [confirm, dialog];
}
