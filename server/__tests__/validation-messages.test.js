import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';

// express-validator 的 withMessage() 只作用于紧挨着它的那一个校验器。整条链末尾
// 挂一句话时，前面的校验器失败用的是默认文案「Invalid value」——而空值、非字符串
// 恰恰是最常见的出错方式。于是「班级名称留空」这种最普通的错误，API 回的是
// 一句 Invalid value，调用方没法据此改请求。网页端多数表单有自己的前置提示挡着，
// 但 API 是这个项目对外的一等接口（/api/agent/help 把它整套都写进了文档）。
//
// 这里逐条钉住真实文案，并且整体断言任何 400 都不会是 Invalid value——
// 以后谁再在链尾只挂一句话，这里就会红。
describe('校验失败时必须说清是哪里不对，而不是 Invalid value', () => {
  const CASES = [
    ['/api/auth', '../routes/auth.js', 'post', '/api/auth/register', false,
      { username: 'admin_user', password: 'test1234', name: 'T' }, '用户名须为3-20位字母数字'],
    ['/api/auth', '../routes/auth.js', 'post', '/api/auth/register', false,
      { username: 'okuser1', password: 'test1234', name: '' }, '姓名不能为空且最多100个字符'],
    ['/api/auth', '../routes/auth.js', 'post', '/api/auth/register', false,
      { username: 'okuser2', password: 12345678, name: 'T' }, '密码至少8位'],
    ['/api/students', '../routes/students.js', 'post', '/api/students', true,
      { name: '' }, '姓名不能为空'],
    ['/api/students', '../routes/students.js', 'post', '/api/students', true,
      { name: 'X', phone: '1'.repeat(25) }, '手机号格式不正确'],
    ['/api/students', '../routes/students.js', 'post', '/api/students', true,
      { name: 'X', note: 123 }, '备注最多2000个字符'],
    ['/api/classes', '../routes/classes.js', 'post', '/api/classes', true,
      { name: '', grade: '高一', subject: '数学', studentCount: 1 }, '班级名称不能为空'],
    ['/api/classes', '../routes/classes.js', 'post', '/api/classes', true,
      { name: 'X', grade: '高一', subject: '', studentCount: 1 }, '学科不能为空'],
    ['/api/semesters', '../routes/semesters.js', 'post', '/api/semesters', true,
      { name: '', type: 'spring', startDate: '2026-01-01', endDate: '2026-02-01' }, '学期名称不能为空'],
    ['/api/holidays', '../routes/holidays.js', 'post', '/api/holidays', true,
      { date: '2026-05-01', name: '', type: 'holiday' }, '名称不能为空'],
    ['/api/holidays', '../routes/holidays.js', 'post', '/api/holidays/batch', true,
      { items: [{ date: '2026-05-01', type: 'holiday', name: 456 }] }, '名称最多100个字符'],
    // 超长和留空是两回事。withMessage() 只管紧挨着的那个校验器，把整条链的
    // 文案都写成「不能为空」的话，粘贴一个 101 字的名字得到的回复是「姓名不能为空」
    // ——说的是空，而用户明明填了东西。输入框上没有 maxLength，粘贴就能撞上。
    ['/api/students', '../routes/students.js', 'post', '/api/students', true,
      { name: 'X'.repeat(101) }, '姓名最多100个字符'],
    ['/api/students', '../routes/students.js', 'put', '/api/students/1', true,
      { name: 'X'.repeat(101) }, '姓名最多100个字符'],
    ['/api/classes', '../routes/classes.js', 'post', '/api/classes', true,
      { name: 'X'.repeat(101), grade: '高一', subject: '数学', studentCount: 1 }, '班级名称最多100个字符'],
    ['/api/classes', '../routes/classes.js', 'post', '/api/classes', true,
      { name: 'X', grade: '高一', subject: 'S'.repeat(51), studentCount: 1 }, '学科最多50个字符'],
    ['/api/classes', '../routes/classes.js', 'put', '/api/classes/1', true,
      { name: 'X'.repeat(101) }, '班级名称最多100个字符'],
    ['/api/classes', '../routes/classes.js', 'put', '/api/classes/1', true,
      { subject: 'S'.repeat(51) }, '学科最多50个字符'],
  ];

  it.each(CASES)('%s %s %s 的报错是中文说明', async (mount, mod, method, path, needsAuth, body, expected) => {
    const { app, drizzleDb } = await setupApp(mount, mod);
    let headers = {};
    if (needsAuth) {
      const { token } = await makeUser(drizzleDb);
      headers = auth(token);
    }
    const res = await request(app)[method](path).set(headers).send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(expected);
    // 兜底：无论文案怎么改，都不能退回默认的英文占位
    expect(res.body.error).not.toBe('Invalid value');
  });
});
