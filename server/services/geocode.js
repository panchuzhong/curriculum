const ONLINE_KEYWORDS = ['线上', '网课', '在线', 'online'];

export async function geocodeAddress(address) {
  if (ONLINE_KEYWORDS.some(k => address.toLowerCase().includes(k))) return null;
  const key = process.env.AMAP_KEY;
  if (!key) throw new Error('AMAP_KEY not configured');
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${key}&address=${encodeURIComponent(address)}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.status !== '1' || !data.geocodes?.length) return null;
  const [lng, lat] = data.geocodes[0].location.split(',').map(Number);
  return { lat, lng };
}
