import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDefaultsFromSemesters } from '../SemesterManager';
import { isUsableDate, dateRangeError, addDays } from '../../utils/date';

// 跨年学期模板：fall(y) 结束于 y+1-01-15，winter(y) 结束于 y+1-02-20，
// 即 endDate 的年份已经是 y+1。推荐下一学期时必须回退到模板年份 y，
// 否则推荐结果会整体晚一年。
describe('getDefaultsFromSemesters 跨年度学期推荐', () => {
  it('最新为 2026秋季（结束于 2027-01-15）时，推荐 2026寒假', () => {
    const d = getDefaultsFromSemesters([
      { name: '2026秋季', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-15' },
    ]);
    expect(d).toEqual({ name: '2026寒假', type: 'winter', startDate: '2027-01-15', endDate: '2027-02-20' });
  });

  it('最新为 2026寒假（结束于 2027-02-20）时，推荐 2027春季', () => {
    const d = getDefaultsFromSemesters([
      { name: '2026寒假', type: 'winter', startDate: '2027-01-15', endDate: '2027-02-20' },
    ]);
    expect(d).toEqual({ name: '2027春季', type: 'spring', startDate: '2027-02-23', endDate: '2027-07-05' });
  });

  it('最新为 2027春季（非跨年）时，推荐 2027暑假（不回归）', () => {
    const d = getDefaultsFromSemesters([
      { name: '2027春季', type: 'spring', startDate: '2027-02-23', endDate: '2027-07-05' },
    ]);
    expect(d).toEqual({ name: '2027暑假', type: 'summer', startDate: '2027-07-07', endDate: '2027-08-31' });
  });

  it('最新为 2027暑假（非跨年）时，推荐 2027秋季（不回归）', () => {
    const d = getDefaultsFromSemesters([
      { name: '2027暑假', type: 'summer', startDate: '2027-07-07', endDate: '2027-08-31' },
    ]);
    expect(d).toEqual({ name: '2027秋季', type: 'fall', startDate: '2027-09-01', endDate: '2028-01-15' });
  });
});

// 无学期时按当前日期猜模板：春季 02-23~07-05，暑假 07-07~08-31，秋季 09-01~次年 01-15，
// 寒假 01-15~02-20（模板年份为上一年）。猜出的范围不能整体落在过去。
describe('getDefaultsFromSemesters 无学期时按当月推荐', () => {
  afterEach(() => vi.useRealTimers());

  function at(iso) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  it('3 月推荐当年春季', () => {
    at('2026-03-10T12:00:00');
    expect(getDefaultsFromSemesters([])).toEqual(SEMESTER_TEMPLATE_2026.spring);
  });

  it('7 月推荐当年暑假（春季 07-05 已结束）', () => {
    at('2026-07-20T12:00:00');
    expect(getDefaultsFromSemesters([])).toEqual(SEMESTER_TEMPLATE_2026.summer);
  });

  it('8 月推荐当年暑假', () => {
    at('2026-08-10T12:00:00');
    expect(getDefaultsFromSemesters([])).toEqual(SEMESTER_TEMPLATE_2026.summer);
  });

  it('9 月推荐当年秋季（暑假 08-31 已结束）', () => {
    at('2026-09-05T12:00:00');
    expect(getDefaultsFromSemesters([])).toEqual(SEMESTER_TEMPLATE_2026.fall);
  });

  it('1 月推荐上一年寒假', () => {
    at('2027-01-10T12:00:00');
    expect(getDefaultsFromSemesters([])).toEqual(SEMESTER_TEMPLATE_2026.winter);
  });
});

const SEMESTER_TEMPLATE_2026 = {
  spring: { name: '2026春季', type: 'spring', startDate: '2026-02-23', endDate: '2026-07-05' },
  summer: { name: '2026暑假', type: 'summer', startDate: '2026-07-07', endDate: '2026-08-31' },
  fall:   { name: '2026秋季', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-15' },
  winter: { name: '2026寒假', type: 'winter', startDate: '2027-01-15', endDate: '2027-02-20' },
};

// 模板自己会跃到下一年（fall/winter 的 endDate 是 y+1）：不夹的话，从 2999 往后推
// 会预填出 3000-01-15，而 handleCreate 会拿这个用户没敲过的值报「日期无效」。
describe('getDefaultsFromSemesters 不生成越界日期', () => {
  // 取 2999 春季：往后推是 2999 暑假（07-07~08-31），年份不用夹也在范围内，
  // 所以「<= DATE_MAX」这种松断言分不出夹没夹。要夹的是再往后的秋季——
  // 它的模板 endDate 会跳到 3000-01-15。
  it('从 2999 暑假往后推时不生成 3000 年的日期', () => {
    const next = getDefaultsFromSemesters([
      { id: 1, name: '2999暑假', type: 'summer', startDate: '2999-07-07', endDate: '2999-08-31' },
    ]);
    expect(next.startDate <= '2999-12-31').toBe(true);
    expect(next.endDate <= '2999-12-31').toBe(true);
    // 不夹的话这里会是 '3000-01-15'，上面两条却仍要靠 next 恰好不是秋季才失败。
    // 直接钉住：年份是 4 位且不超过 2999。
    expect(next.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number(next.endDate.slice(0, 4))).toBeLessThanOrEqual(2999);
  });

  it('普通年份不受影响', () => {
    const next = getDefaultsFromSemesters([
      { id: 1, name: '2026春季', type: 'spring', startDate: '2026-02-23', endDate: '2026-07-05' },
    ]);
    expect(next).toMatchObject({ type: 'summer', startDate: '2026-07-07', endDate: '2026-08-31' });
  });
});

// 模板是拿数字年份直接拼字符串的（`${y}-02-23`），而 y 来自
// parseInt(latest.endDate.slice(0, 4))。旧库里那些被原生控件左移成 0261 的学期（还原
// 时故意不丢 semesters，所以它们确实还在）会算出 261，拼出 '261-07-07' 这种三位年份：
// 按字符串比大小它落在上下限之间，clampDate 看不出越界，原样返回。结果是日期框
// 渲染成空白（原生控件不认三位年），一点保存又报一句「日期无效」——报的是用户
// 根本没输入过的值。
describe('getDefaultsFromSemesters 的年份总是 4 位且在范围内', () => {
  it('最新学期年份被左移成 0261 时，预填仍然是可用日期', () => {
    const r = getDefaultsFromSemesters([
      { type: 'spring', startDate: '0261-02-23', endDate: '0261-07-05' },
    ]);
    expect(isUsableDate(r.startDate)).toBe(true);
    expect(isUsableDate(r.endDate)).toBe(true);
    expect(dateRangeError(r.startDate, r.endDate)).toBe(null);
  });

  // 夹出个「1900暑假」也算可用，但那是个看着像回事的错值：用户随手一存
  // 就多一条 1900 年的学期。年份得是按今天猜的，而不是从坏行里夹出来的。
  it('学期行全部不可用时退回按今天猜，而不是夹出一个 1900 年的学期', () => {
    const thisYear = new Date().getFullYear();
    for (const bad of [
      [{ type: 'spring', startDate: '0261-02-23', endDate: '0261-07-05' }],
      [{ type: 'spring', startDate: 'garbage', endDate: 'garbage' }],
    ]) {
      const r = getDefaultsFromSemesters(bad);
      expect(isUsableDate(r.startDate)).toBe(true);
      expect(r.startDate).toBe(getDefaultsFromSemesters([]).startDate);
      expect(Number(r.startDate.slice(0, 4))).toBeGreaterThanOrEqual(thisYear - 1);
    }
  });

  // 坏行不能把好行挤掉：'3000-01-15' 排在 '2026-07-05' 后面，不先筛的话
  // 它会当上「最新学期」，把用户真实的 2026 春季扔了。
  it('坏行被筛掉后，仍然从剩下的好行推算', () => {
    const r = getDefaultsFromSemesters([
      { type: 'spring', startDate: '2026-02-23', endDate: '2026-07-05' },
      { type: 'fall', startDate: 'garbage', endDate: 'garbage' },
    ]);
    expect(r).toEqual(getDefaultsFromSemesters([
      { type: 'spring', startDate: '2026-02-23', endDate: '2026-07-05' },
    ]));
    expect(r.startDate.slice(0, 4)).toBe('2026');
  });

  // 上一条的注释说的是「'3000-01-15' 排在 '2026-07-05' 后面」，可它的坏行
  // 两头都是 garbage，光靠 startDate 那一半就筛掉了——注释描述的那种行根本没出现过。
  // 这才是它：startDate 合法、endDate 越界（还原时 semesters 不剔日期，库里确实存得下）。
  // 不筛 endDate 的话它会凭 '3000-01-15' 当上「最新学期」，把真正的 2026 春季挤掉。
  it('endDate 越界的坏行也不能挤掉好行', () => {
    const good = { type: 'spring', startDate: '2026-02-23', endDate: '2026-07-05' };
    const r = getDefaultsFromSemesters([
      good,
      { type: 'fall', startDate: '2026-09-01', endDate: '3000-01-15' },
    ]);
    expect(r).toEqual(getDefaultsFromSemesters([good]));
    expect(r.type).toBe('summer');
    expect(r.startDate.slice(0, 4)).toBe('2026');
  });

  // startDate 那一半同样要筛。手改的备份能塞进 startDate:'2026' 这种行：slice(0,4)
  // 照样得到 2026，slice(5,7) 是空串、parseInt 得 NaN，于是 winter 的「上半年开始就退一年」
  // 判不出来，而 endDate 完好，这行还会被选成 latest——推出来的下一个学期看着完全正常。
  it('startDate 不可用的行不参与推算', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T12:00:00'));
    try {
      const r = getDefaultsFromSemesters([
        { type: 'fall', startDate: '2026', endDate: '2027-01-15' },
      ]);
      // 筛掉后退回按今天猜（9 月 = 秋季），而不是从这行推出「2026寒假」。
      expect(r).toEqual({ name: '2026秋季', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-15' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('最新学期已到 DATE_MAX 附近时，不预填一个零长度学期', () => {
    const r = getDefaultsFromSemesters([
      { type: 'fall', startDate: '2999-09-01', endDate: '3000-01-15' },
    ]);
    expect(isUsableDate(r.startDate)).toBe(true);
    expect(isUsableDate(r.endDate)).toBe(true);
    expect(r.startDate < r.endDate).toBe(true);
  });
});

// 年份夹到上限之后，算出来的区间可能反而落在「最新学期」之前：
// 唯一的学期是 2999 暑假时，fall 的年份被夹到 2998，预填出 2998-09-01 开头的秋季
// ——比它要接的那个学期还早。两者不重叠，所以存得下去，但「下一个学期」排在上一个前面是说不通的。
// 到了范围顶端就是真的没有「下一个学期」可推，别硬凑。
// 两道守卫各挡一种"算得出但不能用"的结果，而原来只有一条用例，任一道守卫单独
// 留着它都能通过——两道都在时当然更绿。所以各给一个只有那一道挡得住的输入。
describe('两道越界守卫各自都要顶用', () => {
  // 年份被 templateYear 夹住 = 范围到头了，真的推不出下一个学期。
  // 少了这道守卫，2999 暑假会推出一个"2998秋季"——排在它前面一年多，
  // 日期合法、也不重叠，一点保存就进库了。
  it('年份被夹住时退回按今天猜，而不是推出一个排在前面的学期', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T12:00:00'));
    try {
      const r = getDefaultsFromSemesters([
        { type: 'summer', startDate: '2999-07-07', endDate: '2999-07-10' },
      ]);
      // 按今天猜（9 月 = 秋季），而不是 2998秋季
      expect(r).toEqual({ name: '2026秋季', type: 'fall', startDate: '2026-09-01', endDate: '2027-01-15' });
    } finally {
      vi.useRealTimers();
    }
  });

  // 顺延后结束日越界 = 顶到 DATE_MAX 了。少了这道守卫，预填的 endDate 会是
  // 3000-02-24，而 handleCreate 紧接着拿用户没打过的这个值报一句「日期无效」。
  it('顺延后结束日越界时退回按今天猜，而不是预填一个存不下的日期', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T12:00:00'));
    try {
      const r = getDefaultsFromSemesters([
        { type: 'spring', startDate: '2999-02-23', endDate: '2999-12-31' },
      ]);
      expect(isUsableDate(r.startDate)).toBe(true);
      expect(isUsableDate(r.endDate)).toBe(true);
      expect(r.endDate.slice(0, 4)).not.toBe('3000');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('推不出下一个学期时不硬凑', () => {
  it('夹完的区间反而早于最新学期时，不拿它当预填', () => {
    const latest = { type: 'summer', startDate: '2999-07-07', endDate: '2999-08-31' };
    const r = getDefaultsFromSemesters([latest]);
    expect(isUsableDate(r.startDate)).toBe(true);
    // 退回中性默认值（同「没有可用学期」那条路），而不是硬凑一个 2998 秋季。
    // 退路本身也在 2999 之前，但它不自称是「你那个学期的下一个」。
    expect(r).toEqual(getDefaultsFromSemesters([]));
    expect(r.name).not.toContain('2998');
  });

  // 还原时 semesters 整行写回，不走 validateCreateSemester，所以库里可能有
  // type 不在四种之内的行。indexOf 给 -1 时别硬推：算出来的是一个同年春季，
  // 比它要接的学期早八个月，而且服务端的重叠检查拦不住。
  it.each(['autumn', '', 'SPRING', null])('type 是 %s 这种认不出的值时，退回按今天猜', (t) => {
    const r = getDefaultsFromSemesters([
      { type: t, startDate: '2026-09-01', endDate: '2027-01-15' },
    ]);
    expect(r).toEqual(getDefaultsFromSemesters([]));
  });

  // 退回只能因为「年份真的被夹了」。拿推出来的 startDate 和用户可编辑的 endDate
  // 比的话，老师把秋季往后延几天（模板是 ~01-15）就会误判，退回按今天猜——
  // 猜出来的正好是一个和他已有秋季几乎重合的秋季，存的时候撞 409，
  // 而他本该得到的寒假反而没了。
  // 这一行就是库里现在的形状（见 CLAUDE.md 的学期约定）：秋季从模板的 01-15 延到了 01-20。
  // 照模板预填出来的寒假从 01-15 开始，和它重叠五天——用户点「新建学期」拿到的是一个
  // 存不下去的表单，保存时 409「该教师已有日期重叠的学期」，而两个日期看着都正常。
  it('老师改过学期结束日时，推下一个学期，开始日顺延到接上它', () => {
    const r = getDefaultsFromSemesters([
      { type: 'fall', startDate: '2026-09-01', endDate: '2027-01-20' },
    ]);
    // 整段后移 5 天，不是把寒假截短 5 天：模板的时长保住。
    expect(r).toEqual({ name: '2026寒假', type: 'winter', startDate: '2027-01-20', endDate: '2027-02-25' });
  });

  // 顶到 DATE_MAX 的那一头：平移会把结束日推出范围，只有这里才退回按今天猜——
  // 猜出来的学期离 2999 上千年，仍然不重叠。
  it('学期结束日贴着上限时，预填既不越界也不重叠', () => {
    const row = { type: 'fall', startDate: '2999-09-01', endDate: '2999-12-31' };
    const r = getDefaultsFromSemesters([row]);
    expect(isUsableDate(r.startDate) && isUsableDate(r.endDate)).toBe(true);
    expect(r.startDate < row.endDate && r.endDate > row.startDate).toBe(false);
  });

  // 上面那条的一般形式：延期是常事，四种学期、延 0~40 天，预填都必须存得下去。
  // 重叠判据抄的是 server/routes/semesters.js 的半开区间，正好首尾相接不算重叠。
  it.each([
    ['spring', '2026-02-23', '2026-07-05'],
    ['summer', '2026-07-07', '2026-08-31'],
    ['fall', '2026-09-01', '2027-01-15'],
    ['winter', '2027-01-15', '2027-02-20'],
  ])('%s 结束日被往后改后，预填出来的学期仍然不与它重叠', (type, startDate, templateEnd) => {
    // 扫到一年以上：延过下一个模板的结束日之后，只挪开始日就会倒挂，必须整段平移。
    for (let d = 0; d <= 400; d++) {
      const endDate = addDays(templateEnd, d);
      const row = { type, startDate, endDate };
      const r = getDefaultsFromSemesters([row]);
      const overlaps = r.startDate < row.endDate && r.endDate > row.startDate;
      expect({ d, overlaps, start: r.startDate }).toEqual({ d, overlaps: false, start: r.startDate });
      expect(r.startDate < r.endDate).toBe(true);
    }
  });

  // 上面那条只改「往后延」。往前提是另一个方向，坏得更彻底：模板年份原本
  // 从 endDate 减一年推，而秋季提前到同年 12-31 结束之后，减出来的是 2025，
  // 预填的「下一个学期」于是整整早了八个月，还合法得能一键存进去。
  it('秋季提前到同年内结束时，下一个学期仍排在它后面', () => {
    const latest = { type: 'fall', startDate: '2026-09-01', endDate: '2026-12-31' };
    const r = getDefaultsFromSemesters([latest]);
    expect(r.type).toBe('winter');
    expect(r.name).toBe('2026寒假');
    // 关键的一条：预填的区间必须在它要接的那个学期之后。
    expect(r.startDate >= latest.endDate).toBe(true);
  });

  // 上面两条只盯 fall。寒假走的是另一条路（模板开始日在 y+1，所以要减一年），
  // 而寒假到底从哪个月开始，老师说了算：模板是 01-15，但排成 12-20 开始、
  // 或者跟着春节排到 2 月（春节在 2 月的年份不少）都很常见。
  //
  // 这里必须钉「具体预填值」，不能只断言「排在它后面」：
  // 阈值写成 startMonth <= 1 的话，2 月开学的寒假会预填出晚整整一年的 2028 春季，
  // 而 2028-02-23 >= 2027-02-20 照样成立——「晚一年」这种错法对区间断言是隐形的。
  //
  // 3~11 月开始的寒假是胡填的数据（该改类型而不是改日期），故意不钉。
  it.each([
    ['年底开始的寒假', { type: 'winter', startDate: '2026-12-20', endDate: '2027-02-20' }],
    ['跨年夜开始的寒假', { type: 'winter', startDate: '2026-12-31', endDate: '2027-02-10' }],
    ['模板形状的寒假（1 月）', { type: 'winter', startDate: '2027-01-15', endDate: '2027-02-20' }],
    ['跟着春节排到 2 月的寒假', { type: 'winter', startDate: '2027-02-06', endDate: '2027-02-20' }],
  ])('%s：下一个学期就是 2027 春季', (_label, latest) => {
    const r = getDefaultsFromSemesters([latest]);
    expect(r).toEqual({ name: '2027春季', type: 'spring', startDate: '2027-02-23', endDate: '2027-07-05' });
    expect(r.startDate >= latest.endDate).toBe(true);
  });

  // 2999 年的秋季只能在同年内结束（2999-12-31），走的正是上面那条路。
  // 年份夹不住的那一档要退回按今天猜，而不是凑一个排在前面的学期。
  it('2999 秋季同年结束时退回按今天猜，而不是凑一个更早的学期', () => {
    const r = getDefaultsFromSemesters([
      { type: 'fall', startDate: '2999-09-01', endDate: '2999-12-31' },
    ]);
    expect(r).toEqual(getDefaultsFromSemesters([]));
  });

  // 相邻学期共用边界日（秋季 ~01-15 接寒假 01-15~）是正常的，不能误伤。
  it('相邻学期共用边界日时照常推算', () => {
    const r = getDefaultsFromSemesters([
      { type: 'fall', startDate: '2026-09-01', endDate: '2027-01-15' },
    ]);
    expect(r.type).toBe('winter');
    expect(r.startDate).toBe('2027-01-15');
  });
});
