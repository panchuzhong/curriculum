import { useCallback, useRef } from 'react';
import { useToast, TOAST_DURATION_MS } from '../components/ToastProvider';

// 翻页走到可用日期范围的尽头时，按钮会变灰，但键盘和滑动没有这个提示：
// 什么都不说的话，和页面卡死了没区别。长按方向键会连续触发，所以限流，
// 不然一口气弹出五条一模一样的提示。
export default function useBoundWarning(gapMs = TOAST_DURATION_MS) {
  const toast = useToast();
  // useRef 的参数每次渲染都会求值、除首次外全部丢弃；四个视图各持一份，
  // 而它们在翻页、动画、resize 时都会重渲。惰性初始化，语义不变。
  const lastRef = useRef(null);
  if (!lastRef.current) lastRef.current = new Map();
  // 返回稳定引用：调用方把它写进 useCallback 依赖，每次渲染都换一个闭包的话
  // 那些 memo 就全白做了，键盘监听也会跟着反复拆装。
  return useCallback((message) => {
    const now = Date.now();
    // 每条文案各自限流：只记最近一条的话，交替按方向键和 Ctrl+方向键就能把限流
    // 绕开，一口气堆到 5 条；只看时间不看文案又会把信息更多的那一条吞掉。
    const seen = lastRef.current;
    for (const [msg, at] of seen) if (now - at >= gapMs) seen.delete(msg);
    if (seen.has(message)) return;
    seen.set(message, now);
    toast(message);
  }, [toast, gapMs]);
}
