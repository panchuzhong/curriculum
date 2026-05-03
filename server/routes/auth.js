import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { drizzleDb } from '../db/index.js';
import { teachers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { signToken, authMiddleware } from '../middleware/auth.js';
import { seedPricingTiers } from '../db/seed.js';
import handle from '../validations/handle.js';
import { validateRegister, validateLogin, validateChangePassword, validateUpdateSubjects } from '../validations/auth.js';

const router = Router();

const DEFAULT_SUBJECTS = ['数学', '物理', '化学', '英语', '语文', '生物', '历史', '地理', '政治'];

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', authLimiter, validateRegister, handle, (req, res) => {
  if (process.env.ALLOW_REGISTRATION !== 'true') {
    return res.status(403).json({ error: 'Registration is closed' });
  }
  const { username, password, name } = req.body;
  const existing = drizzleDb.select().from(teachers).where(eq(teachers.username, username)).get();
  if (existing) return res.status(409).json({ error: 'Username taken' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const apiKey = uuidv4();
  const subjects = JSON.stringify(DEFAULT_SUBJECTS);
  const result = drizzleDb.insert(teachers).values({ username, passwordHash, name, apiKey, subjects }).run();
  seedPricingTiers(result.lastInsertRowid);

  // Auto-close registration after first user
  process.env.ALLOW_REGISTRATION = 'false';

  res.json({ token: signToken(result.lastInsertRowid), apiKey });
});

router.post('/login', authLimiter, validateLogin, handle, (req, res) => {
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
  const subjects = teacher.subjects ? JSON.parse(teacher.subjects) : DEFAULT_SUBJECTS;
  res.json({ id: teacher.id, username: teacher.username, name: teacher.name, apiKey: teacher.apiKey, subjects });
});

router.put('/subjects', authMiddleware, validateUpdateSubjects, handle, (req, res) => {
  const { subjects } = req.body;
  drizzleDb.update(teachers).set({ subjects: JSON.stringify(subjects) }).where(eq(teachers.id, req.teacherId)).run();
  res.json({ subjects });
});

router.put('/api-key', authMiddleware, (req, res) => {
  const newKey = uuidv4();
  drizzleDb.update(teachers).set({ apiKey: newKey }).where(eq(teachers.id, req.teacherId)).run();
  res.json({ apiKey: newKey });
});

router.put('/password', authMiddleware, validateChangePassword, handle, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const teacher = drizzleDb.select().from(teachers).where(eq(teachers.id, req.teacherId)).get();
  if (!teacher || !bcrypt.compareSync(oldPassword, teacher.passwordHash)) {
    return res.status(401).json({ error: '当前密码错误' });
  }
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  drizzleDb.update(teachers).set({ passwordHash }).where(eq(teachers.id, req.teacherId)).run();
  res.json({ ok: true });
});

export default router;
