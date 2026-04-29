import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { drizzleDb } from '../db/index.js';
import { teachers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { signToken, authMiddleware } from '../middleware/auth.js';
import { seedPricingTiers } from '../db/seed.js';

const router = Router();

router.post('/register', (req, res) => {
  if (process.env.ALLOW_REGISTRATION !== 'true') {
    return res.status(403).json({ error: 'Registration is closed' });
  }
  const { username, password, name } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const existing = drizzleDb.select().from(teachers).where(eq(teachers.username, username)).get();
  if (existing) return res.status(409).json({ error: 'Username taken' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const apiKey = uuidv4();
  const result = drizzleDb.insert(teachers).values({ username, passwordHash, name, apiKey }).run();
  seedPricingTiers(result.lastInsertRowid);

  // Auto-close registration after first user
  process.env.ALLOW_REGISTRATION = 'false';

  res.json({ token: signToken(result.lastInsertRowid), apiKey });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const teacher = drizzleDb.select().from(teachers).where(eq(teachers.username, username)).get();
  if (!teacher || !bcrypt.compareSync(password, teacher.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: signToken(teacher.id) });
});

router.get('/profile', authMiddleware, (req, res) => {
  const teacher = drizzleDb.select().from(teachers).where(eq(teachers.id, req.teacherId)).get();
  if (!teacher) return res.status(404).json({ error: 'Not found' });
  res.json({ id: teacher.id, username: teacher.username, name: teacher.name, apiKey: teacher.apiKey });
});

router.put('/api-key', authMiddleware, (req, res) => {
  const newKey = uuidv4();
  drizzleDb.update(teachers).set({ apiKey: newKey }).where(eq(teachers.id, req.teacherId)).run();
  res.json({ apiKey: newKey });
});

export default router;
