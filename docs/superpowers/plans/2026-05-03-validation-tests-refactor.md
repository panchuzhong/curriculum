# 输入校验 + 路由测试 + 组件拆分 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为所有 API 路由添加 express-validator 输入校验，补充 supertest 全路由 HTTP 测试，拆分 WeeklySchedule/ScheduleGrid 大组件。

**Architecture:** 三阶段顺序推进。Phase 1 给每个路由添加 validation chain + 统一错误中间件；Phase 2 用 vitest `vi.mock` + supertest 给每个路由写 HTTP 集成测试；Phase 3 从大组件中抽取自定义 Hook 和子组件。

**Tech Stack:** express-validator, supertest, vitest (vi.mock), React hooks

**ESM 测试策略:** 所有路由测试文件使用相同模式：
1. `vi.mock('../db/index.js')` 用 getter 容器 — 让每个 `beforeEach` 能换新 DB
2. `vi.mock('../db/seed.js')` 和 `vi.mock('../services/audit.js')` — 避免副作用
3. 动态 `await import()` 路由模块 — 在 mock 生效后才 import
4. `beforeEach` 创建新内存 DB → 放入容器 → 挂载路由到新 Express app

---

## Phase 1: express-validator 输入校验

### Task 1: 安装依赖 + 创建校验中间件

**Files:**
- Create: `server/validations/handle.js`

- [ ] **Step 1: 安装 express-validator**

```bash
cd /home/pcz/workspace/curriculum && npm install express-validator
```

- [ ] **Step 2: 创建统一校验结果中间件**

Create `server/validations/handle.js`:

```js
import { validationResult } from 'express-validator';

export default function handle(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const first = errors.array()[0];
  res.status(400).json({ error: first.msg });
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json server/validations/handle.js
git commit -m "feat: add express-validator with validation result handler"
```

---

### Task 2: auth 路由校验

**Files:**
- Create: `server/validations/auth.js`
- Modify: `server/routes/auth.js`

- [ ] **Step 1: 创建 auth 校验规则**

Create `server/validations/auth.js`:

```js
import { body } from 'express-validator';

export const validateRegister = [
  body('username').isAlphanumeric().isLength({ min: 3, max: 20 }).withMessage('用户名须为3-20位字母数字'),
  body('password').isLength({ min: 6 }).withMessage('密码至少6位'),
  body('name').notEmpty().withMessage('姓名不能为空'),
];

export const validateLogin = [
  body('username').notEmpty().withMessage('用户名不能为空'),
  body('password').notEmpty().withMessage('密码不能为空'),
];

export const validateChangePassword = [
  body('oldPassword').notEmpty().withMessage('旧密码不能为空'),
  body('newPassword').isLength({ min: 6 }).withMessage('新密码至少6位'),
];

export const validateUpdateSubjects = [
  body('subjects').isArray().withMessage('subjects 必须是数组'),
  body('subjects.*').isString().withMessage('科目必须是字符串'),
];
```

- [ ] **Step 2: 修改 auth.js 路由**

在 `server/routes/auth.js` 顶部添加 import：

```js
import handle from '../validations/handle.js';
import { validateRegister, validateLogin, validateChangePassword, validateUpdateSubjects } from '../validations/auth.js';
```

修改 register 路由（第23行）：
```js
router.post('/register', authLimiter, validateRegister, handle, (req, res) => {
```
删除第28-30行的 `if (!username || !password || !name)` 块。

修改 login 路由（第46行）：
```js
router.post('/login', authLimiter, validateLogin, handle, (req, res) => {
```

修改 subjects 路由（第62行）：
```js
router.put('/subjects', authMiddleware, validateUpdateSubjects, handle, (req, res) => {
```
删除第63-66行的 `if (!Array.isArray(subjects))` 块。

修改 password 路由（第77行）：
```js
router.put('/password', authMiddleware, validateChangePassword, handle, (req, res) => {
```
删除第78-84行的 `if (!oldPassword || !newPassword)` 和 `if (newPassword.length < 6)` 块。

- [ ] **Step 3: Commit**

```bash
git add server/validations/auth.js server/routes/auth.js
git commit -m "feat: add validation to auth routes"
```

---

### Task 3: classes 路由校验

**Files:**
- Create: `server/validations/classes.js`
- Modify: `server/routes/classes.js`

- [ ] **Step 1: 创建 classes 校验规则**

Create `server/validations/classes.js`:

```js
import { body } from 'express-validator';

const VALID_GRADES = ['初一', '初二', '初三', '高一', '高二', '高三', '大学'];

export const validateCreateClass = [
  body('name').notEmpty().withMessage('班级名称不能为空'),
  body('grade').isIn(VALID_GRADES).withMessage(`年级须为: ${VALID_GRADES.join('/')}`),
  body('subject').notEmpty().withMessage('学科不能为空'),
  body('studentCount').isInt({ min: 1 }).withMessage('学生人数须为正整数'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负'),
  body('isCompetition').optional().isBoolean().withMessage('isCompetition 须为布尔值'),
];

export const validateUpdateClass = [
  body('unitPrice').optional().isFloat({ gt: 0 }).withMessage('单价须大于0'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负'),
  body('studentCount').optional().isInt({ min: 1 }).withMessage('学生人数须为正整数'),
];

export const validateClassStudent = [
  body('name').notEmpty().withMessage('学生姓名不能为空'),
];
```

