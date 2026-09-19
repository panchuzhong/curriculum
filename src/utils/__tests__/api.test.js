import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set up mocks using vi.hoisted so they run before module evaluation
const { store, localStorageMock, fetchMock } = vi.hoisted(() => {
  const store = {};
  const localStorageMock = {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = val; }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: vi.fn(() => Object.keys(store).forEach(k => delete store[k])),
  };
  const fetchMock = vi.fn();
  return { store, localStorageMock, fetchMock };
});

vi.stubGlobal('localStorage', localStorageMock);
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('window', { location: { href: '' } });

// Static import — globals are already stubbed via vi.hoisted
import { getToken, setToken, clearToken, api, loginUrl } from '../../api';

describe('loginUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('BASE_URL 无尾斜杠时补斜杠（子路径部署退出登录不应 404）', () => {
    vi.stubEnv('BASE_URL', '/curriculum');
    expect(loginUrl()).toBe('/curriculum/login');
  });

  it('BASE_URL 有尾斜杠时不重复拼接', () => {
    vi.stubEnv('BASE_URL', '/curriculum/');
    expect(loginUrl()).toBe('/curriculum/login');
  });

  it('根路径 BASE_URL', () => {
    vi.stubEnv('BASE_URL', '/');
    expect(loginUrl()).toBe('/login');
  });
});

describe('token management', () => {
  beforeEach(() => localStorageMock.clear());

  it('getToken returns null when no token', () => {
    expect(getToken()).toBeNull();
  });

  it('setToken stores token in localStorage', () => {
    setToken('abc');
    expect(getToken()).toBe('abc');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('token', 'abc');
  });

  it('clearToken removes token', () => {
    setToken('abc');
    clearToken();
    expect(getToken()).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('token');
  });
});

describe('request function', () => {
  beforeEach(() => {
    localStorageMock.clear();
    fetchMock.mockReset();
  });

  it('sends Authorization header when token is set', async () => {
    setToken('test-jwt');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 1 }),
    });

    await api.getProfile();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/profile',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-jwt' }),
      })
    );
  });

  it('does not send Authorization for noAuth requests', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: 'new' }),
    });

    await api.login({ username: 'u', password: 'p' });

    const callOpts = fetchMock.mock.calls[0][1];
    expect(callOpts.headers).not.toHaveProperty('Authorization');
  });

  it('throws on non-401 error with parsed message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: '参数错误' }),
    });

    // 必须比整条消息：toThrow 是子串匹配，而未经解包的响应体本身
    // （'{"error":"参数错误"}'）就含有「参数错误」——不取 error 字段照样能过，
    // 可这一步正是本用例唯一要盯的东西。request() 是全站错误消息的唯一出口，
    // 它一坏，每个守卫的提示都会变成一坨 JSON 原文弹在用户脸上。
    const err = await api.getClasses().then(() => null, e => e);
    expect(err.message).toBe('参数错误');
  });

  // 服务端在跨学期时回 400 {error, crossSemester:true}，而 BatchScheduleDialog 分支
  // 看的是 err.crossSemester —— request() 不把它从响应体挪到 error 上的话，
  // 用户拿到的就是一句死路 400：「确认跨学期排课」那个出口根本不会出现。
  it('把响应体里的 crossSemester 挂到抛出的错误上', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: '日期跨学期边界', crossSemester: true }),
    });

    const err = await api.getClasses().then(() => null, e => e);
    expect(err.message).toBe('日期跨学期边界');
    expect(err.crossSemester).toBe(true);
  });

  it('普通错误不会平白多出 crossSemester', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 400, text: async () => JSON.stringify({ error: '别的错误' }),
    });
    const err = await api.getClasses().then(() => null, e => e);
    expect(err.crossSemester).toBeUndefined();
  });

  it('throws on non-401 error with raw text if no JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(api.getClasses()).rejects.toThrow('Internal Server Error');
  });

  it('clears token and throws on 401', async () => {
    setToken('expired-jwt');

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: '未授权' }),
    });

    await expect(api.getClasses()).rejects.toThrow('登录已过期,请重新登录');
    expect(getToken()).toBeNull();
  });

  it('parses JSON response', async () => {
    const data = [{ id: 1, name: 'class1' }];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(data),
    });

    const result = await api.getClasses();
    expect(result).toEqual(data);
  });

  it('returns raw text if not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'ok',
    });

    const result = await api.deleteClass(1);
    expect(result).toBe('ok');
  });

  it('sends JSON body for POST requests', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 1 }),
    });

    await api.createClass({ name: 'test' });

    const callOpts = fetchMock.mock.calls[0][1];
    expect(callOpts.method).toBe('POST');
    expect(callOpts.body).toBe(JSON.stringify({ name: 'test' }));
    expect(callOpts.headers['Content-Type']).toBe('application/json');
  });

  it('constructs correct URL with classId for getSchedules', async () => {
    setToken('t');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '[]',
    });

    await api.getSchedules('2026-01-01', '2026-01-31', 5);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/schedules?start=2026-01-01&end=2026-01-31&classId=5',
      expect.anything()
    );
  });

  // 缓存键必须带上 classId。ScheduleHistory 打开每个班的排课历史用的都是
  // (DATE_MIN, DATE_MAX, classId)——start/end 一模一样，只有班级不同。键里漏掉
  // classId 的话，TTL 之内点开 B 班会把 A 班的课原样当成 B 班的列出来，
  // 连「共 N 节 · Xh」都是 A 班的数，页面上没有任何出错的迹象。
  it('同一区间的不同班级不共用缓存', async () => {
    setToken('t');
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '[]' });

    await api.getSchedules('2026-01-01', '2026-01-31', 1);
    await api.getSchedules('2026-01-01', '2026-01-31', 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 对照：同一个班再取一次才该命中缓存，否则上面那个 2 只是「缓存根本没生效」。
    await api.getSchedules('2026-01-01', '2026-01-31', 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
