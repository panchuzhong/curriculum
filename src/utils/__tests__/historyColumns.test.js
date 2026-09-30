import { describe, it, expect } from 'vitest';
import { DEFAULT_HISTORY_COLUMNS, parseHistoryColumns, historyTableColumns, historyTsv, mergeHistoryColumnChoice } from '../historyColumns';

// 排课历史的显示选项存在 localStorage 里，读回来的东西不可信：可能是旧版本写的、
// 被手改过的，或者压根不是 JSON。认得的键只收布尔值，其余一律回到默认——宁可
// 多显示一列，也不要因为一个坏值把用户要复制的那一列悄悄藏掉。
describe('parseHistoryColumns', () => {
  it('默认全部显示，和加这个功能之前一样', () => {
    expect(DEFAULT_HISTORY_COLUMNS).toEqual({ year: true, weekday: true, duration: true, location: true });
  });

  it('没存过（null）时用默认', () => {
    expect(parseHistoryColumns(null)).toEqual(DEFAULT_HISTORY_COLUMNS);
  });

  it('只存了一部分时，其余用默认', () => {
    expect(parseHistoryColumns('{"year":false,"location":false}'))
      .toEqual({ year: false, weekday: true, duration: true, location: false });
  });

  it('不是 JSON 时用默认', () => {
    expect(parseHistoryColumns('{year:false')).toEqual(DEFAULT_HISTORY_COLUMNS);
  });

  it('值不是布尔时那一项用默认', () => {
    // "false" 这个字符串是真值，照搬进去的话「星期」这一列会以为自己该显示，
    // 而 0 是假值，会把「时长」悄悄藏掉。
    expect(parseHistoryColumns('{"weekday":"false","duration":0,"location":null}'))
      .toEqual(DEFAULT_HISTORY_COLUMNS);
  });

  it('数组、数字之类的非对象用默认', () => {
    expect(parseHistoryColumns('[false,false]')).toEqual(DEFAULT_HISTORY_COLUMNS);
    expect(parseHistoryColumns('0')).toEqual(DEFAULT_HISTORY_COLUMNS);
  });

  it('不认得的键不带进来', () => {
    expect(parseHistoryColumns('{"year":false,"extra":true}'))
      .toEqual({ ...DEFAULT_HISTORY_COLUMNS, year: false });
  });

  it('每次返回新对象，改它不会污染默认值', () => {
    const cols = parseHistoryColumns(null);
    cols.year = false;
    expect(DEFAULT_HISTORY_COLUMNS.year).toBe(true);
  });
});


// 表格和「复制」按钮共用这一份列定义：按钮复制出去的，就是屏幕上那几列、那种写法。
describe('historyTableColumns', () => {
  const lesson = { id: 1, date: '2026-05-07', startTime: '09:00', endTime: '10:30', durationBilling: 90, locationName: 'E2E教室' };
  const labels = (cols) => historyTableColumns(cols).map(c => c.label);
  const values = (cols) => historyTableColumns(cols).map(c => c.value(lesson));

  it('默认五列，和原来的表格一样', () => {
    expect(labels(DEFAULT_HISTORY_COLUMNS)).toEqual(['日期', '星期', '时间', '时长', '地点']);
    // 2026-05-07 是周四：WEEKDAYS 从周一起算、getDay() 从周日起算，差一位就全错一天
    expect(values(DEFAULT_HISTORY_COLUMNS)).toEqual(['2026-05-07', '周四', '09:00-10:30', '1.5h', 'E2E教室']);
  });

  it('关掉的列不出现，日期和时间始终在', () => {
    const cols = { year: true, weekday: false, duration: false, location: false };
    expect(labels(cols)).toEqual(['日期', '时间']);
  });

  it('去掉年份后日期只剩月日', () => {
    expect(values({ ...DEFAULT_HISTORY_COLUMNS, year: false })[0]).toBe('05-07');
  });

  it('没有地点时是空格子，不是 undefined', () => {
    const [location] = historyTableColumns(DEFAULT_HISTORY_COLUMNS).slice(-1);
    expect(location.value({ ...lesson, locationName: null })).toBe('');
  });
});

