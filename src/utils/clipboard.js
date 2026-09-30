// 把一段文本放进剪贴板，返回是否成功。
// navigator.clipboard 只在安全上下文（HTTPS 或 localhost）里有，部署在内网 http 地址上
// 时它是 undefined；有它也可能因为权限被拒而失败。这两种情况都退回 execCommand。
// execCommand 失败时多半是返回 false 而不是抛错，所以要看返回值——只看有没有抛错，
// 就会在什么都没复制的情况下告诉用户「已复制」。（它在「什么都没选中」时也返回 true，
// 但下面总是先选中 textarea，所以这里的返回值反映的就是「浏览器准不准复制」。）
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* 退回下面的 execCommand */ }
  }
  // 选中 textarea 会把焦点从按钮上抢走，用完得还回去，不然键盘用户下一次 Tab 得从
  // 页面顶上重新数。
  const previouslyFocused = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  // iOS Safari 对 readonly 字段的 select() 不产生可复制的选区，execCommand 因此什么都
  // 复制不到（clipboard.js 的 iOS 修复就是这一句）；别的浏览器里是无害的重复设置。
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    previouslyFocused?.focus?.();
  }
}