- [ ] **Step 2: 修改 classes.js 路由**

在 `server/routes/classes.js` 顶部添加：

```js
import handle from '../validations/handle.js';
import { validateCreateClass, validateUpdateClass, validateClassStudent } from '../validations/classes.js';
```

修改 POST `/`（第19行）：加 `validateCreateClass, handle`，删除第22-24行的 `if (!name || !grade || !subject || studentCount == null)` 块。

修改 PUT `/:id`（第38行）：加 `validateUpdateClass, handle`。

修改 POST `/:classId/students`（第80行）：加 `validateClassStudent, handle`，删除第87行的 `if (!name)` 校验。

- [ ] **Step 3: Commit**

```bash
git add server/validations/classes.js server/routes/classes.js
git commit -m "feat: add validation to class routes"
```

---

### Task 4: students 路由校验

**Files:**
- Create: `server/validations/students.js`
- Modify: `server/routes/students.js`

- [ ] **Step 1: 创建 students 校验规则**

Create `server/validations/students.js`:

```js
import { body } from 'express-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

export const validateCreateStudent = [
  body('name').notEmpty().withMessage('姓名不能为空'),
  body('birthDate').optional().matches(DATE_RE).withMessage('出生日期格式须为 YYYY-MM-DD'),
  body('phone').optional().matches(PHONE_RE).withMessage('手机号格式不正确'),
  body('parentPhone').optional().matches(PHONE_RE).withMessage('家长手机号格式不正确'),
  body('classIds').optional().isArray().withMessage('classIds 须为数组'),
];

export const validateUpdateStudent = [
  body('name').optional().notEmpty().withMessage('姓名不能为空'),
  body('birthDate').optional().matches(DATE_RE).withMessage('出生日期格式须为 YYYY-MM-DD'),
  body('phone').optional().matches(PHONE_RE).withMessage('手机号格式不正确'),
  body('parentPhone').optional().matches(PHONE_RE).withMessage('家长手机号格式不正确'),
  body('classIds').optional().isArray().withMessage('classIds 须为数组'),
];
```

- [ ] **Step 2: 修改 students.js 路由**

添加 import。修改 POST `/`：加 `validateCreateStudent, handle`，删除第42行 `if (!name)`。修改 PUT `/:id`：加 `validateUpdateStudent, handle`。

- [ ] **Step 3: Commit**

```bash
git add server/validations/students.js server/routes/students.js
git commit -m "feat: add validation to student routes"
```

---

### Task 5: schedules 路由校验

**Files:**
- Create: `server/validations/schedules.js`
- Modify: `server/routes/schedules.js`

- [ ] **Step 1: 创建 schedules 校验规则**

Create `server/validations/schedules.js`:

```js
import { body } from 'express-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export const validateCreateSchedule = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('date').matches(DATE_RE).withMessage('日期格式须为 YYYY-MM-DD'),
  body('startTime').matches(TIME_RE).withMessage('开始时间格式须为 HH:MM'),
  body('endTime').matches(TIME_RE).withMessage('结束时间格式须为 HH:MM'),
];

export const validateBatchCreate = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('startTime').matches(TIME_RE).withMessage('开始时间格式须为 HH:MM'),
  body('endTime').matches(TIME_RE).withMessage('结束时间格式须为 HH:MM'),
  body('dates').optional().isArray().withMessage('dates 须为数组'),
  body('dates.*').optional().matches(DATE_RE).withMessage('日期格式须为 YYYY-MM-DD'),
  body('weekday').optional().isInt({ min: 0, max: 6 }).withMessage('weekday 须为0-6'),
  body('semesterId').optional().isInt({ min: 1 }).withMessage('semesterId 须为正整数'),
];

export const validateBatchUpdate = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('updates').isObject().withMessage('updates 须为对象'),
];

export const validateBatchDelete = [
  body('ids').optional().isArray().withMessage('ids 须为数组'),
];
```

- [ ] **Step 2: 修改 schedules.js 路由**

添加 import。修改 POST `/`：加 `validateCreateSchedule, handle`，删除第40-42行。修改 POST `/batch`：加 `validateBatchCreate, handle`，删除第108-110行。修改 PUT `/batch`：加 `validateBatchUpdate, handle`，删除第153-155行。修改 DELETE `/batch`：加 `validateBatchDelete, handle`。

- [ ] **Step 3: Commit**

```bash
git add server/validations/schedules.js server/routes/schedules.js
git commit -m "feat: add validation to schedule routes"
```

---

### Task 6: semesters 路由校验

**Files:**
- Create: `server/validations/semesters.js`
- Modify: `server/routes/semesters.js`

- [ ] **Step 1: 创建 semesters 校验规则**

Create `server/validations/semesters.js`:

```js
import { body } from 'express-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TYPES = ['春季', '秋季', '暑假', '寒假'];

export const validateCreateSemester = [
  body('name').notEmpty().withMessage('学期名称不能为空'),
  body('type').isIn(VALID_TYPES).withMessage(`学期类型须为: ${VALID_TYPES.join('/')}`),
  body('startDate').matches(DATE_RE).withMessage('开始日期格式须为 YYYY-MM-DD'),
  body('endDate').matches(DATE_RE).withMessage('结束日期格式须为 YYYY-MM-DD'),
];

export const validateUpdateSemester = [
  body('name').optional().notEmpty().withMessage('学期名称不能为空'),
  body('type').optional().isIn(VALID_TYPES).withMessage(`学期类型须为: ${VALID_TYPES.join('/')}`),
  body('startDate').optional().matches(DATE_RE).withMessage('开始日期格式须为 YYYY-MM-DD'),
  body('endDate').optional().matches(DATE_RE).withMessage('结束日期格式须为 YYYY-MM-DD'),
];
```

