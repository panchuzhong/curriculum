// 列表/报表通用的持久错误态：请求失败时留在屏上并给出重试入口。
// 只用 toast 的话三秒后提示就没了，页面剩下一个和「真的没有数据」一模一样的
// 空状态，用户既看不出刚才是断网，也没有重新加载的按钮。
export default function ErrorState({ message, onRetry }) {
  return (
    <div className="text-center py-8">
      <p role="alert" className="mb-3 text-red-500">{message}</p>
      <button onClick={onRetry} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600">
        重试
      </button>
    </div>
  );
}
