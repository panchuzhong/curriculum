// Global keyboard shortcuts (Arrow/Home navigation) listen on window, so they
// must stand down while the user is typing, inside an open dialog (whose
// focused root is a plain DIV), or holding Alt (browser history chords).
export function shortcutBlocked(e) {
  if (e.altKey) return true;
  const t = e.target;
  if (!t) return false;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  return !!t.closest?.('dialog, [role="dialog"]');
}
