# 私人教师课表管理系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-teacher course schedule management platform with class management, weekly/monthly/yearly views, and REST API for AI agents.

**Architecture:** Express.js backend serving React SPA (Vite) + SQLite (Drizzle ORM). Single process on port 8080. Puppeteer for PNG generation.

**Tech Stack:** Express.js, Vite, React, Tailwind CSS, Drizzle ORM, better-sqlite3, Puppeteer, JWT, bcrypt

---

## File Structure

```
new_curriculum/
├── server/
│   ├── index.js                    # Express entry, static serving, port 8080
│   ├── db/
│   │   ├── schema.js               # All Drizzle table definitions
│   │   ├── index.js                # DB connection export
│   │   └── seed.js                 # Default pricing tiers
│   ├── routes/
│   │   ├── auth.js                 # POST /login, /register
│   │   ├── classes.js              # CRUD classes
│   │   ├── pricing-tiers.js        # CRUD pricing tiers
│   │   ├── students.js             # CRUD students per class
│   │   ├── schedules.js            # CRUD + batch scheduling
│   │   ├── semesters.js            # CRUD semesters
│   │   ├── schedule-image.js       # GET PNG generation
│   │   └── agent-help.js           # GET public API help JSON
│   ├── middleware/
│   │   └── auth.js                 # JWT + API Key middleware
│   └── services/
│       ├── holidays.js             # Chinese holiday data
│       └── image-gen.js            # Puppeteer screenshot
├── src/
│   ├── main.jsx                    # React entry
│   ├── App.jsx                     # Router + layout
│   ├── api.js                      # API client (fetch wrapper)
│   ├── auth/
│   │   ├── LoginPage.jsx
│   │   └── RegisterPage.jsx
│   ├── schedule/
│   │   ├── WeeklySchedule.jsx      # Time-axis grid
│   │   ├── MonthlySchedule.jsx     # Calendar view
│   │   ├── YearlySchedule.jsx      # 12-month overview
│   │   └── ScheduleGrid.jsx        # Shared grid component
│   ├── classes/
│   │   ├── ClassList.jsx
│   │   ├── ClassForm.jsx
│   │   └── StudentManager.jsx
│   ├── pricing/
│   │   └── PricingTierManager.jsx
│   └── utils/
│       ├── colors.js               # Subject + grade color system
│       └── constants.js            # Grade/subject enums
├── index.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── .env
└── .gitignore
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `.env`, `.gitignore`, `index.html`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`
- Create: `src/main.jsx`, `src/App.jsx`

- [ ] **Step 1: Initialize project**

```bash
cd /home/pcz/workspace/new_curriculum
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install express better-sqlite3 drizzle-orm cors bcryptjs jsonwebtoken uuid puppeteer
npm install -D vite @vitejs/plugin-react tailwindcss postcss autoprefixer concurrently
```

- [ ] **Step 3: Create .env**

```
PORT=8080
JWT_SECRET=change-me-in-production
ALLOW_REGISTRATION=true
```

- [ ] **Step 4: Create .gitignore**

```
node_modules
dist
.env
*.db
.superpowers
```

- [ ] **Step 5: Create vite.config.js**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
  },
});
```

- [ ] **Step 6: Create tailwind.config.js**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 7: Create postcss.config.js**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 8: Create index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>课表管理系统</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 9: Create src/main.jsx**

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
```

- [ ] **Step 10: Create src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body { @apply bg-gray-900 text-gray-100; }
```

- [ ] **Step 11: Create src/App.jsx (placeholder)**

```jsx
export default function App() {
  return <div className="p-8"><h1 className="text-2xl">课表管理系统</h1></div>;
}
```

- [ ] **Step 12: Update package.json scripts**

```json
{
  "scripts": {
    "dev": "concurrently \"vite\" \"node server/index.js\"",
    "build": "vite build",
    "start": "node server/index.js"
  }
}
```

- [ ] **Step 13: Verify dev server starts**

Run: `npm run build && npm start`
Expected: Server starts on port 8080, serves index.html

- [ ] **Step 14: Commit**

```bash
git init
git add -A
git commit -m "feat: project scaffolding with Vite + Express + Tailwind"
```

---

## Task 2: Database Schema

**Files:**
- Create: `server/db/schema.js`, `server/db/index.js`

- [ ] **Step 1: Create server/db/schema.js**

```js
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const teachers = sqliteTable('teachers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  apiKey: text('api_key').unique(),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});

export const classes = sqliteTable('classes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teacherId: integer('teacher_id').notNull().references(() => teachers.id),
  name: text('name').notNull(),
  grade: text('grade').notNull(),
  subject: text('subject').notNull(),
  studentCount: integer('student_count').notNull(),
  unitPrice: real('unit_price').notNull(),
  discountAmount: real('discount_amount').default(0),
  discountReason: text('discount_reason'),
  isCompetition: integer('is_competition', { mode: 'boolean' }).default(false),
  defaultLocationName: text('default_location_name'),
  defaultLocationLat: real('default_location_lat'),
  defaultLocationLng: real('default_location_lng'),
  deleted: integer('deleted', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});

export const pricingTiers = sqliteTable('pricing_tiers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teacherId: integer('teacher_id').notNull().references(() => teachers.id),
  minStudents: integer('min_students').notNull(),
  maxStudents: integer('max_students').notNull(),
  pricePerStudentPerHour: real('price_per_student_per_hour').notNull(),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});

export const students = sqliteTable('students', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  classId: integer('class_id').notNull().references(() => classes.id),
  name: text('name').notNull(),
  phone: text('phone'),
  parentPhone: text('parent_phone'),
  note: text('note'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});

export const schedules = sqliteTable('schedules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  classId: integer('class_id').notNull().references(() => classes.id),
  date: text('date').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  durationBilling: integer('duration_billing').notNull(),
  locationName: text('location_name'),
  locationLat: real('location_lat'),
  locationLng: real('location_lng'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});

export const semesters = sqliteTable('semesters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teacherId: integer('teacher_id').notNull().references(() => teachers.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});
```

- [ ] **Step 2: Create server/db/index.js**

```js
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { existsSync } from 'fs';

const dbPath = process.env.DB_PATH || './data.db';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const drizzleDb = drizzle(db, { schema });

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      api_key TEXT UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      name TEXT NOT NULL,
      grade TEXT NOT NULL,
      subject TEXT NOT NULL,
      student_count INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      discount_amount REAL DEFAULT 0,
      discount_reason TEXT,
      is_competition INTEGER DEFAULT 0,
      default_location_name TEXT,
      default_location_lat REAL,
      default_location_lng REAL,
      deleted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pricing_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      min_students INTEGER NOT NULL,
      max_students INTEGER NOT NULL,
      price_per_student_per_hour REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id),
      name TEXT NOT NULL,
      phone TEXT,
      parent_phone TEXT,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id),
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_billing INTEGER NOT NULL,
      location_name TEXT,
      location_lat REAL,
      location_lng REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS semesters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
```

- [ ] **Step 3: Create server/db/seed.js**

```js
import { drizzleDb } from './index.js';
import { pricingTiers } from './schema.js';
import { eq } from 'drizzle-orm';

