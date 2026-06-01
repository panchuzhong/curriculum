import jwt from 'jsonwebtoken';
import { drizzleDb } from '../db/index.js';
import { teachers } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}
const INSECURE_SECRETS = ['change-me', 'change-me-to-a-random-string', 'change-me-in-production', 'secret', 'your-secret-key'];
if (INSECURE_SECRETS.includes(JWT_SECRET)) {
  console.error('FATAL: JWT_SECRET is set to a known insecure default. Please set a strong random secret.');
  process.exit(1);
}
if (JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 characters long');
  process.exit(1);
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function authMiddleware(req, res, next) {
  // Try API key first
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    const teacher = drizzleDb.select().from(teachers).where(eq(teachers.apiKey, apiKey)).get();
    if (!teacher) return res.status(401).json({ error: 'Invalid API key' });
    req.teacherId = teacher.id;
    return next();
  }

  // Try JWT
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authentication' });
  }
  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    req.teacherId = payload.teacherId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function signToken(teacherId) {
  return jwt.sign({ teacherId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}
