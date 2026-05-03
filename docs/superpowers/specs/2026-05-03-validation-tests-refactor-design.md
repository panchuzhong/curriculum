# 输入校验 + 路由测试 + 组件拆分 设计文档

## 概述

三项改进，按顺序推进：输入校验 → 全路由 HTTP 测试 → 组件渐进拆分。

---

## 一、express-validator 输入校验

### 新增目录结构

```
server/validations/
  auth.js
  classes.js
  students.js
  schedules.js
  semesters.js
  holidays.js
  pricing-tiers.js
```

### 使用方式

每个文件导出校验 chain 数组。路由中引入：

```js
import { validateCreateClass } from '../validations/classes.js';
router.post('/', authenticate, validateCreateClass, async (req, res) => { ... });
```

新增统一校验结果中间件，校验失败返回 `{ "error": "字段错误信息" }`，与现有错误格式一致。

### 校验规则

**auth.js**
- 注册：username 3-20字符字母数字、password ≥6位、name 非空、subjects 数组元素为字符串
- 登录：username/password 非空
- 改密码：oldPassword/newPassword 非空、newPassword ≥6位

**classes.js**
- 创建：name 非空、grade 枚举(初一/初二/初三/高一/高二/高三/大学)、subject 非空、studentCount ≥1 正整数
- 更新：unitPrice > 0（如提供）、discountAmount ≥ 0（如提供）

**students.js**
- 创建/更新：name 非空、phone 手机号格式（如提供）、birthDate YYYY-MM-DD（如提供）、classIds 数组（如提供）

**schedules.js**
- 创建：classId 正整数、date YYYY-MM-DD、startTime/endTime HH:MM、endTime > startTime
- 批量：dates 数组且元素为 YYYY-MM-DD、weekday 0-6（如提供）

**semesters.js**
- 创建/更新：name 非空、type 枚举(春季/秋季/暑假/寒假)、startDate/endDate YYYY-MM-DD、startDate ≤ endDate

**holidays.js**
- 创建：date YYYY-MM-DD、type 枚举(holiday/workday)、name 非空
- 批量：items 数组且每项有 date + type

**pricing-tiers.js**
- 创建/更新：minStudents ≤ maxStudents、minStudents ≥1、pricePerStudentPerHour > 0

### 错误响应

校验失败统一返回 400：
```json
{ "error": "date 必须是 YYYY-MM-DD 格式" }
```
只返回第一个错误，不暴露所有校验规则。

---

## 二、supertest 全路由 HTTP 测试

### 新增/修改文件

```
server/__tests__/
  setup.js              # 现有，不改动
  helpers.js            # 新增：createTestApp()、login()、authHeader()
  auth.test.js          # 新增
  classes.test.js       # 新增
  students.test.js      # 新增
  schedules.test.js     # 新增
  semesters.test.js     # 新增
  holidays.test.js      # 新增
  pricing-tiers.test.js # 新增
  api.test.js           # 现有，不改动
  holidays.test.js      # 现有，不改动
  whitelist.test.js     # 现有，不改动
```

### helpers.js 提供

- `createTestApp()` — 创建 Express app、初始化内存数据库、挂载所有路由
- `login(request)` — 注册测试用户并登录，返回 token
- `authHeader(token)` — 返回 `{ Authorization: 'Bearer <token>' }`

### 每个路由测试覆盖

1. **正常 CRUD** — 创建、读取列表、读取单个、更新、删除
2. **校验失败** — 必填缺失 → 400、非法格式 → 400
3. **认证失败** — 无 token → 401、无效 token → 401
4. **数据隔离** — 不同用户不能操作对方数据

### 测试数据库

复用现有 setup.js 的内存 SQLite 方案，每个测试文件独立 `beforeEach` 初始化。

---

## 三、组件渐进拆分

### 原则

- 不改外部接口（其他页面引用方式不变）
- 不引入新状态管理库
- 每次只拆一个关注点

### WeeklySchedule 拆分（302行 → ~100行主容器）

```
src/schedule/
  WeeklySchedule.jsx       # 精简后的主容器
  useWeekNavigation.js     # 新增 Hook：weekStart、allDates、center、滑动逻辑
  useScheduleExport.js     # 新增 Hook：导出状态和函数
  WeekNavBar.jsx           # 新增组件：顶部导航栏 UI
```

### ScheduleGrid 拆分（366行 → ~150行主容器）

```
src/schedule/
  ScheduleGrid.jsx         # 精简后的网格容器
  TimeColumn.jsx           # 新增组件：左侧时间刻度列
  DayHeader.jsx            # 新增组件：顶部日期头部
  ScheduleBlock.jsx        # 新增组件：单个排课卡片
  useGridTouch.js          # 新增 Hook：长按/触摸交互
```

### 不做的事

- 不改 MonthlySchedule、ScheduleDialog、BatchScheduleDialog
- 不引入 Context 或全局状态管理
- 不改 props 接口