- [ ] **Step 2: 修改 semesters.js 路由**

添加 import。修改 POST `/`：加 `validateCreateSemester, handle`，删除第18-20行。修改 PUT `/:id`：加 `validateUpdateSemester, handle`。

- [ ] **Step 3: Commit**

```bash
git add server/validations/semesters.js server/routes/semesters.js
git commit -m "feat: add validation to semester routes"
```

---

### Task 7: holidays 路由校验

**Files:**
- Create: `server/validations/holidays.js`
- Modify: `server/routes/holidays.js`

- [ ] **Step 1: 创建 holidays 校验规则**

Create `server/validations/holidays.js`:

```js
import { body } from 'express-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TYPES = ['holiday', 'workday'];

export const validateCreateHoliday = [
  body('date').matches(DATE_RE).withMessage('日期格式须为 YYYY-MM-DD'),
  body('type').isIn(VALID_TYPES).withMessage('类型须为 holiday 或 workday'),
  body('name').notEmpty().withMessage('名称不能为空'),
];

export const validateUpdateHoliday = [
  body('date').optional().matches(DATE_RE).withMessage('日期格式须为 YYYY-MM-DD'),
  body('type').optional().isIn(VALID_TYPES).withMessage('类型须为 holiday 或 workday'),
];

export const validateBatchHolidays = [
  body('items').isArray().withMessage('items 须为数组'),
];
```

- [ ] **Step 2: 修改 holidays.js 路由**

添加 import。修改 POST `/`：加 `validateCreateHoliday, handle`，删除第29行。修改 PUT `/:id`：加 `validateUpdateHoliday, handle`。修改 POST `/batch`：加 `validateBatchHolidays, handle`，删除第70行。保留第74行防御性 `continue`。

- [ ] **Step 3: Commit**

```bash
git add server/validations/holidays.js server/routes/holidays.js
git commit -m "feat: add validation to holiday routes"
```

---

### Task 8: pricing-tiers 路由校验

**Files:**
- Create: `server/validations/pricing-tiers.js`
- Modify: `server/routes/pricing-tiers.js`

- [ ] **Step 1: 创建 pricing-tiers 校验规则**

Create `server/validations/pricing-tiers.js`:

```js
import { body } from 'express-validator';

export const validateCreateTier = [
  body('minStudents').isInt({ min: 1 }).withMessage('最小人数须为正整数'),
  body('maxStudents').isInt({ min: 1 }).withMessage('最大人数须为正整数'),
  body('pricePerStudentPerHour').isFloat({ gt: 0 }).withMessage('单价须大于0'),
];

export const validateUpdateTier = [
  body('minStudents').optional().isInt({ min: 1 }).withMessage('最小人数须为正整数'),
  body('maxStudents').optional().isInt({ min: 1 }).withMessage('最大人数须为正整数'),
  body('pricePerStudentPerHour').optional().isFloat({ gt: 0 }).withMessage('单价须大于0'),
];
```

- [ ] **Step 2: 修改 pricing-tiers.js 路由**

添加 import。修改 POST `/`：加 `validateCreateTier, handle`，删除第18-20行。修改 PUT `/:id`：加 `validateUpdateTier, handle`。

- [ ] **Step 3: 运行现有测试确认无回归**

```bash
cd /home/pcz/workspace/curriculum && npm test
```

Expected: 所有现有测试通过。新校验逻辑只在路由层，不影响业务逻辑测试。

- [ ] **Step 4: Commit**

```bash
git add server/validations/pricing-tiers.js server/routes/pricing-tiers.js
git commit -m "feat: add validation to pricing-tier routes"
```

---

## Phase 2: supertest 全路由 HTTP 测试

所有路由测试共用以下模板结构：

```js
// 1. 模块顶部：vi.mock 容器 + mock 声明
const container = { drizzleDb: null, db: null };
vi.mock('../db/index.js', () => ({
  get drizzleDb() { return container.drizzleDb; },
  get db() { return container.db; },
  initDb: vi.fn(),
}));
vi.mock('../db/seed.js', () => ({ seedPricingTiers: vi.fn(), getDefaultPrice: vi.fn(() => 100) }));
vi.mock('../services/audit.js', () => ({ logAudit: vi.fn() }));

// 2. 动态 import（在 mock 生效后）
const routes = (await import('../routes/xxx.js')).default;
const { createTestDb } = await import('./setup.js');
const { teachers, ... } = await import('../db/schema.js');

// 3. beforeEach：新内存 DB → 填容器 → 挂路由
let app, drizzleDb;
beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret';
  const t = createTestDb();
  container.drizzleDb = t.drizzleDb;
  container.db = t.db;
  drizzleDb = t.drizzleDb;
  app = express();
  app.use(express.json());
  app.use('/api/xxx', routes);
});

// 4. 辅助函数：直接往内存 DB 插测试用户
function makeUser(username = 'testuser') {
  const hash = bcrypt.hashSync('pass123', 10);
  const r = drizzleDb.insert(teachers).values({
    username, passwordHash: hash, name: username, apiKey: `key-${username}`,
  }).run();
  return { id: Number(r.lastInsertRowid), token: signToken(Number(r.lastInsertRowid)) };
}
```

