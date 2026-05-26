const ONLINE_KEYWORDS = ['线上', '网课', '在线', 'online'];

export async function geocodeAddress(address) {
  if (ONLINE_KEYWORDS.some(k => address.toLowerCase().includes(k))) return { lat: null, lng: null };
  const key = process.env.AMAP_KEY;
  if (!key) throw new Error('AMAP_KEY not configured');
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${key}&address=${encodeURIComponent(address)}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status !== '1' || !data.geocodes?.length) {
    if (data.info?.includes('ENGINE_RESPONSE')) return { lat: null, lng: null, error: '未找到该地点的经纬度（地址无法识别，请尝试更详细的地名）' };
    const amapErrors = { INVALID_USER_IP: 'API Key IP白名单限制，请在高德控制台添加服务器IP或关闭IP白名单', INVALID_USER_KEY: 'API Key无效', '10003': 'API Key无效或已过期' };
    return { lat: null, lng: null, error: amapErrors[data.infocode] || data.info || '未找到该地点的经纬度' };
  }
  const [lng, lat] = data.geocodes[0].location.split(',').map(Number);
  return { lat, lng };
}
