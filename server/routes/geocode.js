import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });

  const key = process.env.AMAP_KEY;
  if (!key) return res.status(500).json({ error: 'AMAP_KEY not configured' });

  try {
    const url = `https://restapi.amap.com/v3/geocode/geo?key=${key}&address=${encodeURIComponent(address)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status !== '1' || !data.geocodes?.length) {
      return res.json({ lat: null, lng: null });
    }
    const [lng, lat] = data.geocodes[0].location.split(',').map(Number);
    res.json({ lat, lng });
  } catch {
    res.status(502).json({ error: 'Geocoding service unavailable' });
  }
});

export default router;
