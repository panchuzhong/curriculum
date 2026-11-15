import { useState, useEffect } from 'react';

// 周/月视图加载时的提示。放在课表上面，但不接触摸（pointer-events-none）：盖在网格上的
// 东西一旦在手势中途被卸载，Chromium 之后的 touchmove/touchend 只发给那个脱离了文档的
// 节点，滑动监听收不到结尾。
// 父元素得是 relative，且不在 aria-busy 的区域里：busy 区域内的 status 读屏可能不播报。
// z-30 而非 z-40：移动端侧栏遮罩是 z-40，打平时提示作为后写的兄弟节点会浮在遮罩上面。
export default function LoadingHint() {
  // 慢于 300ms 才露出来：翻一页通常几十毫秒就回来，每次都闪一下比不提示更扰人。
  // role="status" 是 live region，挂载即播报，所以先挂一个空节点，到点再把带底色的文字
  // 一起填进去。底色和文字只看这一个状态：底色另走一个 CSS 计时的话，两个时钟一错开
  // （effect 在绘制之后才开始计时）就会先露出一颗没有字的空药丸。
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <p role="status" className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-30">
      {show && (
        <span className="block px-3 py-1 rounded-full text-xs text-gray-600 dark:text-gray-300 bg-white/90 dark:bg-gray-800/90 shadow">
          正在加载课表…
        </span>
      )}
    </p>
  );
}
