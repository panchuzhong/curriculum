import { describe, it, expect, vi, beforeEach } from 'vitest';

// 与 api.test.js 分开：那个文件顶部静态 import 了 api.js，模块可能在 stubGlobal
// 之前求值，storage 监听就挂不到这里的 window 上。本文件全程动态 import。
const { store, localStorageMock, fetchMock } = vi.hoisted(() => {
  const store = {};
  return {
    store,
    localStorageMock: {
      getItem: vi.fn(k => store[k] ?? null),
      setItem: vi.fn((k, v) => { store[k] = v; }),
      removeItem: vi.fn(k => { delete store[k]; }),
    },
    fetchMock: vi.fn(),
  };
});
vi.stubGlobal('localStorage', localStorageMock);
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { href: '' } }));

// storage events arrive after localStorage already contains the other tab's token.
describe('跨标签页换账号时课表缓存作废', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  async function freshApi() {
    const { api, setToken, clearToken } = await import('../../api.js');
    clearToken();
    return { api, setToken };
  }

  it('storage(token) 之后同一区间重新发请求，而不是复用旧账号的缓存', async () => {
    const { api, setToken } = await freshApi();
    setToken('account-a');
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '[]' });
    await api.getSchedules('2026-01-01', '2026-01-31');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 另一标签页登录 B：localStorage 已被改写，本页只收到 storage 事件。
    store.token = 'account-b';
    const e = new Event('storage');
    e.key = 'token';
    window.dispatchEvent(e);

    await api.getSchedules('2026-01-01', '2026-01-31');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('非 token 的 storage 变化不清缓存', async () => {
    const { api, setToken } = await freshApi();
    setToken('account-a');
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '[]' });
    await api.getSchedules('2026-01-01', '2026-01-31');
    const e = new Event('storage');
    e.key = 'theme';
    window.dispatchEvent(e);
    await api.getSchedules('2026-01-01', '2026-01-31');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not share cached rows while another tab’s storage event is still pending', async () => {
    const { api, setToken } = await freshApi();
    setToken('account-a');
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '[{"owner":"A"}]' });
    await api.getSchedules('2026-01-01', '2026-01-31');
    store.token = 'account-b';
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '[{"owner":"B"}]' });
    expect(await api.getSchedules('2026-01-01', '2026-01-31')).toEqual([{ owner: 'B' }]);
  });
});

describe('late authentication failures', () => {
  it.each(['json', 'blob'])('a stale %s request cannot log out a newer session', async kind => {
    const { api, setToken, getToken } = await import('../../api.js');
    fetchMock.mockReset();
    window.location.href = '';
    setToken('old-token');
    let resolve;
    fetchMock.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = kind === 'json' ? api.getProfile() : api.exportYearlyImage(2026);
    setToken('new-token');
    resolve({ status: 401, ok: false, text: async () => '{}' });
    await expect(pending).rejects.toThrow();
    expect(getToken()).toBe('new-token');
    expect(window.location.href).toBe('');
  });
});

it.each(['logout', 'switch', 'unchanged'])('installs a password response only in the originating session (%s)', async action => {
  const { api, setToken, getToken, clearToken } = await import('../../api.js');
  setToken('first');
  let finish;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = api.changePassword({ oldPassword: 'old', newPassword: 'new-password' });
  if (action === 'logout') clearToken();
  if (action === 'switch') setToken('second');
  finish({ ok: true, status: 200, text: async () => '{"token":"renewed"}' });
  await pending;
  expect(getToken()).toBe({ logout: null, switch: 'second', unchanged: 'renewed' }[action]);
});

it.each([true, false])('an expired request cannot replace or evict a newer result (success=%s)', async success => {
  const { api, setToken } = await import('../../api.js');
  setToken('first');
  fetchMock.mockReset();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    let finish;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const read = () => api.getSchedules('2026-02-01', '2026-02-28');
    const pending = read();
    clock.mockReturnValue(62_000);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '[2]' });
    expect(await read()).toEqual([2]);
    finish({ ok: success, status: success ? 200 : 500, text: async () => '[1]' });
    if (success) expect(await pending).toEqual([1]);
    else await expect(pending).rejects.toThrow();
    expect(await read()).toEqual([2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally { clock.mockRestore(); }
});
