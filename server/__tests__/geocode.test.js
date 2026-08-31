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

  it('does not return malformed provider coordinates', async () => {
    process.env.AMAP_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: '1', geocodes: [{ location: 'bad,data' }] }),
    }));
    await expect(geocodeAddress('图书馆')).resolves.toMatchObject({ lat: null, lng: null });
  });
});
