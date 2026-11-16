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

// 另一个标签页换账号登录时，本标签页的 setToken/clearToken 都不会跑（storage
// 事件只在别的文档里触发）。课表缓存的键只有 start/end/classId，不随 storage
// 清掉的话，B 的页面会在 TTL 内直接渲染 A 的课，连请求都不发。
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
});
