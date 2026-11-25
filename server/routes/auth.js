import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import rateLimit from 'express-rate-limit';
import { db, drizzleDb } from '../db/index.js';
import { teachers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { signToken, authMiddleware } from '../middleware/auth.js';
import { seedPricingTiers } from '../db/seed.js';
import { logAudit } from '../services/audit.js';
import { hashApiKey, maskApiKey } from '../services/api-keys.js';
import handle from '../validations/handle.js';
import { validateRegister, validateLogin, validateChangePassword, validateUpdateSubjects } from '../validations/auth.js';

const router = Router();
// Same bcrypt cost as registration, used only for comparisons with absent accounts.
const DUMMY_PASSWORD_HASH = '$2b$12$BtqG34MhcBzpTVVIgRns0uK/aprh.mEFIKktX8DGX1w2.k5e9HXaW';

export const DEFAULT_SUBJECTS = ['数学', '物理', '化学', '英语', '语文', '生物', '历史', '地理', '政治'];

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  message: { error: '登录尝试过多，请15分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', authLimiter, validateRegister, handle, async (req, res) => {
  if (process.env.ALLOW_REGISTRATION !== 'true') {
    return res.status(403).json({ error: 'Registration is closed' });
  }
  const { username, password, name } = req.body;
  const existing = drizzleDb.select().from(teachers).where(eq(teachers.username, username)).get();
  if (existing) return res.status(409).json({ error: 'Username taken' });

  const passwordHash = await bcrypt.hash(password, 12);
  // Hashing yields. Claim the first account and seed its pricing under one write lock.
  const apiKey = randomUUID();
  const subjects = JSON.stringify(DEFAULT_SUBJECTS);
  const teacherId = db.transaction(() => {
    if (process.env.ALLOW_REGISTRATION !== 'true'
      || drizzleDb.select({ id: teachers.id }).from(teachers).limit(1).get()) return null;
    const result = drizzleDb.insert(teachers).values({ username, passwordHash, name,
      apiKeyHash: hashApiKey(apiKey), apiKeyHint: maskApiKey(apiKey), subjects }).run();
    const id = Number(result.lastInsertRowid);
    seedPricingTiers(id);
    return id;
  }).immediate();
  if (teacherId === null) return res.status(403).json({ error: 'Registration is closed' });
  process.env.ALLOW_REGISTRATION = 'false';

  // Persist the closure to .env so it survives restart. dotenv reads .env from
  // the working directory, so write the same file; tests must not touch it.
  if (process.env.NODE_ENV !== 'test') try {
    const envPath = resolve(process.cwd(), '.env');
    let envContent = readFileSync(envPath, 'utf-8');
    if (envContent.includes('ALLOW_REGISTRATION=')) {
      envContent = envContent.replace(/^ALLOW_REGISTRATION=.*/m, 'ALLOW_REGISTRATION=false');
    } else {
      envContent += '\nALLOW_REGISTRATION=false\n';
    }
    writeFileSync(envPath, envContent);
  } catch { /* non-fatal: .env may not exist or be writable */ }

  res.json({ token: signToken(teacherId, 0), apiKey });
});

router.post('/login', loginLimiter, validateLogin, handle, async (req, res) => {
  const { username, password } = req.body;
  const teacher = drizzleDb.select().from(teachers).where(eq(teachers.username, username)).get();
  const matches = await bcrypt.compare(password, teacher?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!teacher || !matches) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: signToken(teacher.id, teacher.pwdVersion ?? 0) });
});

router.get('/profile', authMiddleware, (req, res) => {
  const teacher = drizzleDb.select().from(teachers).where(eq(teachers.id, req.teacherId)).get();
  if (!teacher) return res.status(404).json({ error: 'Not found' });
  let subjects = DEFAULT_SUBJECTS;
  if (teacher.subjects) { try { subjects = JSON.parse(teacher.subjects); } catch { subjects = DEFAULT_SUBJECTS; } }
  const apiKey = teacher.apiKeyHint || maskApiKey(teacher.apiKey);
  res.json({ id: teacher.id, username: teacher.username, name: teacher.name, apiKey, subjects });
});

// Mounted before the global /api write limiter, so this subtree needs its own.
router.put('/subjects', authMiddleware, authLimiter, validateUpdateSubjects, handle, (req, res) => {
  const { subjects } = req.body;
  drizzleDb.update(teachers).set({ subjects: JSON.stringify(subjects) }).where(eq(teachers.id, req.teacherId)).run();
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'teachers', recordId: req.teacherId, after: { subjects } });
  res.json({ subjects });
});

router.put('/api-key', authMiddleware, authLimiter, (req, res) => {
  const newKey = randomUUID();
  drizzleDb.update(teachers).set({ apiKey: null, apiKeyHash: hashApiKey(newKey), apiKeyHint: maskApiKey(newKey) })
    .where(eq(teachers.id, req.teacherId)).run();
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'teachers', recordId: req.teacherId, after: { apiKeyRotated: true } });
  res.json({ apiKey: newKey });
});

router.put('/password', authMiddleware, authLimiter, validateChangePassword, handle, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const teacher = drizzleDb.select().from(teachers).where(eq(teachers.id, req.teacherId)).get();
  if (!teacher || !(await bcrypt.compare(oldPassword, teacher.passwordHash))) {
    // 401 makes the client drop its token and redirect to login; this is a
    // form error the user must see.
    return res.status(400).json({ error: '当前密码错误' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const newPwdVersion = (teacher.pwdVersion ?? 0) + 1;
  // Hashing yields to other requests. Only replace the credentials we actually
  // verified; otherwise concurrent changes can share a revocation version.
  const result = drizzleDb.update(teachers).set({ passwordHash, pwdVersion: newPwdVersion })
    .where(and(eq(teachers.id, req.teacherId), eq(teachers.passwordHash, teacher.passwordHash), eq(teachers.pwdVersion, teacher.pwdVersion))).run();
  if (result.changes === 0) return res.status(409).json({ error: '密码已被修改，请使用当前密码重试' });
  logAudit({ teacherId: req.teacherId, action: 'UPDATE', tableName: 'teachers', recordId: req.teacherId, after: { passwordChanged: true } });
  // Return a fresh token so the current session survives revoking old ones
  res.json({ ok: true, token: signToken(req.teacherId, newPwdVersion) });
});

export default router;
