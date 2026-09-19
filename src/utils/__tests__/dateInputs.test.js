import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATE_MIN, DATE_MAX } from '../constants';

// 原生日期输入框的年份段不会在第 4 位后自动跳段：没有 max 时，直接键入整个日期
// 会得到 5 位以上的年份（HTML 规范允许）。这种值再拿去和 YYYY-MM-DD 比大小、
// 或者交给 new Date() 解析，结果要么静默算错要么直接是 Invalid Date。
// 约束 min/max 就能把年份段封在 4 位，所以每个日期输入框都得带上。
//
// 逐个标签检查而不是数出现次数：属性换个顺序、跨几行写都算合规，同文件里多出来的
// 一对 min/max 也不会替另一个没写的输入框顶包。
const INPUT_TAG = /<input\b[\s\S]*?\/>/g;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // 测试自己就写着这些字符串，扫进来会举报自己。
      return entry.name === '__tests__' ? [] : sourceFiles(path);
    }
    return /\.(jsx?|tsx?)$/.test(entry.name) ? [path] : [];
  });
}

describe('日期输入框', () => {
  it('min/max 本身必须是 4 位年份，否则封不住年份段', () => {
    expect(DATE_MIN).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DATE_MAX).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('每个 type="date" 都带上 min={DATE_MIN} max={DATE_MAX}', () => {
    const offenders = sourceFiles('src').flatMap(file => {
      const source = readFileSync(file, 'utf-8');
      return [...source.matchAll(INPUT_TAG)]
        .map(m => m[0])
        .filter(tag => tag.includes('type="date"'))
        .filter(tag => !(tag.includes('min={DATE_MIN}') && tag.includes('max={DATE_MAX}')))
        .map(tag => `${file}: ${tag.replace(/\s+/g, ' ').slice(0, 70)}`);
    });
    expect(offenders).toEqual([]);
  });

  // min/max 只是把年份段封在 4 位、把越界值标成 :invalid，值照样从 value 传出去。
  // 真正拦住 0261-09-17（年份被原生控件左移，位数正确、服务端也照收）的是使用处的
  // 校验。上面那条只盯属性，写完属性却不校验的文件照样能把坏日期发给接口。
  const VALIDATORS = ['isUsableDate', 'dateRangeError'];

  it('渲染 type="date" 的文件必须自己校验日期值', () => {
    const offenders = sourceFiles('src').filter(file => {
      const source = readFileSync(file, 'utf-8');
      return source.includes('type="date"') && !VALIDATORS.some(v => source.includes(v));
    });
    expect(offenders).toEqual([]);
  });
});