const DEFAULT_TIERS = [
  { minStudents: 1, maxStudents: 1, price: 800 },
  { minStudents: 2, maxStudents: 2, price: 600 },
  { minStudents: 3, maxStudents: 3, price: 500 },
  { minStudents: 4, maxStudents: 4, price: 400 },
  { minStudents: 5, maxStudents: 999, price: 200 },
];

export function seedPricingTiers(teacherId) {
  for (const tier of DEFAULT_TIERS) {
    drizzleDb.insert(pricingTiers).values({
      teacherId,
      minStudents: tier.minStudents,
      maxStudents: tier.maxStudents,
      pricePerStudentPerHour: tier.price,
    }).run();
  }
}

export function getDefaultPrice(teacherId, studentCount) {
  const tiers = drizzleDb.select().from(pricingTiers)
    .where(eq(pricingTiers.teacherId, teacherId))
    .all();
  const tier = tiers.find(t => studentCount >= t.minStudents && studentCount <= t.maxStudents);
  return tier ? tier.pricePerStudentPerHour : 200;
}
```

- [ ] **Step 4: Verify schema initializes**

Create a temp test script, run it, check tables exist, delete it.

- [ ] **Step 5: Commit**

```bash
git add server/db/
git commit -m "feat: database schema with Drizzle ORM + SQLite"
```

---

## Task 3: Auth System

**Files:**
- Create: `server/middleware/auth.js`, `server/routes/auth.js`

- [ ] **Step 1: Create server/middleware/auth.js**

```js
import jwt from 'jsonwebtoken';
import { drizzleDb } from '../db/index.js';
import { teachers } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

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
  return jwt.sign({ teacherId }, JWT_SECRET, { expiresIn: '7d' });
}
```

- [ ] **Step 2: Create server/routes/auth.js**

```js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { drizzleDb } from '../db/index.js';
import { teachers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { signToken } from '../middleware/auth.js';
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

export default router;
```

- [ ] **Step 3: Commit**

```bash
git add server/middleware/ server/routes/auth.js
git commit -m "feat: JWT + API key authentication with registration control"
```

---

## Task 4: Express Server Entry + Agent Help

**Files:**
- Create: `server/index.js`, `server/routes/agent-help.js`

- [ ] **Step 1: Create server/index.js**

```js
import express from 'express';
import cors from 'cors';
import { existsSync, mkdirSync } from 'fs';
import { initDb } from './db/index.js';
import authRoutes from './routes/auth.js';
import agentHelpRoutes from './routes/agent-help.js';

const app = express();
app.use(cors());
app.use(express.json());

// Init DB
if (!existsSync('./data')) mkdirSync('./data');
initDb();

// Public routes
app.use('/api', agentHelpRoutes);
app.use('/api/auth', authRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve static files in production
if (existsSync('./dist')) {
  app.use(express.static('./dist'));
  app.get('*', (req, res) => res.sendFile('index.html', { root: './dist' }));
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

- [ ] **Step 2: Create server/routes/agent-help.js**

```js
import { Router } from 'express';
const router = Router();

router.get('/agent/help', (req, res) => {
  res.json({
    name: '课表管理系统 API',
    version: '1.0.0',
    auth: {
      type: 'API Key',
      header: 'X-API-Key',
      description: '在请求头中添加 X-API-Key 进行认证',
    },
    endpoints: {
      'GET /api/agent/help': '获取此帮助信息',
      'GET /api/classes': '获取班级列表',
      'POST /api/classes': '创建班级',
      'PUT /api/classes/:id': '更新班级',
      'DELETE /api/classes/:id': '删除班级',
      'GET /api/classes/:id/students': '获取学生列表',
      'POST /api/classes/:id/students': '添加学生',
      'DELETE /api/classes/:id/students/:sid': '删除学生',
      'GET /api/pricing-tiers': '获取定价阶梯',
      'POST /api/pricing-tiers': '创建定价阶梯',
      'PUT /api/pricing-tiers/:id': '更新定价阶梯',
      'DELETE /api/pricing-tiers/:id': '删除定价阶梯',
      'GET /api/schedules?start=&end=': '获取时间段内排课',
      'POST /api/schedules': '创建单次排课',
      'POST /api/schedules/batch': '批量排课（学期模式或日期模式）',
      'PUT /api/schedules/:id': '更新排课',
      'DELETE /api/schedules/:id': '删除排课',
      'GET /api/semesters': '获取学期列表',
      'POST /api/semesters': '创建学期',
      'PUT /api/semesters/:id': '更新学期',
      'GET /api/schedule-image?start=&end=': '生成课表 PNG 图片',
    },
    examples: {
      '获取本周课表': 'GET /api/schedules?start=2026-04-27&end=2026-05-03',
      '生成课表图片': 'GET /api/schedule-image?start=2026-04-27&end=2026-05-03',
    },
  });
});

export default router;
```

- [ ] **Step 3: Test server starts**

Run: `node server/index.js`
Expected: Server running on port 8080

- [ ] **Step 4: Test agent help endpoint**

Run: `curl http://localhost:8080/api/agent/help | jq`
Expected: JSON with all API endpoints

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat: Express server entry with agent help endpoint"
```

---

## Task 5: Classes, Pricing Tiers, Students API

**Files:**
- Create: `server/routes/classes.js`, `server/routes/pricing-tiers.js`, `server/routes/students.js`

- [ ] **Step 1: Create server/routes/classes.js**

```js
import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { classes } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { getDefaultPrice } from '../db/seed.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const result = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false)))
    .all();
  res.json(result);
});

router.post('/', (req, res) => {
  const { name, grade, subject, studentCount, unitPrice, discountAmount, discountReason,
          isCompetition, defaultLocationName, defaultLocationLat, defaultLocationLng } = req.body;
  if (!name || !grade || !subject || studentCount == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const price = unitPrice ?? getDefaultPrice(req.teacherId, studentCount);
  const result = drizzleDb.insert(classes).values({
    teacherId: req.teacherId, name, grade, subject, studentCount,
    unitPrice: price, discountAmount: discountAmount ?? 0, discountReason,
    isCompetition: isCompetition ?? false,
    defaultLocationName, defaultLocationLat, defaultLocationLng,
  }).run();
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, +id), eq(classes.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.update(classes).set(req.body).where(eq(classes.id, +id)).run();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, +id), eq(classes.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.update(classes).set({ deleted: true }).where(eq(classes.id, +id)).run();
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 2: Create server/routes/pricing-tiers.js**

```js
import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { pricingTiers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const result = drizzleDb.select().from(pricingTiers)
    .where(eq(pricingTiers.teacherId, req.teacherId)).all();
  res.json(result);
});

router.post('/', (req, res) => {
  const { minStudents, maxStudents, pricePerStudentPerHour } = req.body;
  if (minStudents == null || maxStudents == null || pricePerStudentPerHour == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const result = drizzleDb.insert(pricingTiers).values({
    teacherId: req.teacherId, minStudents, maxStudents, pricePerStudentPerHour,
  }).run();
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(pricingTiers)
    .where(and(eq(pricingTiers.id, +id), eq(pricingTiers.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.update(pricingTiers).set(req.body).where(eq(pricingTiers.id, +id)).run();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  drizzleDb.delete(pricingTiers)
    .where(and(eq(pricingTiers.id, +id), eq(pricingTiers.teacherId, req.teacherId))).run();
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 3: Create server/routes/students.js**

```js
import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { students, classes } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

function verifyClassOwnership(classId, teacherId) {
  return drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId), eq(classes.deleted, false)))
    .get();
}

router.get('/:classId/students', (req, res) => {
  if (!verifyClassOwnership(+req.params.classId, req.teacherId)) {
    return res.status(404).json({ error: 'Class not found' });
  }
  const result = drizzleDb.select().from(students)
    .where(eq(students.classId, +req.params.classId)).all();
  res.json(result);
});

router.post('/:classId/students', (req, res) => {
  if (!verifyClassOwnership(+req.params.classId, req.teacherId)) {
    return res.status(404).json({ error: 'Class not found' });
  }
  const { name, phone, parentPhone, note } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = drizzleDb.insert(students).values({
    classId: +req.params.classId, name, phone, parentPhone, note,
  }).run();
  res.json({ id: result.lastInsertRowid });
});

router.delete('/:classId/students/:sid', (req, res) => {
  if (!verifyClassOwnership(+req.params.classId, req.teacherId)) {
    return res.status(404).json({ error: 'Class not found' });
  }
  drizzleDb.delete(students)
    .where(and(eq(students.id, +req.params.sid), eq(students.classId, +req.params.classId)))
    .run();
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 4: Register routes in server/index.js**

Add after auth routes:
```js
import classRoutes from './routes/classes.js';
import pricingTierRoutes from './routes/pricing-tiers.js';
import studentRoutes from './routes/students.js';

app.use('/api/classes', classRoutes);
app.use('/api/pricing-tiers', pricingTierRoutes);
app.use('/api/classes', studentRoutes);
```

- [ ] **Step 5: Test with curl**

```bash
# Register
curl -X POST http://localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"pass","name":"Test"}'

# Login (save token)
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"pass"}' | jq -r .token)

# Create class
curl -X POST http://localhost:8080/api/classes \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"初三数学A班","grade":"初三","subject":"数学","studentCount":3}'

# List classes
curl http://localhost:8080/api/classes -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 6: Commit**

```bash
git add server/routes/classes.js server/routes/pricing-tiers.js server/routes/students.js server/index.js
git commit -m "feat: classes, pricing tiers, and students API"
```

---

## Task 6: Schedules API (Single + Batch)

**Files:**
- Create: `server/routes/schedules.js`, `server/services/holidays.js`

- [ ] **Step 1: Create server/services/holidays.js**

```js
// Chinese public holidays (month-day format)
// Updated annually - add new years as needed
const HOLIDAYS = {
  '2025': ['01-01', '01-28', '01-29', '01-30', '01-31', '02-01', '02-02', '02-03', '02-04',
           '04-04', '04-05', '04-06', '05-01', '05-02', '05-03', '05-04', '05-05',
           '05-31', '06-01', '06-02', '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07'],
  '2026': ['01-01', '01-02', '02-16', '02-17', '02-18', '02-19', '02-20', '02-21', '02-22',
           '04-05', '04-06', '04-07', '05-01', '05-02', '05-03', '05-04', '05-05',
           '06-19', '06-20', '06-21', '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07'],
  '2027': ['01-01', '01-02', '02-06', '02-07', '02-08', '02-09', '02-10', '02-11', '02-12',
           '04-05', '04-06', '05-01', '05-02', '05-03', '06-09', '06-10', '06-11',
           '10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07'],
};

export function isHoliday(dateStr) {
  const year = dateStr.slice(0, 4);
  const mmDd = dateStr.slice(5);
  const yearHolidays = HOLIDAYS[year] || [];
  return yearHolidays.includes(mmDd);
}

export function getHolidaysForYear(year) {
  return HOLIDAYS[String(year)] || [];
}
```

- [ ] **Step 2: Create server/routes/schedules.js**

```js
import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { schedules, classes, semesters } from '../db/schema.js';
import { eq, and, between, gte, lte } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { isHoliday } from '../services/holidays.js';

const router = Router();
router.use(authMiddleware);

function calcDurationBilling(startTime, endTime, manual) {
  if (manual != null) return manual;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

router.get('/', (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });

  // Get teacher's class IDs
  const teacherClasses = drizzleDb.select({ id: classes.id }).from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  const classIds = teacherClasses.map(c => c.id);
  if (classIds.length === 0) return res.json([]);

  const result = drizzleDb.select().from(schedules)
    .where(and(
      gte(schedules.date, start),
      lte(schedules.date, end),
    ))
    .all()
    .filter(s => classIds.includes(s.classId));

  // Attach class info
  const classMap = {};
  drizzleDb.select().from(classes).where(eq(classes.deleted, false)).all()
    .forEach(c => classMap[c.id] = c);

  res.json(result.map(s => ({ ...s, class: classMap[s.classId] })));
});

router.post('/', (req, res) => {
  const { classId, date, startTime, endTime, durationBilling, locationName, locationLat, locationLng } = req.body;
  if (!classId || !date || !startTime || !endTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const billing = calcDurationBilling(startTime, endTime, durationBilling);
  const result = drizzleDb.insert(schedules).values({
    classId, date, startTime, endTime, durationBilling: billing,
    locationName: locationName ?? cls.defaultLocationName,
    locationLat: locationLat ?? cls.defaultLocationLat,
    locationLng: locationLng ?? cls.defaultLocationLng,
  }).run();
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(schedules).where(eq(schedules.id, +id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, existing.classId), eq(classes.teacherId, req.teacherId))).get();
  if (!cls) return res.status(403).json({ error: 'Forbidden' });

  const updates = { ...req.body };
  if (updates.startTime || updates.endTime) {
    updates.durationBilling = calcDurationBilling(
      updates.startTime || existing.startTime,
      updates.endTime || existing.endTime,
      updates.durationBilling,
    );
  }
  drizzleDb.update(schedules).set(updates).where(eq(schedules.id, +id)).run();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const existing = drizzleDb.select().from(schedules).where(eq(schedules.id, +req.params.id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, existing.classId), eq(classes.teacherId, req.teacherId))).get();
  if (!cls) return res.status(403).json({ error: 'Forbidden' });
  drizzleDb.delete(schedules).where(eq(schedules.id, +req.params.id)).run();
  res.json({ ok: true });
});

router.post('/batch', (req, res) => {
  const { classId, semesterId, weekday, dates: manualDates, startTime, endTime, durationBilling } = req.body;
  if (!classId || !startTime || !endTime) {
    return res.status(400).json({ error: 'classId, startTime, endTime required' });
  }
  const cls = drizzleDb.select().from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, req.teacherId))).get();
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const billing = calcDurationBilling(startTime, endTime, durationBilling);
  let targetDates = [];

  if (manualDates && manualDates.length > 0) {
    // Date mode: use provided dates
    targetDates = manualDates;
  } else if (semesterId && weekday != null) {
    // Semester mode: generate dates for each matching weekday
    const semester = drizzleDb.select().from(semesters)
      .where(and(eq(semesters.id, semesterId), eq(semesters.teacherId, req.teacherId))).get();
    if (!semester) return res.status(404).json({ error: 'Semester not found' });

    const current = new Date(semester.startDate);
    const end = new Date(semester.endDate);
    while (current <= end) {
      if (current.getDay() === weekday && !isHoliday(current.toISOString().slice(0, 10))) {
        targetDates.push(current.toISOString().slice(0, 10));
      }
      current.setDate(current.getDate() + 1);
    }
  } else {
    return res.status(400).json({ error: 'Provide semesterId+weekday or dates[]' });
  }

  const inserted = [];
  for (const date of targetDates) {
    const result = drizzleDb.insert(schedules).values({
      classId, date, startTime, endTime, durationBilling: billing,
      locationName: cls.defaultLocationName,
      locationLat: cls.defaultLocationLat,
      locationLng: cls.defaultLocationLng,
    }).run();
    inserted.push(result.lastInsertRowid);
  }
  res.json({ count: inserted.length, ids: inserted });
});

