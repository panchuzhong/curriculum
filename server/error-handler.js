// 未被路由自己处理的异常最后都落到这里。必须和测试用的 app 共用同一个：
// 之前生产在 index.js 里挂了它、route-helpers.js 的 setupApp 没挂，于是测试里的
// 500 是 Express 默认的那张 HTML 错误页（带完整堆栈和服务器绝对路径），
// 而生产返回的是一句 JSON。两边行为不一样，测试既盯不住这个处理器本身，
// 读测试输出的人还会把生产行为描述错。
export default function errorHandler(err, req, res, _next) {
  console.error(err.stack || err);
  // Honor parser/route error statuses (e.g. body-parser 413) instead of 500
  res.status(err.status || err.statusCode || 500).json({ error: 'Internal server error' });
}
