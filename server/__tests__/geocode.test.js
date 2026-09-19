import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocodeAddress } from '../services/geocode.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AMAP_KEY;
});

describe('geocodeAddress', () => {
  it('short-circuits online locations without calling the provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(geocodeAddress('线上课程')).resolves.toEqual({ lat: null, lng: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 短路的四个关键词一个都不能少，大小写也得兜住：漏掉任何一个，一节「Online 课」
  // 就会真的打一次高德接口——那是要计费的，而这类地址本来就没有经纬度可查。
  // 原来只试了「线上课程」，'online' 和 toLowerCase() 两段删掉都不会红。
  it.each([
    ['线上', '线上课程'],
    ['网课', '周三网课'],
    ['在线', '在线一对一'],
    ['online 小写', 'online lesson'],
    ['Online 首字母大写', 'Online lesson'],
    ['ONLINE 全大写', 'ONLINE LESSON'],
  ])('%s 不请求上游', async (_label, address) => {
    process.env.AMAP_KEY = 'test-key';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(geocodeAddress(address)).resolves.toEqual({ lat: null, lng: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a bounded request and parses valid coordinates', async () => {
    process.env.AMAP_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: '1', geocodes: [{ location: '121.4,31.2' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(geocodeAddress('图书馆')).resolves.toEqual({ lat: 31.2, lng: 121.4 });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects provider HTTP failures', async () => {
    process.env.AMAP_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(geocodeAddress('图书馆')).rejects.toThrow('503');
  });

  // 数值合法但超出经纬度范围时同样不能采信：'bad,data' 那条只覆盖了 NaN，
  // 而 999 这种会被 Number 正常解析出来，采信了就把班级钉在地图上一个不存在的点。
  it.each([
    ['纬度超上限', '121.4,999'],
    ['纬度超下限', '121.4,-999'],
    ['经度超上限', '999,31.2'],
    ['经度超下限', '-999,31.2'],
  ])('%s 时不返回坐标', async (_label, location) => {
    process.env.AMAP_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: '1', geocodes: [{ location }] }),
    }));

    await expect(geocodeAddress('图书馆')).resolves.toEqual({
      lat: null, lng: null, error: '地理编码服务返回了无效坐标',
    });
  });

  // agent-help 写明：查不到时仍然是 200，返回 {lat:null, lng:null, error}。
  // 调用方按这个分支写代码——回成 4xx/5xx 的话，一个"这个地名查不到"会被当成
  // "服务坏了"，而地址本身没问题只是搜不到，这两种情况要处理得不一样。
  it.each([
    ['地址无法识别', { status: '0', info: 'ENGINE_RESPONSE_DATA_ERROR' }, '地址无法识别'],
    ['没有结果', { status: '1', geocodes: [] }, '未找到该地点的经纬度'],
    ['key 配置错误', { status: '0', infocode: 'INVALID_USER_KEY' }, '服务配置错误'],
  ])('%s 时仍返回 200 和一句说明，而不是抛错', async (_label, payload, expectedFragment) => {
    process.env.AMAP_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));

    const r = await geocodeAddress('查不到的地方');
    expect(r.lat).toBeNull();
    expect(r.lng).toBeNull();
    expect(r.error).toContain(expectedFragment);
  });

  it('does not return malformed provider coordinates', async () => {
    process.env.AMAP_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: '1', geocodes: [{ location: 'bad,data' }] }),
    }));
    await expect(geocodeAddress('图书馆')).resolves.toMatchObject({ lat: null, lng: null });
  });
});
