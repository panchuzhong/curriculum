import { useEffect } from 'react';

// Focus trap for modal dialogs: focuses the dialog on mount, cycles Tab/Shift+Tab
// within it, and restores focus to the previously focused element on unmount.
export function useDialogFocusTrap(dialogRef, enabled = true) {
  useEffect(() => {
    const el = dialogRef.current;
    if (!enabled || !el) return;
    const previouslyFocused = document.activeElement;
    el.focus();
    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]')]
        .filter(node => node.tabIndex >= 0 && !node.matches(':disabled')
          && !node.closest('[inert]') && node.getClientRects().length > 0
          && getComputedStyle(node).visibility !== 'hidden');
      if (focusable.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || active === el || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => {
      el.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [dialogRef, enabled]);
}
