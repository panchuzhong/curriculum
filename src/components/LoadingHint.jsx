// 周/月视图加载时的提示。放在课表上面，但不接触摸（pointer-events-none）：盖在网格上的
// 东西一旦在手势中途被卸载，Chromium 之后的 touchmove/touchend 只发给那个脱离了文档的
// 节点，滑动监听收不到结尾。慢于 300ms 才露出来（index.css 的 .loading-hint）。
// 父元素得是 relative，且不在 aria-busy 的区域里：busy 区域内的 status 读屏可能不播报。
export default function LoadingHint() {
  return (
    <p role="status"
      className="loading-hint pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-40 px-3 py-1 rounded-full text-xs text-gray-600 dark:text-gray-300 bg-white/90 dark:bg-gray-800/90 shadow">
      正在加载课表…
    </p>
  );
}