### Task 9: 安装 supertest + 创建共享测试模板

**Files:**
- Create: `server/__tests__/route-helpers.js`

- [ ] **Step 1: 安装 supertest**

```bash
cd /home/pcz/workspace/curriculum && npm install --save-dev supertest
```

- [ ] **Step 2: 创建共享测试工具**

Create `server/__tests__/route-helpers.js`:

```js
import { vi } from 'vitest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { signToken } from '../middleware/auth.js';

// 可变容器 — vi.mock getter 每次读取最新值
export const container = { drizzleDb: null, db: null };

// 通用 mock 声明 — 各测试文件在模块顶部调用
export function mockCommonDeps() {
  vi.mock('../db/index.js', () => ({
    get drizzleDb() { return container.drizzleDb; },
    get db() { return container.db; },
    initDb: vi.fn(),
  }));
  vi.mock('../db/seed.js', () => ({
    seedPricingTiers: vi.fn(),
    getDefaultPrice: vi.fn(() => 100),
  }));
  vi.mock('../services/audit.js', () => ({
    logAudit: vi.fn(),
  }));
}

// 在 beforeEach 中调用：创建内存 DB + Express app + 挂载路由
export async function setupApp(routePath, routeModuleImport) {
  process.env.JWT_SECRET = 'test-secret-key';
  const { createTestDb } = await import('./setup.js');
  const t = createTestDb();
  container.drizzleDb = t.drizzleDb;
  container.db = t.db;
  const routes = (await import(routeModuleImport)).default;
  const app = express();
  app.use(express.json());
  app.use(routePath, routes);
  return { app, drizzleDb: t.drizzleDb };
}

// 往内存 DB 插入测试用户，返回 { id, token }
export async function makeUser(drizzleDb, username = 'testuser') {
  const { teachers } = await import('../db/schema.js');
  const hash = bcrypt.hashSync('pass123', 10);
  const r = drizzleDb.insert(teachers).values({
    username, passwordHash: hash, name: username, apiKey: `key-${username}`,
    subjects: JSON.stringify(['数学', '物理']),
  }).run();
  const id = Number(r.lastInsertRowid);
  return { id, token: signToken(id) };
}

// Authorization header
export function auth(token) {
  return { Authorization: `Bearer ${token}` };
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json server/__tests__/route-helpers.js
git commit -m "feat: add supertest and shared test helpers"
```

---

### Task 10: auth 路由测试

**Files:**
- Create: `server/__tests__/routes-auth.test.js`

- [ ] **Step 1: 创建 auth 路由测试**

Create `server/__tests__/routes-auth.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { container, mockCommonDeps, setupApp, makeUser, auth } from './route-helpers.js';

mockCommonDeps();

let app, drizzleDb;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/auth', '../routes/auth.js'));
  process.env.ALLOW_REGISTRATION = 'true';
});

describe('POST /api/auth/register', () => {
  it('registers and returns token + apiKey', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test123', name: 'Test' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.apiKey).toBeDefined();
  });

  it('rejects duplicate username', async () => {
    await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test123', name: 'Test' });
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test123', name: 'Test' });
    expect(res.status).toBe(409);
  });

  it('rejects short username (<3 chars)', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'ab', password: 'test123', name: 'Test' });
    expect(res.status).toBe(400);
  });

  it('rejects short password (<6 chars)', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: '12345', name: 'Test' });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ username: 'testuser' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register')
      .send({ username: 'testuser', password: 'test123', name: 'Test' });
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'test123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'testuser', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects non-existent user', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ username: 'nobody', password: 'test123' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/profile', () => {
  it('returns profile with valid token', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).get('/api/auth/profile').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('testuser');
  });

  it('rejects without token', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/auth/password', () => {
  it('changes password', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: 'newpass123' });
    expect(res.status).toBe(200);
  });

  it('rejects wrong old password', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'wrong', newPassword: 'newpass123' });
    expect(res.status).toBe(401);
  });

  it('rejects short new password', async () => {
    const { token } = await makeUser(drizzleDb);
    const res = await request(app).put('/api/auth/password').set(auth(token))
      .send({ oldPassword: 'pass123', newPassword: '12345' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd /home/pcz/workspace/curriculum && npx vitest run server/__tests__/routes-auth.test.js
```

Expected: 全部通过。

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/routes-auth.test.js
git commit -m "test: add HTTP integration tests for auth routes"
```

---

### Task 11: classes 路由测试

**Files:**
- Create: `server/__tests__/routes-classes.test.js`

- [ ] **Step 1: 创建 classes 路由测试**

Create `server/__tests__/routes-classes.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { container, mockCommonDeps, setupApp, makeUser, auth } from './route-helpers.js';

mockCommonDeps();

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/classes', '../routes/classes.js'));
  ({ token } = await makeUser(drizzleDb));
});

