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
  if (!address || typeof address !== 'string') return res.status(400).json({ error: 'address required' });
  if (address.length > 200) return res.status(400).json({ error: 'address too long' });

  try {
    const result = await geocodeAddress(address);
    res.json(result);
  } catch {
    res.status(502).json({ error: 'Geocoding service unavailable' });
  }
});

export default router;
