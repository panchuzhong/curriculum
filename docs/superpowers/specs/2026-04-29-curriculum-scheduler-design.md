# 私人教师课表管理系统 - 设计文档

## 概述

面向私人教师的多用户课表管理平台。教师可以管理班级、学生、排课，查看周/月/年课表。提供 REST API 供 AI Agent 访问课表并生成 PNG 图片。

## 架构

```
浏览器 / AI Agent
       │
  JWT Auth / API Key
       │
Express.js (port 8080)
├── REST API
├── 静态文件服务 (Vite 构建产物)
└── Puppeteer (PNG 渲染)
       │
Drizzle ORM + SQLite
```

- 前端：Vite + React + Tailwind CSS
- 后端：Express.js
- 数据库：SQLite (better-sqlite3)
- ORM：Drizzle ORM
- 图片生成：Puppeteer
- 部署：`npm run build && node server.js` 监听 8080 端口

## 数据模型

### teachers

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| username | TEXT UNIQUE | 用户名 |
| password_hash | TEXT | 密码哈希 |
| name | TEXT | 教师姓名 |
| api_key | TEXT UNIQUE | Agent 访问密钥 |
| created_at | DATETIME | |

### classes (班级)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| teacher_id | INTEGER FK → teachers | |
| name | TEXT | 班级名称，如 "初三数学A班" |
| grade | TEXT | 初一/初二/初三/高一/高二/高三/大学 |
| subject | TEXT | 数学/物理/化学/英语/语文/生物/历史/地理/政治 |
| student_count | INTEGER | 学生人数 |
| unit_price | REAL | 单价 (元/人/小时) |
| discount_amount | REAL | 总优惠金额，默认 0 |
| discount_reason | TEXT | 优惠原因，可为空 |
| is_competition | BOOLEAN | 是否竞赛课 |
| default_location_name | TEXT | 默认上课地点，可选 |
| default_location_lat | REAL | 默认地点纬度，可选 |
| default_location_lng | REAL | 默认地点经度，可选 |
| created_at | DATETIME | |

**定价计算**：每小时费用 = unit_price × student_count - discount_amount

**删除策略**：删除班级时不级联删除关联的学生和排课记录（数据保留，仅班级标记删除）。

### pricing_tiers (定价阶梯)

教师可自定义的阶梯定价表，新建班级时根据人数自动匹配填入 unit_price。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| teacher_id | INTEGER FK → teachers | |
| min_students | INTEGER | 最少人数 |
| max_students | INTEGER | 最多人数 |
| price_per_student_per_hour | REAL | 单价 (元/人/小时) |
| created_at | DATETIME | |

**默认值**（首次注册时自动创建）：

| min_students | max_students | 单价 |
|--------------|--------------|------|
| 1 | 1 | 800 |
| 2 | 2 | 600 |
| 3 | 3 | 500 |
| 4 | 4 | 400 |
| 5 | 999 | 200 |

### students (学生)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| class_id | INTEGER FK → classes | |
| name | TEXT | 学生姓名 |
| phone | TEXT | 电话，可选 |
| parent_phone | TEXT | 家长电话，可选 |
| note | TEXT | 备注 |
| created_at | DATETIME | |

### schedules (排课)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| class_id | INTEGER FK → classes | |
| date | DATE | 上课日期 |
| start_time | TEXT | 开始时间，如 "08:00" |
| end_time | TEXT | 结束时间，如 "10:00" |
| duration_billing | INTEGER | 计费时长（分钟），默认由 end_time - start_time 计算；手动指定时覆盖（如 2.5 小时课计费 120 分钟） |
| location_name | TEXT | 上课地点，可选 |
| location_lat | REAL | 纬度，可选 |
| location_lng | REAL | 经度，可选 |
| created_at | DATETIME | |

**说明**：
- **学期批量排课**：选择学期 + 每周几上课 → 自动生成该学期内所有排课记录，自动排除法定节假日
- **指定日期排课**：指定日期列表批量排课，适用于寒暑假、法定节假日补课等场景
- **法定节假日**：五一、端午、国庆、中秋、元旦、春节、清明等（使用中国法定节假日日历数据）
- **duration_billing**：默认由 end_time - start_time 自动计算；2.5 小时的课可以手动指定为 120 分钟
- **默认地点**：批量生成时使用班级的 default_location_name/lat/lng 填充每节课的地点
- **单次调整**：每节课可独立修改时间、地点等信息，不受批量模板影响

### semesters (学期)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| teacher_id | INTEGER FK → teachers | |
| name | TEXT | 如 "2026春季" |
| type | TEXT | spring/fall/winter/summer |
| start_date | DATE | |
| end_date | DATE | |
| created_at | DATETIME | |

## 颜色系统

### 学科颜色（固定色相）