describe('historyTsv', () => {
  const lessons = [
    { id: 1, date: '2026-05-07', startTime: '09:00', endTime: '10:30', durationBilling: 90, locationName: 'A 教室' },
    { id: 2, date: '2026-05-14', startTime: '14:00', endTime: '16:00', durationBilling: 120, locationName: '' },
  ];

  it('表头加每节一行，Tab 分列、换行分行', () => {
    const cols = { year: false, weekday: false, duration: true, location: true };
    expect(historyTsv(lessons, historyTableColumns(cols))).toBe([
      '日期\t时间\t时长\t地点',
      '05-07\t09:00-10:30\t1.5h\tA 教室',
      '05-14\t14:00-16:00\t2.0h\t',
    ].join('\n'));
  });

  it('地点里的 Tab、换行换成空格，不把一格拆成几格、一行拆成几行', () => {
    // 地点是自由文本，API 客户端写得进 Tab 和换行；页面上它们本来就显示成空格。
    const messy = [{ ...lessons[0], locationName: '教学楼\t3层\r\n301' }];
    const cols = { year: true, weekday: false, duration: false, location: true };
    expect(historyTsv(messy, historyTableColumns(cols))).toBe('日期\t时间\t地点\n2026-05-07\t09:00-10:30\t教学楼 3层 301');
  });

  const cols = { year: true, weekday: false, duration: false, location: true };
  const withLocation = (locationName) => historyTsv([{ ...lessons[0], locationName }], historyTableColumns(cols)).split('\n')[1].split('\t')[2];

  it('空白按页面的显示规整：连续空白合成一个、首尾去掉', () => {
    // 按钮复制的必须和屏幕上、和框选复制的一样；HTML 本来就把 ASCII 空白这么处理。
    expect(withLocation('A  教室 ')).toBe('A 教室');
  });

  it('全角空格不是 HTML 会合并的空白，原样保留', () => {
    expect(withLocation('A\u3000教室')).toBe('A\u3000教室');
  });

  it('首尾也只去 ASCII 空白：全角空格、不换行空格在页面上是显示的，不能比屏幕少东西', () => {
    // trim() 会把它们一起剥掉——按钮复制出去的就和屏幕上、和框选复制的不一样。
    expect(withLocation('\u3000报告厅')).toBe('\u3000报告厅');
    expect(withLocation('A 教室\u00A0')).toBe('A 教室\u00A0');
    expect(withLocation('  B 教室\t')).toBe('B 教室');
  });

  it('以 = + - @ 开头的格前面加 \'，粘进表格软件不会被当成公式', () => {
    // 和服务端 CSV 导出同一条规则（data-consistency.test.js 盯着两边一致）。
    expect(withLocation('=HYPERLINK("http://x","地点")')).toBe('\'=HYPERLINK("http://x","地点")');
    expect(withLocation('-报告厅')).toBe("'-报告厅");
  });
});

describe('historyTsv 的缺值', () => {
  it('算不出来的值是空格子，不是字面的 undefined', () => {
    // 历史数据里的 '2026-9-3' 算不出星期几：页面上是空格子，复制出来也得是。
    const cols = { year: true, weekday: true, duration: false, location: false };
    const row = historyTsv([{ id: 1, date: '2026-9-3', startTime: '09:00', endTime: '10:30', durationBilling: 90 }], historyTableColumns(cols)).split('\n')[1];
    expect(row).toBe('2026-9-3\t\t09:00-10:30');
  });
});

// 显示选项只在用户点的时候写，而且只写点到的那一项：一打开就把整份默认值写回去，
// 以后改了默认值，只是看过一眼的用户也会被旧默认值钉住；整份覆盖还会抹掉别的标签页
// 刚存的选择、以及新版本才认得的键。
describe('mergeHistoryColumnChoice', () => {
  it('没存过时只写这一项', () => {
    expect(JSON.parse(mergeHistoryColumnChoice(null, 'year', false))).toEqual({ year: false });
  });

  it('保留已存的其它项，包括这个版本不认得的键', () => {
    const stored = JSON.stringify({ weekday: false, future: true });
    expect(JSON.parse(mergeHistoryColumnChoice(stored, 'year', false)))
      .toEqual({ weekday: false, future: true, year: false });
  });

  it('存的东西坏了时只写这一项', () => {
    expect(JSON.parse(mergeHistoryColumnChoice('{oops', 'location', false))).toEqual({ location: false });
    expect(JSON.parse(mergeHistoryColumnChoice('[1,2]', 'location', false))).toEqual({ location: false });
  });
});