export default router;
```

- [ ] **Step 3: Register routes in server/index.js**

```js
import scheduleRoutes from './routes/schedules.js';
app.use('/api/schedules', scheduleRoutes);
```

- [ ] **Step 4: Test batch scheduling**

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"pass"}' | jq -r .token)

# Create semester
curl -X POST http://localhost:8080/api/semesters \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"2026春季","type":"spring","startDate":"2026-02-23","endDate":"2026-07-05"}'

# Batch schedule (classId=1, semesterId=1, weekday=5=Friday)
curl -X POST http://localhost:8080/api/schedules/batch \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"classId":1,"semesterId":1,"weekday":5,"startTime":"08:00","endTime":"10:00"}'
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/schedules.js server/services/holidays.js server/index.js
git commit -m "feat: schedules API with single/batch creation and holiday exclusion"
```

---

## Task 7: Semesters API + Teacher Profile

**Files:**
- Create: `server/routes/semesters.js`
- Modify: `server/routes/auth.js`

- [ ] **Step 1: Create server/routes/semesters.js**

```js
import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { semesters } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const result = drizzleDb.select().from(semesters)
    .where(eq(semesters.teacherId, req.teacherId)).all();
  res.json(result);
});

router.post('/', (req, res) => {
  const { name, type, startDate, endDate } = req.body;
  if (!name || !type || !startDate || !endDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const result = drizzleDb.insert(semesters).values({
    teacherId: req.teacherId, name, type, startDate, endDate,
  }).run();
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = drizzleDb.select().from(semesters)
    .where(and(eq(semesters.id, +id), eq(semesters.teacherId, req.teacherId))).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  drizzleDb.update(semesters).set(req.body).where(eq(semesters.id, +id)).run();
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 2: Add teacher profile + API key routes to auth.js**

Add to server/routes/auth.js:

```js
import { authMiddleware, signToken } from '../middleware/auth.js';

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
```

- [ ] **Step 3: Register routes in server/index.js**

```js
import semesterRoutes from './routes/semesters.js';
app.use('/api/semesters', semesterRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/semesters.js server/routes/auth.js server/index.js
git commit -m "feat: semesters API and teacher profile endpoints"
```

---

## Task 8: PNG Image Generation

**Files:**
- Create: `server/services/image-gen.js`, `server/routes/schedule-image.js`

- [ ] **Step 1: Create server/services/image-gen.js**

```js
import puppeteer from 'puppeteer';

const SUBJECT_COLORS = {
  '数学': { h: 210, s: 79, baseL: 44 },
  '物理': { h: 122, s: 50, baseL: 33 },
  '英语': { h: 45, s: 93, baseL: 55 },
  '化学': { h: 280, s: 62, baseL: 27 },
  '语文': { h: 0, s: 68, baseL: 38 },
  '生物': { h: 187, s: 100, baseL: 28 },
  '历史': { h: 20, s: 35, baseL: 40 },
  '地理': { h: 200, s: 20, baseL: 25 },
  '政治': { h: 25, s: 100, baseL: 45 },
};

const GRADE_LIGHTNESS = {
  '初一': 75, '初二': 68, '初三': 60,
  '高一': 52, '高二': 44, '高三': 36, '大学': 28,
};

function getColor(cls) {
  const sc = SUBJECT_COLORS[cls.subject] || { h: 0, s: 0, baseL: 50 };
  const l = GRADE_LIGHTNESS[cls.grade] ?? 50;
  return `hsl(${sc.h}, ${sc.s}%, ${l}%)`;
}

export async function generateScheduleImage(schedulesWithClasses, startDate, endDate) {
  // Group by date
  const byDate = {};
  for (const s of schedulesWithClasses) {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  }

  // Find time range
  let minHour = 22, maxHour = 0;
  for (const s of schedulesWithClasses) {
    const sh = parseInt(s.startTime.split(':')[0]);
    const eh = parseInt(s.endTime.split(':')[0]) + (parseInt(s.endTime.split(':')[1]) > 0 ? 1 : 0);
    if (sh < minHour) minHour = sh;
    if (eh > maxHour) maxHour = eh;
  }
  if (minHour > maxHour) { minHour = 8; maxHour = 22; }

  const hours = [];
  for (let h = minHour; h <= maxHour; h++) hours.push(h);

  const html = `<!DOCTYPE html>
<html><head><style>
  body { font-family: sans-serif; margin: 20px; background: #1a1a2e; color: #e0e0e0; }
  h1 { text-align: center; font-size: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #333; padding: 2px; }
  th { background: #16213e; padding: 8px; }
  .time { width: 60px; color: #888; font-size: 12px; text-align: center; }
  .course { border-radius: 4px; padding: 4px 6px; font-size: 11px; color: white; }
  .conflict { border: 3px solid #ff0000 !important; }
  .legend { margin-top: 12px; font-size: 12px; }
  .legend span { margin-right: 12px; }
</style></head><body>
  <h1>${startDate} ~ ${endDate}</h1>
  <table>
    <thead><tr><th class="time">时间</th>
      ${['周一','周二','周三','周四','周五'].map(d => `<th>${d}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${hours.map(h => `<tr>
        <td class="time">${String(h).padStart(2,'0')}:00</td>
        ${[1,2,3,4,5].map(day => {
          const dateStr = getDateForWeekday(startDate, day);
          const daySchedules = (byDate[dateStr] || []).filter(s => {
            const sh = parseInt(s.startTime.split(':')[0]);
            const eh = parseInt(s.endTime.split(':')[0]) + (parseInt(s.endTime.split(':')[1]) > 0 ? 1 : 0);
            return sh <= h && eh > h;
          });
          if (daySchedules.length === 0) return '<td></td>';
          const hasConflict = daySchedules.length > 1;
          return `<td style="vertical-align:top;padding:2px">
            ${daySchedules.map(s => `<div class="course ${hasConflict ? 'conflict' : ''}" style="background:${getColor(s.class)}">
              ${s.class.isCompetition ? '★ ' : ''}${s.class.name}<br>
              <span style="opacity:0.7">${s.startTime}-${s.endTime}</span>
            </div>`).join('')}
          </td>`;
        }).join('')}
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="legend">
    ${Object.entries(SUBJECT_COLORS).map(([name, c]) =>
      `<span><span style="display:inline-block;width:12px;height:12px;background:hsl(${c.h},${c.s}%,45%);border-radius:2px;vertical-align:middle"></span> ${name}</span>`
    ).join('')}
    <span>★ 竞赛课</span>
  </div>
</body></html>`;

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.setViewport({ width: 1200, height: 800 });
  const buffer = await page.screenshot({ type: 'png', fullPage: true });
  await browser.close();
  return buffer;
}

function getDateForWeekday(startDateStr, targetDay) {
  // targetDay: 1=Mon..5=Fri
  const start = new Date(startDateStr);
  const startDay = start.getDay() || 7; // 1=Mon..7=Sun
  const diff = targetDay - startDay;
  const d = new Date(start);
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Create server/routes/schedule-image.js**

```js
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { drizzleDb } from '../db/index.js';
import { schedules, classes } from '../db/schema.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { generateScheduleImage } from '../services/image-gen.js';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });

  const teacherClasses = drizzleDb.select().from(classes)
    .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
  const classIds = teacherClasses.map(c => c.id);
  if (classIds.length === 0) return res.status(404).json({ error: 'No classes' });

  const classMap = {};
  teacherClasses.forEach(c => classMap[c.id] = c);

  const scheds = drizzleDb.select().from(schedules)
    .where(and(gte(schedules.date, start), lte(schedules.date, end)))
    .all()
    .filter(s => classIds.includes(s.classId))
    .map(s => ({ ...s, class: classMap[s.classId] }));

  const buffer = await generateScheduleImage(scheds, start, end);
  res.setHeader('Content-Type', 'image/png');
  res.send(buffer);
});

export default router;
```

- [ ] **Step 3: Register routes in server/index.js**

```js
import scheduleImageRoutes from './routes/schedule-image.js';
app.use('/api/schedule-image', scheduleImageRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add server/services/image-gen.js server/routes/schedule-image.js server/index.js
git commit -m "feat: PNG schedule image generation with Puppeteer"
```

---

## Task 9: Frontend - Constants, Colors, API Client

**Files:**
- Create: `src/utils/constants.js`, `src/utils/colors.js`, `src/api.js`

- [ ] **Step 1: Create src/utils/constants.js**

```js
export const GRADES = ['初一', '初二', '初三', '高一', '高二', '高三', '大学'];

export const SUBJECTS = ['数学', '物理', '化学', '英语', '语文', '生物', '历史', '地理', '政治'];

export const GRADE_LIGHTNESS = {
  '初一': 75, '初二': 68, '初三': 60,
  '高一': 52, '高二': 44, '高三': 36, '大学': 28,
};

export const SUBJECT_HUES = {
  '数学': { h: 210, s: 79 },
  '物理': { h: 122, s: 50 },
  '英语': { h: 45, s: 93 },
  '化学': { h: 280, s: 62 },
  '语文': { h: 0, s: 68 },
  '生物': { h: 187, s: 100 },
  '历史': { h: 20, s: 35 },
  '地理': { h: 200, s: 20 },
  '政治': { h: 25, s: 100 },
};

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
```

- [ ] **Step 2: Create src/utils/colors.js**

```js
import { SUBJECT_HUES, GRADE_LIGHTNESS } from './constants';

export function getClassColor(cls) {
  const hue = SUBJECT_HUES[cls.subject] || { h: 0, s: 0 };
  const lightness = GRADE_LIGHTNESS[cls.grade] ?? 50;
  return `hsl(${hue.h}, ${hue.s}%, ${lightness}%)`;
}

export function getSubjectColor(subject) {
  const hue = SUBJECT_HUES[subject] || { h: 0, s: 0 };
  return `hsl(${hue.h}, ${hue.s}%, 50%)`;
}
```

- [ ] **Step 3: Create src/api.js**

```js
const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  localStorage.setItem('token', token);
}

export function clearToken() {
  localStorage.removeItem('token');
}

async function request(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    return;
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const api = {
  // Auth
  login: (data) => request('POST', '/auth/login', data),
  register: (data) => request('POST', '/auth/register', data),
  getProfile: () => request('GET', '/auth/profile'),
  regenerateApiKey: () => request('PUT', '/auth/api-key'),

  // Classes
  getClasses: () => request('GET', '/classes'),
  createClass: (data) => request('POST', '/classes', data),
  updateClass: (id, data) => request('PUT', `/classes/${id}`, data),
  deleteClass: (id) => request('DELETE', `/classes/${id}`),

  // Students
  getStudents: (classId) => request('GET', `/classes/${classId}/students`),
  addStudent: (classId, data) => request('POST', `/classes/${classId}/students`, data),
  deleteStudent: (classId, sid) => request('DELETE', `/classes/${classId}/students/${sid}`),

  // Pricing Tiers
  getPricingTiers: () => request('GET', '/pricing-tiers'),
  createPricingTier: (data) => request('POST', '/pricing-tiers', data),
  updatePricingTier: (id, data) => request('PUT', `/pricing-tiers/${id}`, data),
  deletePricingTier: (id) => request('DELETE', `/pricing-tiers/${id}`),

  // Schedules
  getSchedules: (start, end) => request('GET', `/schedules?start=${start}&end=${end}`),
  createSchedule: (data) => request('POST', '/schedules', data),
  batchSchedules: (data) => request('POST', '/schedules/batch', data),
  updateSchedule: (id, data) => request('PUT', `/schedules/${id}`, data),
  deleteSchedule: (id) => request('DELETE', `/schedules/${id}`),

  // Semesters
  getSemesters: () => request('GET', '/semesters'),
  createSemester: (data) => request('POST', '/semesters', data),
  updateSemester: (id, data) => request('PUT', `/semesters/${id}`, data),
};
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/ src/api.js
git commit -m "feat: frontend constants, color system, and API client"
```

---

## Task 10: Frontend - Auth Pages + Router

**Files:**
- Create: `src/auth/LoginPage.jsx`, `src/auth/RegisterPage.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Create src/auth/LoginPage.jsx**

```jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setToken } from '../api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const { token } = await api.login({ username, password });
      setToken(token);
      navigate('/');
    } catch {
      setError('用户名或密码错误');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-gray-800 p-8 rounded-lg w-96">
        <h1 className="text-2xl mb-6 text-center">登录</h1>
        {error && <p className="text-red-400 mb-4">{error}</p>}
        <input className="w-full p-3 mb-4 bg-gray-700 rounded" placeholder="用户名"
          value={username} onChange={e => setUsername(e.target.value)} />
        <input className="w-full p-3 mb-4 bg-gray-700 rounded" type="password" placeholder="密码"
          value={password} onChange={e => setPassword(e.target.value)} />
        <button className="w-full p-3 bg-blue-600 rounded hover:bg-blue-700" type="submit">登录</button>
        <p className="mt-4 text-center text-gray-400">
          没有账号？<Link to="/register" className="text-blue-400">注册</Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Create src/auth/RegisterPage.jsx**

```jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setToken } from '../api';

export default function RegisterPage() {
  const [form, setForm] = useState({ username: '', password: '', name: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const { token } = await api.register(form);
      setToken(token);
      navigate('/');
    } catch (err) {
      setError(err.message || '注册失败');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-gray-800 p-8 rounded-lg w-96">
        <h1 className="text-2xl mb-6 text-center">注册</h1>
        {error && <p className="text-red-400 mb-4">{error}</p>}
        <input className="w-full p-3 mb-4 bg-gray-700 rounded" placeholder="姓名"
          value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
        <input className="w-full p-3 mb-4 bg-gray-700 rounded" placeholder="用户名"
          value={form.username} onChange={e => setForm({...form, username: e.target.value})} />
        <input className="w-full p-3 mb-4 bg-gray-700 rounded" type="password" placeholder="密码"
          value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
        <button className="w-full p-3 bg-blue-600 rounded hover:bg-blue-700" type="submit">注册</button>
        <p className="mt-4 text-center text-gray-400">
          已有账号？<Link to="/login" className="text-blue-400">登录</Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Install react-router-dom**

```bash
npm install react-router-dom
```

- [ ] **Step 4: Update src/App.jsx**

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './auth/LoginPage';
import RegisterPage from './auth/RegisterPage';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/*" element={
          <PrivateRoute>
            <div className="p-8"><h1 className="text-2xl">课表管理系统</h1></div>
          </PrivateRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/auth/ src/App.jsx package.json
git commit -m "feat: auth pages with login/register and router"
```

---

## Task 11: Frontend - Weekly Schedule View

**Files:**
- Create: `src/schedule/WeeklySchedule.jsx`, `src/schedule/ScheduleGrid.jsx`

- [ ] **Step 1: Create src/schedule/ScheduleGrid.jsx**

```jsx
import { getClassColor } from '../utils/colors';

const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 8:00-22:00

function getWeekDates(weekStart) {
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

export default function ScheduleGrid({ schedules, weekStart, onScheduleClick }) {
  const dates = getWeekDates(weekStart);

  // Group schedules by date
  const byDate = {};
  dates.forEach(d => byDate[d] = []);
  schedules.forEach(s => {
    if (byDate[s.date]) byDate[s.date].push(s);
  });

  // Detect conflicts
  function getConflicts(dateSchedules) {
    const conflicts = new Set();
    for (let i = 0; i < dateSchedules.length; i++) {
      for (let j = i + 1; j < dateSchedules.length; j++) {
        const a = dateSchedules[i], b = dateSchedules[j];
        if (a.startTime < b.endTime && b.startTime < a.endTime) {
          conflicts.add(a.id);
          conflicts.add(b.id);
        }
      }
    }
    return conflicts;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="w-16 p-2 bg-gray-800 border border-gray-700">时间</th>
            {dates.map((d, i) => (
              <th key={d} className="p-2 bg-gray-800 border border-gray-700">
                {['周一','周二','周三','周四','周五'][i]}<br/>
                <span className="text-sm text-gray-400">{d.slice(5)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HOURS.map(hour => (
            <tr key={hour}>
              <td className="p-1 border border-gray-700 text-center text-sm text-gray-400">
                {String(hour).padStart(2, '0')}:00
              </td>
              {dates.map(date => {
                const daySchedules = (byDate[date] || []).filter(s => {
                  const sh = parseInt(s.startTime.split(':')[0]);
                  const eh = parseInt(s.endTime.split(':')[0]) + (parseInt(s.endTime.split(':')[1]) > 0 ? 1 : 0);
                  return sh <= hour && eh > hour;
                });
                const conflicts = getConflicts(byDate[date] || []);
                const isStartSlot = daySchedules.some(s => parseInt(s.startTime.split(':')[0]) === hour);

                return (
                  <td key={date} className="border border-gray-700 p-1 align-top min-w-[150px]">
                    {isStartSlot && daySchedules.map(s => (
                      <div
                        key={s.id}
                        onClick={() => onScheduleClick?.(s)}
                        className={`p-2 rounded text-sm cursor-pointer mb-1 ${
                          conflicts.has(s.id) ? 'border-2 border-red-500' : ''
                        }`}
                        style={{ backgroundColor: getClassColor(s.class) }}
                      >
                        <div className="font-bold">
                          {s.class?.isCompetition && '★ '}{s.class?.name}
                        </div>
                        <div className="opacity-70 text-xs">{s.startTime}-{s.endTime}</div>
                        {s.durationBilling !== (parseInt(s.endTime.split(':')[0]) * 60 + parseInt(s.endTime.split(':')[1]) - parseInt(s.startTime.split(':')[0]) * 60 - parseInt(s.startTime.split(':')[1])) && (
                          <div className="opacity-60 text-xs">计费{s.durationBilling}min</div>
                        )}
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Create src/schedule/WeeklySchedule.jsx**

```jsx
import { useState, useEffect } from 'react';
import { api } from '../api';
import ScheduleGrid from './ScheduleGrid';

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function WeeklySchedule() {
  const [weekStart, setWeekStart] = useState(getMonday(new Date()));
  const [schedules, setSchedules] = useState([]);

  useEffect(() => {
    const weekEnd = addDays(weekStart, 4);
    api.getSchedules(weekStart, weekEnd).then(setSchedules);
  }, [weekStart]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))}
          className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600">上一周</button>
        <h2 className="text-xl">{weekStart} ~ {addDays(weekStart, 4)}</h2>
        <div className="flex gap-2">
          <button onClick={() => setWeekStart(getMonday(new Date()))}
            className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600">本周</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600">下一周</button>
        </div>
      </div>
      <ScheduleGrid schedules={schedules} weekStart={weekStart} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/schedule/
git commit -m "feat: weekly schedule view with time-axis grid and conflict detection"
```

---

## Task 12: Frontend - Monthly + Yearly Views

**Files:**
- Create: `src/schedule/MonthlySchedule.jsx`, `src/schedule/YearlySchedule.jsx`

- [ ] **Step 1: Create src/schedule/MonthlySchedule.jsx**

```jsx
import { useState, useEffect } from 'react';
import { api } from '../api';
import { getClassColor } from '../utils/colors';

function getMonthDates(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDay = first.getDay() || 7; // 1=Mon
  const dates = [];
  // Fill leading empty cells
  for (let i = 1; i < startDay; i++) dates.push(null);
  for (let d = 1; d <= last.getDate(); d++) dates.push(d);
  return dates;
}

export default function MonthlySchedule({ onDayClick }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [schedules, setSchedules] = useState([]);

  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDate = new Date(year, month + 1, 0).toISOString().slice(0, 10);

  useEffect(() => {
    api.getSchedules(startDate, endDate).then(setSchedules);
  }, [year, month]);

  const dates = getMonthDates(year, month);
  const byDate = {};
  schedules.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); }}
          className="px-4 py-2 bg-gray-700 rounded">上月</button>
        <h2 className="text-xl">{year}年{month + 1}月</h2>
        <button onClick={() => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); }}
          className="px-4 py-2 bg-gray-700 rounded">下月</button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {['周一','周二','周三','周四','周五','周六','周日'].map(d => (
          <div key={d} className="p-2 text-center bg-gray-800 rounded">{d}</div>
        ))}
        {dates.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="p-2 bg-gray-800/50 rounded min-h-[80px]" />;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const daySchedules = byDate[dateStr] || [];
          return (
            <div key={day} onClick={() => onDayClick?.(dateStr)}
              className="p-2 bg-gray-800 rounded min-h-[80px] cursor-pointer hover:bg-gray-700">
              <div className="text-sm text-gray-400 mb-1">{day}</div>
              {daySchedules.slice(0, 3).map(s => (
                <div key={s.id} className="text-xs p-1 rounded mb-0.5 truncate"
                  style={{ backgroundColor: getClassColor(s.class) }}>
                  {s.class?.isCompetition && '★ '}{s.class?.name}
                </div>
              ))}
              {daySchedules.length > 3 && (
                <div className="text-xs text-gray-400">+{daySchedules.length - 3} 更多</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create src/schedule/YearlySchedule.jsx**

```jsx
import { useState, useEffect } from 'react';
import { api } from '../api';

export default function YearlySchedule({ onMonthClick }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [schedules, setSchedules] = useState([]);

  useEffect(() => {
    api.getSchedules(`${year}-01-01`, `${year}-12-31`).then(setSchedules);
  }, [year]);

  // Group by month
  const byMonth = {};
  for (let m = 0; m < 12; m++) byMonth[m] = new Set();
  schedules.forEach(s => {
    const m = parseInt(s.date.split('-')[1]) - 1;
    byMonth[m].add(s.date);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setYear(y => y - 1)} className="px-4 py-2 bg-gray-700 rounded">上一年</button>
        <h2 className="text-xl">{year}年</h2>
        <button onClick={() => setYear(y => y + 1)} className="px-4 py-2 bg-gray-700 rounded">下一年</button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 12 }, (_, m) => (
          <div key={m} onClick={() => onMonthClick?.(year, m)}
            className="p-4 bg-gray-800 rounded cursor-pointer hover:bg-gray-700">
            <h3 className="text-lg mb-2">{m + 1}月</h3>
            <div className="text-sm text-gray-400">
              {byMonth[m].size > 0 ? `${byMonth[m].size} 天有课` : '无排课'}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {Array.from(byMonth[m]).sort().slice(0, 10).map(d => (
                <div key={d} className="w-2 h-2 bg-blue-500 rounded-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/schedule/MonthlySchedule.jsx src/schedule/YearlySchedule.jsx
git commit -m "feat: monthly and yearly schedule views"
```

---

## Task 13: Frontend - Class Management

**Files:**
- Create: `src/classes/ClassList.jsx`, `src/classes/ClassForm.jsx`, `src/classes/StudentManager.jsx`

- [ ] **Step 1: Create src/classes/ClassForm.jsx**

```jsx
import { useState, useEffect } from 'react';
import { GRADES, SUBJECTS } from '../utils/constants';

export default function ClassForm({ initial, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial || {
    name: '', grade: '初三', subject: '数学', studentCount: 1,
    unitPrice: 800, discountAmount: 0, discountReason: '',
    isCompetition: false, defaultLocationName: '',
  });

  useEffect(() => { if (initial) setForm(initial); }, [initial]);

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="bg-gray-800 p-6 rounded-lg">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">班级名称</label>
          <input className="w-full p-2 bg-gray-700 rounded" value={form.name}
            onChange={e => setForm({...form, name: e.target.value})} required />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">年级</label>
          <select className="w-full p-2 bg-gray-700 rounded" value={form.grade}
            onChange={e => setForm({...form, grade: e.target.value})}>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">学科</label>
          <select className="w-full p-2 bg-gray-700 rounded" value={form.subject}
            onChange={e => setForm({...form, subject: e.target.value})}>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">学生人数</label>
          <input type="number" min="1" className="w-full p-2 bg-gray-700 rounded"
            value={form.studentCount}
            onChange={e => setForm({...form, studentCount: +e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">单价 (元/人/小时)</label>
          <input type="number" step="0.01" className="w-full p-2 bg-gray-700 rounded"
            value={form.unitPrice}
            onChange={e => setForm({...form, unitPrice: +e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">优惠金额</label>
          <input type="number" step="0.01" className="w-full p-2 bg-gray-700 rounded"
            value={form.discountAmount}
            onChange={e => setForm({...form, discountAmount: +e.target.value})} />
        </div>
        <div className="col-span-2">
          <label className="block text-sm text-gray-400 mb-1">优惠原因</label>
          <input className="w-full p-2 bg-gray-700 rounded" value={form.discountReason || ''}
            onChange={e => setForm({...form, discountReason: e.target.value})} />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">默认上课地点</label>
          <input className="w-full p-2 bg-gray-700 rounded" value={form.defaultLocationName || ''}
            onChange={e => setForm({...form, defaultLocationName: e.target.value})} />
        </div>
        <div className="flex items-center">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isCompetition}
              onChange={e => setForm({...form, isCompetition: e.target.checked})} />
            <span>竞赛课</span>
          </label>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button type="submit" className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700">保存</button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-600 rounded">取消</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Create src/classes/StudentManager.jsx**

```jsx
import { useState, useEffect } from 'react';
import { api } from '../api';

export default function StudentManager({ classId }) {
  const [students, setStudents] = useState([]);
  const [name, setName] = useState('');

  useEffect(() => {
    if (classId) api.getStudents(classId).then(setStudents);
  }, [classId]);

  async function addStudent() {
    if (!name.trim()) return;
    await api.addStudent(classId, { name: name.trim() });
    setName('');
    api.getStudents(classId).then(setStudents);
  }

  async function removeStudent(sid) {
    await api.deleteStudent(classId, sid);
    setStudents(s => s.filter(x => x.id !== sid));
  }

  return (
    <div className="mt-4">
      <h3 className="text-lg mb-2">学生列表</h3>
      <div className="flex gap-2 mb-2">
        <input className="flex-1 p-2 bg-gray-700 rounded" placeholder="学生姓名"
          value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addStudent()} />
        <button onClick={addStudent} className="px-4 py-2 bg-green-600 rounded">添加</button>
      </div>
      {students.length === 0 ? (
        <p className="text-gray-400">暂无学生</p>
      ) : (
        <ul className="space-y-1">
          {students.map(s => (
            <li key={s.id} className="flex justify-between items-center p-2 bg-gray-800 rounded">
              <span>{s.name}</span>
              <button onClick={() => removeStudent(s.id)} className="text-red-400 hover:text-red-300">删除</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create src/classes/ClassList.jsx**

```jsx
import { useState, useEffect } from 'react';
import { api } from '../api';
import { getClassColor } from '../utils/colors';
import ClassForm from './ClassForm';
import StudentManager from './StudentManager';

export default function ClassList() {
  const [classes, setClasses] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { api.getClasses().then(setClasses); }, []);

  async function handleCreate(form) {
    await api.createClass(form);
    setShowForm(false);
    api.getClasses().then(setClasses);
  }

  async function handleUpdate(form) {
    await api.updateClass(editing.id, form);
    setEditing(null);
    api.getClasses().then(setClasses);
  }

  async function handleDelete(id) {
    if (!confirm('确定删除？')) return;
    await api.deleteClass(id);
    api.getClasses().then(setClasses);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl">班级管理</h2>
        <button onClick={() => { setShowForm(true); setEditing(null); }}
          className="px-4 py-2 bg-blue-600 rounded">新建班级</button>
      </div>

      {(showForm || editing) && (
        <ClassForm
          initial={editing}
          onSubmit={editing ? handleUpdate : handleCreate}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      <div className="grid gap-2 mt-4">
        {classes.map(cls => (
          <div key={cls.id} className="bg-gray-800 rounded-lg overflow-hidden">
            <div className="p-4 flex items-center justify-between cursor-pointer"
              onClick={() => setExpandedId(expandedId === cls.id ? null : cls.id)}>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: getClassColor(cls) }} />
                <div>
                  <div className="font-bold">
                    {cls.isCompetition && '★ '}{cls.name}
                  </div>
                  <div className="text-sm text-gray-400">
                    {cls.grade} · {cls.subject} · {cls.studentCount}人 · ¥{cls.unitPrice}/人/时
                    {cls.discountAmount > 0 && ` · 优惠¥${cls.discountAmount}`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={e => { e.stopPropagation(); setEditing(cls); }}
                  className="px-3 py-1 bg-gray-600 rounded text-sm">编辑</button>
                <button onClick={e => { e.stopPropagation(); handleDelete(cls.id); }}
                  className="px-3 py-1 bg-red-600 rounded text-sm">删除</button>
              </div>
            </div>
            {expandedId === cls.id && <StudentManager classId={cls.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/classes/
git commit -m "feat: class management with CRUD and student list"
```

---

## Task 14: Frontend - Pricing Tiers + Main Layout

**Files:**
- Create: `src/pricing/PricingTierManager.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Create src/pricing/PricingTierManager.jsx**

```jsx
import { useState, useEffect } from 'react';
import { api } from '../api';

export default function PricingTierManager() {
  const [tiers, setTiers] = useState([]);
  const [form, setForm] = useState({ minStudents: 1, maxStudents: 1, pricePerStudentPerHour: 800 });

  useEffect(() => { api.getPricingTiers().then(setTiers); }, []);

  async function addTier() {
    await api.createPricingTier(form);
    setForm({ minStudents: 1, maxStudents: 1, pricePerStudentPerHour: 800 });
    api.getPricingTiers().then(setTiers);
  }

  async function removeTier(id) {
    await api.deletePricingTier(id);
    setTiers(t => t.filter(x => x.id !== id));
  }

  return (
    <div>
      <h2 className="text-xl mb-4">定价阶梯</h2>
      <div className="grid gap-2 mb-4">
        {tiers.map(t => (
          <div key={t.id} className="flex items-center justify-between p-3 bg-gray-800 rounded">
            <span>{t.minStudents === t.maxStudents ? `${t.minStudents}人` : `${t.minStudents}-${t.maxStudents}人`}: ¥{t.pricePerStudentPerHour}/人/时</span>
            <button onClick={() => removeTier(t.id)} className="text-red-400">删除</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="number" min="1" className="w-24 p-2 bg-gray-700 rounded" placeholder="最少"
          value={form.minStudents} onChange={e => setForm({...form, minStudents: +e.target.value})} />
        <input type="number" min="1" className="w-24 p-2 bg-gray-700 rounded" placeholder="最多"
          value={form.maxStudents} onChange={e => setForm({...form, maxStudents: +e.target.value})} />
        <input type="number" step="0.01" className="w-32 p-2 bg-gray-700 rounded" placeholder="单价"
          value={form.pricePerStudentPerHour} onChange={e => setForm({...form, pricePerStudentPerHour: +e.target.value})} />
        <button onClick={addTier} className="px-4 py-2 bg-green-600 rounded">添加</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update src/App.jsx with full layout**

```jsx
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import LoginPage from './auth/LoginPage';
import RegisterPage from './auth/RegisterPage';
import WeeklySchedule from './schedule/WeeklySchedule';
import MonthlySchedule from './schedule/MonthlySchedule';
import YearlySchedule from './schedule/YearlySchedule';
import ClassList from './classes/ClassList';
import PricingTierManager from './pricing/PricingTierManager';
import { clearToken } from './api';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
}

function Layout({ children }) {
  const location = useLocation();
  const links = [
    { to: '/', label: '周课表' },
    { to: '/monthly', label: '月课表' },
    { to: '/yearly', label: '年课表' },
    { to: '/classes', label: '班级管理' },
    { to: '/pricing', label: '定价阶梯' },
  ];

  return (
    <div className="flex h-screen">
      <nav className="w-48 bg-gray-800 p-4 flex flex-col">
        <h1 className="text-lg font-bold mb-6">课表管理</h1>
        {links.map(l => (
          <Link key={l.to} to={l.to}
            className={`p-2 rounded mb-1 ${location.pathname === l.to ? 'bg-blue-600' : 'hover:bg-gray-700'}`}>
            {l.label}
          </Link>
        ))}
        <div className="mt-auto">
          <button onClick={() => { clearToken(); window.location.href = '/login'; }}
            className="w-full p-2 text-gray-400 hover:text-white">退出登录</button>
        </div>
      </nav>
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/*" element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<WeeklySchedule />} />
                <Route path="/monthly" element={<MonthlySchedule />} />
                <Route path="/yearly" element={<YearlySchedule />} />
                <Route path="/classes" element={<ClassList />} />
                <Route path="/pricing" element={<PricingTierManager />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pricing/ src/App.jsx
git commit -m "feat: pricing tier manager and main layout with navigation"
```

---

## Task 15: Integration Test + Build

- [ ] **Step 1: Build frontend**

```bash
npm run build
```

Expected: dist/ directory created with built files

- [ ] **Step 2: Start production server**

```bash
ALLOW_REGISTRATION=true node server/index.js
```

Expected: Server on 8080, serves SPA at http://localhost:8080

- [ ] **Step 3: Test full flow**

1. Open http://localhost:8080 → redirects to /login
2. Register a new account
3. Create a class (初三数学A班)
4. Add students
5. Create a semester (2026春季)
6. Batch schedule
7. View weekly/monthly/yearly schedule
8. Test agent help: `curl http://localhost:8080/api/agent/help`
9. Test image: `curl -H "X-API-Key: <key>" http://localhost:8080/api/schedule-image?start=2026-03-02&end=2026-03-06 -o schedule.png`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete curriculum scheduler application"
```