describe('POST /api/classes', () => {
  it('creates a class', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '数学一班', grade: '高一', subject: '数学', studentCount: 5 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects invalid grade', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '三年级', subject: '数学', studentCount: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ grade: '高一', subject: '数学', studentCount: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects studentCount < 1', async () => {
    const res = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 0 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/classes', () => {
  it('lists classes for teacher', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '数学一班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).get('/api/classes').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('数学一班');
  });

  it('excludes soft-deleted classes', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '待删班', grade: '高一', subject: '数学', studentCount: 5 });
    await request(app).delete(`/api/classes/${id}`).set(auth(token));
    const res = await request(app).get('/api/classes').set(auth(token));
    expect(res.body).toHaveLength(0);
  });
});

describe('PUT /api/classes/:id', () => {
  it('updates a class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '旧名', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ name: '新名' });
    expect(res.status).toBe(200);
  });

  it('rejects negative unitPrice', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token))
      .send({ unitPrice: -10 });
    expect(res.status).toBe(400);
  });

  it('returns 404 for other teacher\'s class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/classes/${id}`).set(auth(token2))
      .send({ name: 'hack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/classes/:id', () => {
  it('soft deletes a class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const res = await request(app).delete(`/api/classes/${id}`).set(auth(token));
    expect(res.status).toBe(200);
  });

  it('returns 404 for other teacher\'s class', async () => {
    const { body: { id } } = await request(app).post('/api/classes').set(auth(token))
      .send({ name: '班', grade: '高一', subject: '数学', studentCount: 5 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).delete(`/api/classes/${id}`).set(auth(token2));
    expect(res.status).toBe(404);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher\'s classes', async () => {
    await request(app).post('/api/classes').set(auth(token))
      .send({ name: '我的班', grade: '高一', subject: '数学', studentCount: 5 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/classes').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd /home/pcz/workspace/curriculum && npx vitest run server/__tests__/routes-classes.test.js
```

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/routes-classes.test.js
git commit -m "test: add HTTP integration tests for class routes"
```

---

### Task 12: students 路由测试

**Files:**
- Create: `server/__tests__/routes-students.test.js`

- [ ] **Step 1: 创建 students 路由测试**

与 classes 同模式。辅助函数 `createClass(drizzleDb, token)` 先创建班级供 classIds 关联。

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { container, mockCommonDeps, setupApp, makeUser, auth } from './route-helpers.js';

mockCommonDeps();

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/students', '../routes/students.js'));
  ({ token } = await makeUser(drizzleDb));
});

async function createClass() {
  const { classes } = await import('../db/schema.js');
  const r = drizzleDb.insert(classes).values({
    teacherId: (await makeUser(drizzleDb)).id, name: '数学班', grade: '高一', subject: '数学', studentCount: 5, unitPrice: 100,
  }).run();
  return Number(r.lastInsertRowid);
}

describe('POST /api/students', () => {
  it('creates a student', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', phone: '13800138000' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects empty name', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ phone: '13800138000' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid phone', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', phone: '123' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid birthDate', async () => {
    const res = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三', birthDate: 'not-a-date' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/students', () => {
  it('lists students with classIds', async () => {
    await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三' });
    const res = await request(app).get('/api/students').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].classIds).toBeDefined();
  });
});

describe('PUT /api/students/:id', () => {
  it('updates a student', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三' });
    const res = await request(app).put(`/api/students/${id}`).set(auth(token))
      .send({ name: '李四' });
    expect(res.status).toBe(200);
  });

  it('returns 404 for other teacher\'s student', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/students/${id}`).set(auth(token2))
      .send({ name: 'hack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/students/:id', () => {
  it('deletes student and class links', async () => {
    const { body: { id } } = await request(app).post('/api/students').set(auth(token))
      .send({ name: '张三' });
    const res = await request(app).delete(`/api/students/${id}`).set(auth(token));
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/students').set(auth(token));
    expect(list.body).toHaveLength(0);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher\'s students', async () => {
    await request(app).post('/api/students').set(auth(token)).send({ name: '我的学生' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/students').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd /home/pcz/workspace/curriculum && npx vitest run server/__tests__/routes-students.test.js
```

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/routes-students.test.js
git commit -m "test: add HTTP integration tests for student routes"
```

---

### Task 13: schedules 路由测试

**Files:**
- Create: `server/__tests__/routes-schedules.test.js`

- [ ] **Step 1: 创建 schedules 路由测试**

需要先创建班级。额外 mock `../services/holidays.js`。

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { container, mockCommonDeps, setupApp, makeUser, auth } from './route-helpers.js';

mockCommonDeps();
vi.mock('../services/holidays.js', () => ({ isHoliday: () => false, getHolidayName: () => '' }));

let app, drizzleDb, token, classId;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/schedules', '../routes/schedules.js'));
  const user = await makeUser(drizzleDb);
  token = user.token;
  // 创建测试班级
  const { classes } = await import('../db/schema.js');
  const r = drizzleDb.insert(classes).values({
    teacherId: user.id, name: '数学班', grade: '高一', subject: '数学', studentCount: 5, unitPrice: 100,
  }).run();
  classId = Number(r.lastInsertRowid);
});

describe('POST /api/schedules', () => {
  it('creates a schedule', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects invalid date format', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: 'not-a-date', startTime: '09:00', endTime: '10:30' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid time format', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '9:00', endTime: '10:30' });
    expect(res.status).toBe(400);
  });

  it('rejects missing classId', async () => {
    const res = await request(app).post('/api/schedules').set(auth(token))
      .send({ date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    expect(res.status).toBe(400);
  });

  it('rejects class of other teacher', async () => {
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).post('/api/schedules').set(auth(token2))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/schedules', () => {
  it('lists schedules in range', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).get('/api/schedules?start=2026-05-01&end=2026-05-31').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('requires start/end params', async () => {
    const res = await request(app).get('/api/schedules').set(auth(token));
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/schedules/:id', () => {
  it('updates a schedule', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).put(`/api/schedules/${id}`).set(auth(token))
      .send({ startTime: '10:00' });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/schedules/:id', () => {
  it('deletes a schedule', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).delete(`/api/schedules/${id}`).set(auth(token));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/schedules/batch', () => {
  it('creates batch by dates array', async () => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ classId, startTime: '09:00', endTime: '10:30', dates: ['2026-05-04', '2026-05-11'] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('rejects missing classId', async () => {
    const res = await request(app).post('/api/schedules/batch').set(auth(token))
      .send({ startTime: '09:00', endTime: '10:30', dates: ['2026-05-04'] });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/schedules/batch', () => {
  it('deletes by ids array', async () => {
    const { body: { id } } = await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ ids: [id] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('deletes by date range', async () => {
    await request(app).post('/api/schedules').set(auth(token))
      .send({ classId, date: '2026-05-04', startTime: '09:00', endTime: '10:30' });
    const res = await request(app).delete('/api/schedules/batch').set(auth(token))
      .send({ start: '2026-05-01', end: '2026-05-31' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd /home/pcz/workspace/curriculum && npx vitest run server/__tests__/routes-schedules.test.js
```

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/routes-schedules.test.js
git commit -m "test: add HTTP integration tests for schedule routes"
```

---

### Task 14: semesters 路由测试

**Files:**
- Create: `server/__tests__/routes-semesters.test.js`

- [ ] **Step 1: 创建 semesters 路由测试**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { container, mockCommonDeps, setupApp, makeUser, auth } from './route-helpers.js';

mockCommonDeps();

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/semesters', '../routes/semesters.js'));
  ({ token } = await makeUser(drizzleDb));
});

describe('POST /api/semesters', () => {
  it('creates a semester', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026春季', type: '春季', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects invalid type', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: '秋季班', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid date format', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: '春季', startDate: 'not-date', endDate: '2026-06-30' });
    expect(res.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const res = await request(app).post('/api/semesters').set(auth(token))
      .send({ type: '春季', startDate: '2026-02-01', endDate: '2026-06-30' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/semesters', () => {
  it('lists semesters', async () => {
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026春季', type: '春季', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).get('/api/semesters').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('PUT /api/semesters/:id', () => {
  it('updates a semester', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '2026春季', type: '春季', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).put(`/api/semesters/${id}`).set(auth(token))
      .send({ name: '2026春季学期' });
    expect(res.status).toBe(200);
  });

  it('returns 404 for other teacher\'s semester', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: '春季', startDate: '2026-02-01', endDate: '2026-06-30' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).put(`/api/semesters/${id}`).set(auth(token2))
      .send({ name: 'hack' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/semesters/:id', () => {
  it('deletes a semester', async () => {
    const { body: { id } } = await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '学期', type: '春季', startDate: '2026-02-01', endDate: '2026-06-30' });
    const res = await request(app).delete(`/api/semesters/${id}`).set(auth(token));
    expect(res.status).toBe(200);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher\'s semesters', async () => {
    await request(app).post('/api/semesters').set(auth(token))
      .send({ name: '我的学期', type: '春季', startDate: '2026-02-01', endDate: '2026-06-30' });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/semesters').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd /home/pcz/workspace/curriculum && npx vitest run server/__tests__/routes-semesters.test.js
```

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/routes-semesters.test.js
git commit -m "test: add HTTP integration tests for semester routes"
```

---

### Task 15: holidays 路由测试

**Files:**
- Create: `server/__tests__/routes-holidays.test.js`

- [ ] **Step 1: 创建 holidays 路由测试**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { container, mockCommonDeps, setupApp, makeUser, auth } from './route-helpers.js';

mockCommonDeps();

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/holidays', '../routes/holidays.js'));
  ({ token } = await makeUser(drizzleDb));
});

describe('POST /api/holidays', () => {
  it('creates a holiday', async () => {
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects invalid date', async () => {
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: 'not-date', type: 'holiday', name: '测试' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid type', async () => {
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'vacation', name: '测试' });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate date', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'workday', name: '补班' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/holidays', () => {
  it('lists holidays', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).get('/api/holidays').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by year', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).get('/api/holidays/2026').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('PUT /api/holidays/:id', () => {
  it('updates a holiday', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).put(`/api/holidays/${id}`).set(auth(token))
      .send({ name: '新年' });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/holidays/:id', () => {
  it('deletes a holiday', async () => {
    const { body: { id } } = await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).delete(`/api/holidays/${id}`).set(auth(token));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/holidays/batch', () => {
  it('imports multiple holidays', async () => {
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: [
        { date: '2026-01-01', type: 'holiday', name: '元旦' },
        { date: '2026-05-01', type: 'holiday', name: '劳动节' },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('skips duplicates in batch', async () => {
    await request(app).post('/api/holidays').set(auth(token))
      .send({ date: '2026-01-01', type: 'holiday', name: '元旦' });
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: [
        { date: '2026-01-01', type: 'holiday', name: '元旦' },
        { date: '2026-05-01', type: 'holiday', name: '劳动节' },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('rejects non-array items', async () => {
    const res = await request(app).post('/api/holidays/batch').set(auth(token))
      .send({ items: 'not-array' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd /home/pcz/workspace/curriculum && npx vitest run server/__tests__/routes-holidays.test.js
```

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/routes-holidays.test.js
git commit -m "test: add HTTP integration tests for holiday routes"
```

---

### Task 16: pricing-tiers 路由测试

**Files:**
- Create: `server/__tests__/routes-pricing-tiers.test.js`

- [ ] **Step 1: 创建 pricing-tiers 路由测试**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { container, mockCommonDeps, setupApp, makeUser, auth } from './route-helpers.js';

mockCommonDeps();

let app, drizzleDb, token;

beforeEach(async () => {
  ({ app, drizzleDb } = await setupApp('/api/pricing-tiers', '../routes/pricing-tiers.js'));
  ({ token } = await makeUser(drizzleDb));
});

describe('POST /api/pricing-tiers', () => {
  it('creates a tier', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
  });

  it('rejects minStudents < 1', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 0, maxStudents: 3, pricePerStudentPerHour: 120 });
    expect(res.status).toBe(400);
  });

  it('rejects pricePerStudentPerHour <= 0', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/pricing-tiers', () => {
  it('lists tiers', async () => {
    await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).get('/api/pricing-tiers').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('PUT /api/pricing-tiers/:id', () => {
  it('updates a tier', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).put(`/api/pricing-tiers/${id}`).set(auth(token))
      .send({ pricePerStudentPerHour: 150 });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/pricing-tiers/:id', () => {
  it('deletes a tier', async () => {
    const { body: { id } } = await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const res = await request(app).delete(`/api/pricing-tiers/${id}`).set(auth(token));
    expect(res.status).toBe(200);
  });
});

describe('Data isolation', () => {
  it('does not show other teacher\'s tiers', async () => {
    await request(app).post('/api/pricing-tiers').set(auth(token))
      .send({ minStudents: 1, maxStudents: 3, pricePerStudentPerHour: 120 });
    const { token: token2 } = await makeUser(drizzleDb, 'user2');
    const res = await request(app).get('/api/pricing-tiers').set(auth(token2));
    expect(res.body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行全部测试**

```bash
cd /home/pcz/workspace/curriculum && npm test
```

Expected: 所有测试通过（旧 + 新）。

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/routes-pricing-tiers.test.js
git commit -m "test: add HTTP integration tests for pricing-tier routes"
```

---

## Phase 3: 组件渐进拆分

### Task 17: 抽取 useWeekNavigation Hook

**Files:**
- Create: `src/schedule/useWeekNavigation.js`
- Modify: `src/schedule/WeeklySchedule.jsx`

- [ ] **Step 1: 创建 useWeekNavigation Hook**

Create `src/schedule/useWeekNavigation.js` — 将 `WeeklySchedule.jsx` 第1-149行中与周导航相关的逻辑完整搬入：

- 常量：`TOTAL_COLS`, `BUFFER`, `INITIAL_OFFSET`
- 辅助函数：`getAllDates`, `toOffset`, `daysBetween`, `getOrientation`
- State：`orient`, `weekStart`, `allDates`, `allSchedules`
- Refs：`gridRef`, `navLockRef`, `centerRef`, `isInteractingRef`, `pendingSchedulesRef`, `visibleDaysRef`, `onSettleRef`
- Effects：resize 监听、初始数据加载、`useLayoutEffect` snap、`useSwipeNavigation`
- 函数：`navigateTo`, `navigateToWeek`, `goToThisWeek`, `safeSetSchedules`, `applyPendingSchedules`, `animateToOffset`, `snapToOffset`, `reload`

Hook 签名：接受 `{ searchParams }`，返回：
```js
{
  gridRef, weekStart, allDates, allSchedules, isMobile, visibleDays,
  navigateTo, goToThisWeek, reload,
}
```

- [ ] **Step 2: 修改 WeeklySchedule.jsx**

删除第1-149行中已搬入 Hook 的代码，改为：
```js
import useWeekNavigation from './useWeekNavigation';
// ...
const { gridRef, weekStart, allDates, allSchedules, isMobile, visibleDays,
        navigateTo, goToThisWeek, reload } = useWeekNavigation({ searchParams });
```

保留 `WeeklySchedule` 中的：dialog state、export 函数、导航栏 JSX、grid JSX。

- [ ] **Step 3: 验证周视图导航正常**

```bash
cd /home/pcz/workspace/curriculum && npm run dev
```

- [ ] **Step 4: Commit**

```bash
git add src/schedule/useWeekNavigation.js src/schedule/WeeklySchedule.jsx
git commit -m "refactor: extract useWeekNavigation hook from WeeklySchedule"
```

---

### Task 18: 抽取 useScheduleExport Hook

**Files:**
- Create: `src/schedule/useScheduleExport.js`
- Modify: `src/schedule/WeeklySchedule.jsx`

- [ ] **Step 1: 创建 useScheduleExport Hook**

从 `WeeklySchedule.jsx` 中抽取 export 相关的 state 和函数（`exporting`, `showExport`, `exportStart`, `exportEnd`, `exportPNG`, `exportCSV`, `openExport`）。

Hook 签名：接受 `{ weekStart, visibleDays }`，返回：
```js
{ exporting, showExport, exportStart, exportEnd, openExport, exportPNG, exportCSV, setShowExport }
```

- [ ] **Step 2: 修改 WeeklySchedule.jsx**

替换 export 相关代码为 Hook 调用。

- [ ] **Step 3: 验证导出按钮正常**

- [ ] **Step 4: Commit**

```bash
git add src/schedule/useScheduleExport.js src/schedule/WeeklySchedule.jsx
git commit -m "refactor: extract useScheduleExport hook from WeeklySchedule"
```

---

### Task 19: 抽取 WeekNavBar 组件

**Files:**
- Create: `src/schedule/WeekNavBar.jsx`
- Modify: `src/schedule/WeeklySchedule.jsx`

- [ ] **Step 1: 创建 WeekNavBar 组件**

从 `WeeklySchedule.jsx` 抽取导航栏 JSX（包含按钮样式 `navBtn`, `todayBtn`, `actBtn`）。

Props：`{ weekStart, visibleDays, isMobile, navigateTo, goToThisWeek, showBatch, setShowBatch, exporting, openExport }`

- [ ] **Step 2: 修改 WeeklySchedule.jsx**

替换导航栏 JSX 为 `<WeekNavBar ... />`。

- [ ] **Step 3: 验证导航栏按钮**

- [ ] **Step 4: Commit**

```bash
git add src/schedule/WeekNavBar.jsx src/schedule/WeeklySchedule.jsx
git commit -m "refactor: extract WeekNavBar component from WeeklySchedule"
```

---

### Task 20: 抽取 TimeColumn 组件

**Files:**
- Create: `src/schedule/TimeColumn.jsx`
- Modify: `src/schedule/ScheduleGrid.jsx`

- [ ] **Step 1: 创建 TimeColumn 组件**

从 `ScheduleGrid.jsx` 第202-219行抽取左侧时间刻度列。

Props：`{ HEADER_HEIGHT, displayHours, rowHeight, topGapHeight }`

- [ ] **Step 2: 修改 ScheduleGrid.jsx**

替换为 `<TimeColumn ... />`。

- [ ] **Step 3: 验证时间列显示**

- [ ] **Step 4: Commit**

```bash
git add src/schedule/TimeColumn.jsx src/schedule/ScheduleGrid.jsx
git commit -m "refactor: extract TimeColumn component from ScheduleGrid"
```

---

### Task 21: 抽取 DayHeader 组件

**Files:**
- Create: `src/schedule/DayHeader.jsx`
- Modify: `src/schedule/ScheduleGrid.jsx`

- [ ] **Step 1: 创建 DayHeader 组件**

从 `ScheduleGrid.jsx` 第235-249行抽取日期头部。内部使用 `isHoliday`, `isWorkday`, `getHolidayName`, `WEEKDAY_LABELS`, `parseDateStr`。

Props：`{ date, isToday, HEADER_HEIGHT }`

- [ ] **Step 2: 修改 ScheduleGrid.jsx**

替换为 `<DayHeader ... />`。

- [ ] **Step 3: 验证日期头部**

- [ ] **Step 4: Commit**

```bash
git add src/schedule/DayHeader.jsx src/schedule/ScheduleGrid.jsx
git commit -m "refactor: extract DayHeader component from ScheduleGrid"
```

---

### Task 22: 抽取 ScheduleBlock 组件

**Files:**
- Create: `src/schedule/ScheduleBlock.jsx`
- Modify: `src/schedule/ScheduleGrid.jsx`

- [ ] **Step 1: 创建 ScheduleBlock 组件**

从 `ScheduleGrid.jsx` 第291-353行抽取排课卡片渲染。

Props：`{ item, hasConflict, totalCols, rowHeight, topGapHeight, firstLabelMin, totalHeight, onScheduleClick }`

- [ ] **Step 2: 修改 ScheduleGrid.jsx**

替换为 `<ScheduleBlock ... />`。

- [ ] **Step 3: 验证卡片显示和点击**

- [ ] **Step 4: Commit**

```bash
git add src/schedule/ScheduleBlock.jsx src/schedule/ScheduleGrid.jsx
git commit -m "refactor: extract ScheduleBlock component from ScheduleGrid"
```

---

### Task 23: 抽取 useGridTouch Hook

**Files:**
- Create: `src/schedule/useGridTouch.js`
- Modify: `src/schedule/ScheduleGrid.jsx`

- [ ] **Step 1: 创建 useGridTouch Hook**

从 `ScheduleGrid.jsx` 抽取触摸处理：`handleDayTouchStart/Move/End`、排课卡片长按、refs `lpRef`/`schedLpRef`。

Hook 签名：接受 `{ gridStateRef, dayBodyEls, onCellClick, onScheduleClick }`，返回：
```js
{ handleDayTouchStart, handleDayTouchMove, handleDayTouchEnd, scheduleBlockTouchHandlers }
```

- [ ] **Step 2: 修改 ScheduleGrid.jsx**

替换内联触摸处理为 Hook 调用。

- [ ] **Step 3: 最终验证 — 全部测试 + 手动检查**

```bash
cd /home/pcz/workspace/curriculum && npm test
```

手动验证：周视图导航、滑动、长按创建、批量排课、导出、月视图、年视图。

- [ ] **Step 4: Commit**

```bash
git add src/schedule/useGridTouch.js src/schedule/ScheduleGrid.jsx
git commit -m "refactor: extract useGridTouch hook from ScheduleGrid"
```