| 学科 | 颜色 |
|------|------|
| 数学 | #1565C0 蓝色 |
| 物理 | #2E7D32 绿色 |
| 英语 | #F9A825 金色 |
| 化学 | #6A1B9A 紫色 |
| 语文 | #C62828 红色 |
| 生物 | #00838F 青色 |
| 历史 | #795548 棕色 |
| 地理 | #37474F 深灰蓝 |
| 政治 | #E65100 橙色 |

### 年级深浅（通过 HSL 亮度调整）

| 年级 | 亮度 (L) |
|------|----------|
| 初一 | 75% |
| 初二 | 68% |
| 初三 | 60% |
| 高一 | 52% |
| 高二 | 44% |
| 高三 | 36% |
| 大学 | 28% |

实现：学科决定 HSL 色相，年级决定亮度。竞赛课额外加五角星标记。

## UI 设计

### 周课表（方案 A：时间轴网格）

- 左侧时间轴（8:00-22:00，每小时一行）
- 右侧 5 列对应周一到周五
- 课程块按时间定位在网格中，rowspan 表示时长
- 不同年级/学科颜色区分
- 竞赛课显示五角星
- 2.5 小时课标注"计费2h"
- **时间冲突**：冲突课程并排显示在同一时间段内，用大红色边框/背景高亮提示，不阻止排课

### 月视图

- 日历格式，每格显示当天课程数量和颜色条
- 点击某天展开当天详细课表

### 年视图

- 12 个月缩略日历
- 每格用颜色点表示是否有课
- 点击某月跳转月视图

## API 设计

### 认证

- 前端：`POST /api/auth/login` → JWT token
- Agent：请求头 `X-API-Key: <key>`
- 注册：环境变量 `ALLOW_REGISTRATION` 控制，默认关闭

### 班级 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/classes | 获取班级列表 |
| POST | /api/classes | 创建班级（自动匹配阶梯定价） |
| PUT | /api/classes/:id | 更新班级 |
| DELETE | /api/classes/:id | 删除班级（保留关联学生和排课记录） |
| GET | /api/classes/:id/students | 获取学生列表 |
| POST | /api/classes/:id/students | 添加学生 |
| DELETE | /api/classes/:id/students/:sid | 删除学生 |

### 定价阶梯 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/pricing-tiers | 获取定价阶梯列表 |
| POST | /api/pricing-tiers | 创建阶梯 |
| PUT | /api/pricing-tiers/:id | 更新阶梯 |
| DELETE | /api/pricing-tiers/:id | 删除阶梯 |

### 课表 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/schedules?start=&end= | 获取时间段内排课 |
| POST | /api/schedules | 创建单次排课 |
| POST | /api/schedules/batch | 批量排课，支持两种模式：(1) 学期模式：class_id, semester_id, weekday, start_time, end_time；(2) 日期模式：class_id, dates[], start_time, end_time。两种模式都自动使用班级默认地点，duration_billing 默认自动计算 |
| PUT | /api/schedules/:id | 更新排课 |
| DELETE | /api/schedules/:id | 删除排课 |

### 学期 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/semesters | 获取学期列表 |
| POST | /api/semesters | 创建学期 |
| PUT | /api/semesters/:id | 更新学期 |

### 图片生成 API（Agent 专用）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/schedule-image?start=&end=&format=png | 生成课表 PNG |

### 系统 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/agent/help | 公开接口（无需认证），返回 JSON 格式的 API 使用说明，包括所有端点、参数、认证方式、示例 |
| POST | /api/auth/register | 注册 |
| GET | /api/teacher/profile | 获取个人信息 |
| PUT | /api/teacher/api-key | 重新生成 API Key |

## 认证与权限

- 教师登录：用户名 + 密码 → JWT
- Agent 认证：X-API-Key 请求头
- 注册控制：环境变量 `ALLOW_REGISTRATION=false`（默认），首次启动自动开启，注册第一个账号后自动关闭
- 数据隔离：所有 API 通过 JWT/API key 关联 teacher_id，中间件自动注入，查询自动过滤

## 项目结构

```
new_curriculum/
├── server/
│   ├── index.js          # Express 入口
│   ├── db/
│   │   ├── schema.js     # Drizzle 表定义
│   │   └── seed.js       # 初始数据
│   ├── routes/
│   │   ├── auth.js
│   │   ├── classes.js
│   │   ├── schedules.js
│   │   ├── semesters.js
│   │   ├── schedule-image.js
│   │   └── agent-help.js
│   ├── middleware/
│   │   └── auth.js       # JWT + API Key 中间件
│   └── services/
│       ├── image-gen.js  # Puppeteer 图片生成
│       └── holidays.js   # 中国法定节假日数据
├── src/                   # React 前端
│   ├── components/
│   │   ├── WeeklySchedule.jsx
│   │   ├── MonthlySchedule.jsx
│   │   ├── YearlySchedule.jsx
│   │   ├── ClassManager.jsx
│   │   └── ...
│   └── ...
├── package.json
├── vite.config.js
└── .env
```
