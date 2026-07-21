import { useEffect } from 'react';

// Focus trap for modal dialogs: focuses the dialog on mount, cycles Tab/Shift+Tab
// within it, and restores focus to the previously focused element on unmount.
export function useDialogFocusTrap(dialogRef) {
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const previouslyFocused = document.activeElement;
    el.focus();
    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => {
      el.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);
}
