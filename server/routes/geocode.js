import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { geocodeAddress } from '../services/geocode.js';

const router = Router();
router.use(authMiddleware);

router.get('/status', (req, res) => {
  res.json({ available: !!process.env.AMAP_KEY });
});

router.get('/', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });

  try {
    const result = await geocodeAddress(address);
    if (!result) return res.json({ lat: null, lng: null });
    res.json(result);
  } catch {
    res.status(502).json({ error: 'Geocoding service unavailable' });
  }
});

export default router;
