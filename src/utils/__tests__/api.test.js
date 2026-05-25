import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { getToken, setToken, clearToken, api } from '../../api';

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

    await expect(api.getClasses()).rejects.toThrow('参数错误');
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
});
