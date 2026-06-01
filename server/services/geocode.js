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
    const amapErrors = { INVALID_USER_IP: '地理编码服务配置错误，请联系管理员', INVALID_USER_KEY: '地理编码服务配置错误，请联系管理员', '10003': '地理编码服务配置错误，请联系管理员' };
    return { lat: null, lng: null, error: amapErrors[data.infocode] || '未找到该地点的经纬度' };
  }
  const [lng, lat] = data.geocodes[0].location.split(',').map(Number);
  return { lat, lng };
}
