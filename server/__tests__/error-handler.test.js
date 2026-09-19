import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import errorHandler from '../error-handler.js';

// 这个处理器此前一条用例都没有，而且生产挂了它、测试用的 app 没挂：测试里的 500
// 是 Express 默认的那张 HTML 错误页，带完整堆栈和服务器绝对路径，跟生产返回的
// JSON 根本不是一回事。于是它既盯不住自己，还会让读测试输出的人把生产行为描述错。
describe('未捕获异常的兜底处理', () => {
  afterEach(() => vi.restoreAllMocks());

  function appThatThrows(thrower) {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = express();
    app.get('/boom', thrower);
    app.use(errorHandler);
    return app;
  }

  it('把同步异常变成一句 JSON，不外泄堆栈和服务器路径', async () => {
    const res = await request(appThatThrows(() => {
      const e = new Error('SECRET_DETAIL');
      e.stack = 'Error: SECRET_DETAIL\n    at /home/someone/app/server/routes/x.js:1:1';
      throw e;
    })).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    // 整个响应体里都不能出现异常原文、堆栈或绝对路径
    expect(res.text).not.toContain('SECRET_DETAIL');
    expect(res.text).not.toContain('/home/');
    expect(res.text).not.toContain('at ');
  });

  // Express 5 会把 async handler 的 rejection 也转给错误中间件；不成立的话
  // 请求会一直挂着，而不是得到这句 500。
  it('async handler 的 rejection 也接得住', async () => {
    const res = await request(appThatThrows(async () => {
      throw new Error('async boom');
    })).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  // body-parser 的 413 之类自带 status，按 500 报会把「你传得太大了」说成「服务器坏了」。
  it.each([
    ['status', 413],
    ['statusCode', 404],
  ])('带 %s 的错误按它自己的状态码返回', async (field, code) => {
    const res = await request(appThatThrows(() => {
      const e = new Error('too large');
      e[field] = code;
      throw e;
    })).get('/boom');

    expect(res.status).toBe(code);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  // 兜底处理器只管「路由没自己处理的异常」那一半。另一半——路由自己写出来的
  // 4xx/5xx——由这条扫源码盯住：客户端每个 catch 都是 toast(e.message || '…')，
  // 而 api.js 把服务端的 error 字段取出来当 message，所以漏了 error 的错误响应
  // 到用户那里就是一句空话（或者一串原始响应文本）。新加一个漏掉的就会红。
  // 和 src/utils/__tests__/dateInputs.test.js 盯 min/max 是同一个路子。
  it('路由写出的每一个 4xx/5xx 都带 error 字段', () => {
    function jsFiles(dir) {
      return readdirSync(dir).flatMap(name => {
        const full = join(dir, name);
        if (name === '__tests__' || name === 'node_modules') return [];
        if (statSync(full).isDirectory()) return jsFiles(full);
        return name.endsWith('.js') ? [full] : [];
      });
    }
    // json( 之后到配对右括号为止的实参文本
    function payloadAt(src, open) {
      let depth = 1;
      for (let i = open; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')' && --depth === 0) return src.slice(open, i);
      }
      return '';
    }

    const offenders = [];
    let scanned = 0;
    for (const file of jsFiles('server')) {
      const src = readFileSync(file, 'utf8');
      const re = /res\s*\.\s*status\s*\(\s*([45]\d\d)\s*\)\s*\.\s*(\w+)\s*\(/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        scanned++;
        const line = src.slice(0, m.index).split('\n').length;
        if (m[2] !== 'json') { offenders.push(`${file}:${line} 用了 .${m[2]}() 而不是 .json()`); continue; }
        if (!payloadAt(src, re.lastIndex).includes('error')) {
          offenders.push(`${file}:${line} 的 ${m[1]} 响应里没有 error 字段`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // 正则写坏了会一个都扫不到、于是无声通过——给个下限把这种情况挡住。
    expect(scanned).toBeGreaterThan(100);
  });

  // 防漂移：两边必须挂同一个。route-helpers 漏挂过一次，测出来的 500 就不是生产的 500。
  it('生产与测试的 app 挂的是同一个处理器', () => {
    for (const f of ['server/index.js', 'server/__tests__/route-helpers.js']) {
      const src = readFileSync(f, 'utf8');
      expect({ f, mounts: src.includes('app.use(errorHandler)') }).toEqual({ f, mounts: true });
      expect({ f, imports: /import errorHandler from '\.\.?\/(\.\.\/)?error-handler\.js'/.test(src) }).toEqual({ f, imports: true });
    }
  });
});
