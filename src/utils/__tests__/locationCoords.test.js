import { describe, it, expect } from 'vitest';
import { staleCoordNames, withCoordSources, dropOrphanedCoords } from '../locationCoords';

// 经纬度各自记着「按哪个地点名填的」（defaultLocationLatFor/LngFor）。地点改了而某个
// 坐标还是旧地点的，就提示；不知道来源（旧数据、先填坐标后填地点）的那一项不提示。
const form = (over = {}) => ({
  defaultLocationName: '上海',
  defaultLocationLat: '31.2', defaultLocationLng: '121.4',
  defaultLocationLatFor: '上海', defaultLocationLngFor: '上海',
  ...over,
});

describe('staleCoordNames', () => {
  it('坐标和地点一致时不提示', () => {
    expect(staleCoordNames(form())).toEqual([]);
  });

  it('改了地点、坐标还是旧地点的 → 提示旧地点名', () => {
    expect(staleCoordNames(form({ defaultLocationName: '北京' }))).toEqual(['上海']);
  });

  it('只改了纬度：经度仍是旧地点的，提示不能消（#1 的核心）', () => {
    expect(staleCoordNames(form({ defaultLocationName: '北京', defaultLocationLatFor: '北京' }))).toEqual(['上海']);
  });

  it('两个坐标都手改过 → 都锚到当前地点，不提示', () => {
    expect(staleCoordNames(form({ defaultLocationName: '北京', defaultLocationLatFor: '北京', defaultLocationLngFor: '北京' }))).toEqual([]);
  });

  it('旧数据没有来源（null/空）→ 不提示', () => {
    expect(staleCoordNames(form({ defaultLocationLatFor: null, defaultLocationLngFor: null }))).toEqual([]);
    expect(staleCoordNames(form({ defaultLocationLatFor: '', defaultLocationLngFor: '' }))).toEqual([]);
  });

  it('某一项坐标为空时只看另一项', () => {
    expect(staleCoordNames(form({ defaultLocationName: '北京', defaultLocationLat: '' }))).toEqual(['上海']);
    expect(staleCoordNames(form({ defaultLocationName: '北京', defaultLocationLat: '', defaultLocationLng: '' }))).toEqual([]);
  });

  it('两项来源不同且都过期 → 都列出来', () => {
    expect(staleCoordNames(form({ defaultLocationName: '广州', defaultLocationLatFor: '北京', defaultLocationLngFor: '上海' }))).toEqual(['北京', '上海']);
  });

  it('比较前去掉首尾空白', () => {
    expect(staleCoordNames(form({ defaultLocationName: ' 北京 ', defaultLocationLatFor: ' 上海 ', defaultLocationLngFor: '上海' }))).toEqual(['上海']);
  });

  it('一项来源未知、另一项过期 → 只提示已知的那项', () => {
    expect(staleCoordNames(form({ defaultLocationName: '北京', defaultLocationLatFor: '', defaultLocationLngFor: '上海' }))).toEqual(['上海']);
  });
});

// 库里没记来源（NULL）的：加列之前的行、旧备份、没带来源的 API 写入。按载入时的地点名算，
// 改地点才会提示——当成「来源未知、不提示」的话，这些班改地点时坐标既不清也不提示。
describe('withCoordSources', () => {
  const legacy = { defaultLocationName: '上海', defaultLocationLat: 31.2, defaultLocationLng: 121.4, defaultLocationLatFor: null, defaultLocationLngFor: null };

  it('NULL 来源按载入时的地点名补上，改地点后提示', () => {
    const loaded = withCoordSources(legacy);
    expect(loaded).toMatchObject({ defaultLocationLatFor: '上海', defaultLocationLngFor: '上海' });
    expect(staleCoordNames(loaded)).toEqual([]);
    expect(staleCoordNames({ ...loaded, defaultLocationName: '北京' })).toEqual(['上海']);
  });

  it('接口没返回这两列（undefined）同样补', () => {
    const { defaultLocationLatFor, defaultLocationLngFor, ...old } = legacy;
    expect(withCoordSources(old)).toMatchObject({ defaultLocationLatFor: '上海', defaultLocationLngFor: '上海' });
  });

  it('已记的来源、空字符串（先填坐标后填地点）、没有坐标的都不动', () => {
    expect(withCoordSources({ ...legacy, defaultLocationLatFor: '北京' }).defaultLocationLatFor).toBe('北京');
    expect(withCoordSources({ ...legacy, defaultLocationLatFor: '' }).defaultLocationLatFor).toBe('');
    expect(withCoordSources({ ...legacy, defaultLocationLat: null }).defaultLocationLatFor).toBeNull();
    expect(withCoordSources({ ...legacy, defaultLocationLng: '' }).defaultLocationLngFor).toBeNull();
  });

  it('不改传进来的对象', () => {
    withCoordSources(legacy);
    expect(legacy.defaultLocationLatFor).toBeNull();
  });
});

// 地点名清空了，按原地点填的坐标没有归属，提交时跟着清掉；没有来源的（没地点名时手填的）照存。
describe('dropOrphanedCoords', () => {
  it('地点清空：按旧地点填的坐标和来源一起清掉', () => {
    expect(dropOrphanedCoords(form({ defaultLocationName: '  ' }))).toMatchObject({
      defaultLocationLat: '', defaultLocationLng: '', defaultLocationLatFor: '', defaultLocationLngFor: '',
    });
  });

  it('地点清空但坐标没有来源（手填的）：照存', () => {
    const f = form({ defaultLocationName: '', defaultLocationLatFor: '', defaultLocationLngFor: '' });
    expect(dropOrphanedCoords(f)).toEqual(f);
  });

  it('只清有来源的那一项', () => {
    expect(dropOrphanedCoords(form({ defaultLocationName: '', defaultLocationLngFor: '' }))).toMatchObject({
      defaultLocationLat: '', defaultLocationLatFor: '', defaultLocationLng: '121.4', defaultLocationLngFor: '',
    });
  });

  it('有地点名时原样返回（改地点只提示，不清）', () => {
    const f = form({ defaultLocationName: '北京' });
    expect(dropOrphanedCoords(f)).toBe(f);
  });
});
