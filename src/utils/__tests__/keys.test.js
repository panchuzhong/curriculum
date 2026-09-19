import { describe, it, expect } from 'vitest';
import { shortcutBlocked } from '../keys';

// 桩要能分得开选择器。原来写的是 closest: (sel) => /dialog/.test(sel) ? {} : null，
// 'dialog' 和 '[role="dialog"]' 它一个都区分不了——把 [role="dialog"] 整段删掉，
// 「弹窗内要拦住」那条用例照样绿。而除 ConfirmDialog 之外，应用里每个弹窗都是
// <div role="dialog">（ScheduleDialog / BatchScheduleDialog / ExportDialog / StudentList），
// useDialogFocusTrap 聚焦的也正是那个 div：丢了这一段，方向键和 Home 会穿过打开的
// 弹窗去翻背后的周/月/年课表。
//
// 这里按逗号把选择器列表拆开，只有其中确实有一条命中这个元素才算匹配——
// 和真的 closest 一致，于是两段选择器各自都被钉住。
const ev = (tagName, { matchedBy = null, altKey = false } = {}) => ({
  altKey,
  target: {
    tagName,
    closest: (sel) => (sel.split(',').map(s => s.trim()).includes(matchedBy) ? {} : null),
  },
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

  // 应用里绝大多数弹窗走的是这一条：<div role="dialog">
  it('blocks inside a [role="dialog"], whose focused root is a DIV', () => {
    expect(shortcutBlocked(ev('DIV', { matchedBy: '[role="dialog"]' }))).toBe(true);
  });

  // 原生 <dialog> 元素（ConfirmDialog）走的是另一条
  it('blocks inside a native <dialog> element', () => {
    expect(shortcutBlocked(ev('DIV', { matchedBy: 'dialog' }))).toBe(true);
  });

  it('blocks Alt-chords, which the browser uses for history navigation', () => {
    expect(shortcutBlocked(ev('DIV', { altKey: true }))).toBe(true);
  });
});
