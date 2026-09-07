import { describe, it, expect } from 'vitest';
import { shortcutBlocked } from '../keys';

const ev = (tagName, { inDialog = false, altKey = false } = {}) => ({
  altKey,
  target: { tagName, closest: (sel) => (inDialog && /dialog/.test(sel) ? {} : null) },
});

describe('shortcutBlocked', () => {
  it('lets shortcuts through on plain content', () => {
    expect(shortcutBlocked(ev('DIV'))).toBe(false);
  });

  it('blocks while typing in a form control', () => {
    expect(shortcutBlocked(ev('INPUT'))).toBe(true);
    expect(shortcutBlocked(ev('TEXTAREA'))).toBe(true);
    expect(shortcutBlocked(ev('SELECT'))).toBe(true);
  });

  it('blocks inside an open dialog, whose focused root is a DIV', () => {
    expect(shortcutBlocked(ev('DIV', { inDialog: true }))).toBe(true);
  });

  it('blocks Alt-chords, which the browser uses for history navigation', () => {
    expect(shortcutBlocked(ev('DIV', { altKey: true }))).toBe(true);
  });
});
