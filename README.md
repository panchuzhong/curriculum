# 课表管理系统

面向私人教师的单用户课表管理平台。支持周/月/年课表、班级管理、学生管理、排课、统计报表，提供 REST API 供 AI Agent 访问。

## 功能特性

### 课表管理
- **周课表**：时间轴网格，周一至周日，7:45-23:00，左右方向键切换周
- **月课表**：日历视图，课程色条按实际时间定位，点击跳转周课表，左右滑动或方向键切换月
- **年课表**：12 月概览，自动按年级/学科/竞赛分类，超限折叠，颜色与周/月课表统一，响应式布局（手机2列、桌面3列），左右方向键切换年，点击跳转月课表
- **键盘导航**（桌面端）：上/下方向键切换侧边栏页面，左/右方向键切换课表时段
- **排课冲突检测**：冲突课程并排显示，红色边框高亮
- **法定节假日标记**：节假日/调休自动标注
- **今日高亮**：当天日期蓝色标记

### 班级管理
- 创建/编辑/删除班级（软删除，排课记录保留）
- 学科、年级、人数、单价、折扣、上课地点
- 竞赛课五角星标记
- 默认阶梯定价（可自定义）

### 学生管理
- 学生可属于多个班级
- 姓名、出生日期、电话、父母信息
- 按班级筛选

### 排课
- **手动排课**：点击课表空白时段
- **批量排课**：学期模式（从今天或学期开始日期较晚者起排，按周几自动生成，自动跳过节假日）+ 日期范围模式（前端支持每天/隔天/隔两天/每周间隔自动生成日期列表，API 接收显式日期数组）
- **批量调整**：同一班级、同一星期几、指定日期起批量修改时间/地点（`PUT /api/schedules/batch`），默认跨学期保护
- **批量删课**：支持三种模式 — 按 ID 数组、按班级+起始日期（默认学期保护）、按日期范围；删除前预览数量确认
- **单次调整**：每节课可独立修改时间、地点

### 统计报表
- 周报/月报/年报/自定义日期范围，按学科、年级、班级、月份统计
- 支持按班级筛选，切换班级后所有图表联动
- 排课次数、教学时长、预估收入
- 服务端汇总接口 `GET /api/schedules/summary`，支持 `classId` 过滤、`format=csv` 导出
- 排课明细导出 `GET /api/schedules/export`，支持 `format=csv`（Excel 兼容 UTF-8 BOM）

### 操作日志
- 所有资源的增删改自动写入 audit_log（排课、班级、学生、节假日、定价阶梯、学期、教师安全操作）
- 记录操作前后数据，可按表名和操作类型查询（action: CREATE/UPDATE/DELETE/BATCH_CREATE/BATCH_UPDATE/BATCH_DELETE）

### 设置
- 学科管理（自定义学科及顺序）
- 定价阶梯管理
- 法定节假日管理（内置 2025-2027 数据，可手动修改）
- API Key 管理（供 AI Agent 使用）
- 修改密码

### 数据备份与还原
- `GET /api/backup`：导出全量数据为 JSON（班级、学生、班级-学生关联、排课、学期、节假日、定价阶梯、操作日志）
- `POST /api/backup/restore`：事务原子还原，teacherId 自动绑定当前账号防止越权

### 主题
- 深色/浅色模式切换，根据时间自动切换（19:00-7:00 暗色），侧边栏宽度可拖拽
- 课程色块按学科（色相）+年级（亮度/饱和度）自动着色，日/夜间模式自适应

## 技术栈

- **前端**：React 19 + Vite + Tailwind CSS 4
- **后端**：Express 5
- **数据库**：SQLite（better-sqlite3 + Drizzle ORM）
- **图片生成**：Puppeteer

## 快速开始

### 环境要求

- Node.js >= 18

### 安装

```bash
git clone <repo-url>
cd new_curriculum
npm install
```

### 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```env
PORT=8443                              # 服务端口（默认 8443）
HOST=127.0.0.1                         # 监听地址（默认仅本地，外网访问设为 0.0.0.0）
JWT_SECRET=your-secret-key             # JWT 密钥（请修改为随机字符串）
ALLOW_REGISTRATION=true                # 首次启动设为 true，注册后自动关闭
DB_PATH=./data/data.db                 # 数据库路径
PUPPETEER_EXECUTABLE_PATH=             # Chromium 路径（服务器部署时填写）
TZ=Asia/Shanghai                       # 服务器时区（影响 range=today 等日期计算）
```

### 开发模式

```bash
npm run dev
```

- 前端热更新：http://localhost:5173
- 后端 API：http://localhost:8443

### 生产部署

```bash
npm run build
ALLOW_REGISTRATION=true node server/index.js
```

访问 http://localhost:8443，注册第一个账号后系统自动关闭注册。

### 服务器依赖（Ubuntu）

课表图片导出功能需要 Chromium：

```bash
sudo apt-get install -y chromium-browser fonts-liberation libasound2 \
  libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
  libnspr4 libnss3 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
```

然后在 `.env` 中指定：

```env
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

### 使用发布包

```bash
chmod +x scripts/release.sh
./scripts/release.sh
tar -xzf release/curriculum-scheduler-v1.1.0.tar.gz
cd curriculum-scheduler-v1.1.0
vim .env        # 修改 JWT_SECRET
./start.sh
```

### systemd 服务

```bash
sudo cp curriculum-scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable curriculum-scheduler
sudo systemctl start curriculum-scheduler
```

## API 文档

启动后访问 `GET /api/agent/help` 获取完整机器可读 API 文档（JSON 格式）。

### 认证方式

- **JWT Token**：`POST /api/auth/login` 返回，通过 `Authorization: Bearer <token>` 传递
- **API Key**：在设置页面获取，通过 `X-API-Key: <key>` 传递，适合 AI Agent 长期使用

### 输入校验

所有写接口均使用 express-validator 校验输入，校验失败返回 `400 {error: "提示信息"}`。详细规则见 `GET /api/agent/help` 的 `validationRules` 字段。

### 写接口返回体约定

- **单资源 POST/PUT**：统一返回完整资源对象(含 `id` 与所有派生字段,如 classes 的 `isDeleted`、students 的 `classIds`、schedules 的 `class` 与 `warnings`)
- **单资源 DELETE**：返回 `{ok: true}`
- **批量端点**(`POST/PUT/DELETE /api/*/batch`、`POST /api/holidays/batch`):返回 `{count, ids?, ...}`,跨学期过滤时附加 `semesterFiltered` 与 `hint`
- **错误**:统一 HTTP 状态码 + `{error: "..."}`,前端只看状态码,不依赖 `ok` 字段

### 端点一览

**系统**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/agent/help | API 帮助文档（公开） |
| GET | /api/health | 健康检查（公开） |

**认证**
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 注册（需 ALLOW_REGISTRATION=true） |
| POST | /api/auth/login | 登录，返回 JWT token |
| GET | /api/auth/profile | 获取个人信息（含 subjects、apiKey） |
| PUT | /api/auth/password | 修改密码 |
| PUT | /api/auth/subjects | 更新学科列表 |
| PUT | /api/auth/api-key | 重新生成 API Key |

**班级**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/classes | 班级列表（不含已删除） |
| GET | /api/classes?includeDeleted=true | 全部班级（含已删除） |
| GET | /api/classes/:id | 获取单个班级详情 |
| GET | /api/classes/locations/suggest | 获取所有去重地点名称（班级+排课合并去重） |
| POST | /api/classes | 创建班级 |
| PUT | /api/classes/:id | 更新班级 |
| DELETE | /api/classes/:id | 删除班级（软删除） |
| POST | /api/classes/:id/restore | 恢复已删除的班级（deleted: true→false） |
| GET | /api/classes/:classId/students | 获取指定班级的学生列表 |
| POST | /api/classes/:classId/students | 在指定班级下创建学生并自动关联 |
| DELETE | /api/classes/:classId/students/:studentId | 从指定班级移除学生（仅解除关联） |

**学生**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/students | 所有学生（含 classIds） |
| GET | /api/students/by-class/:classId | 指定班级的学生 |
| POST | /api/students | 创建学生（可指定 classIds） |
| PUT | /api/students/:id | 更新学生 |
| DELETE | /api/students/:id | 删除学生 |

**排课**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/schedules?start=&end= | 获取日期范围内排课（含班级信息） |
| GET | /api/schedules?range=today\|tomorrow\|week\|month | 快捷范围查询 |
| GET | /api/schedules?start=&end=&classId= | 按班级过滤 |
| GET | /api/schedules/:id | 获取单条排课详情 |
| POST | /api/schedules | 创建单次排课，返回完整对象 |
| PUT | /api/schedules/:id | 更新排课，返回完整对象 |
| DELETE | /api/schedules/:id | 删除单条排课 |
| DELETE | /api/schedules/batch | 批量删除（byIds / byClassId+fromDate / byDateRange 三种模式） |
| POST | /api/schedules/batch | 批量创建（学期模式/日期模式） |
| PUT | /api/schedules/batch | 批量调整时间/地点（同班级同星期几，指定日期起） |
| GET | /api/schedules/summary?start=&end= | 课时与收入汇总统计（可加 &classId= &format=csv） |
| GET | /api/schedules/export?start=&end= | 排课明细导出（可加 &classId= &format=csv） |
| GET | /api/schedules/free-slots?date= | 查询单日空闲时段（可加 after=&before= 限制时段） |
| GET | /api/schedules/free-slots?start=&end= | 查询多日空闲时段（可加 after=&before=） |
| GET | /api/schedules/conflicts | 查询冲突排课分组（可加 start=&end=&limit=） |

**学期**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/semesters | 学期列表 |
| POST | /api/semesters | 创建学期 |
| PUT | /api/semesters/:id | 更新学期 |
| DELETE | /api/semesters/:id | 删除学期 |

**节假日**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/holidays | 所有节假日记录 |
| GET | /api/holidays/:year | 指定年份节假日 |
| POST | /api/holidays | 添加节假日/调休 |
| POST | /api/holidays/batch | 批量导入 |
| PUT | /api/holidays/:id | 更新 |
| DELETE | /api/holidays/:id | 删除 |

**定价阶梯**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/pricing-tiers | 定价阶梯列表 |
| POST | /api/pricing-tiers | 创建阶梯 |
| PUT | /api/pricing-tiers/:id | 更新阶梯 |
| DELETE | /api/pricing-tiers/:id | 删除阶梯 |

**图片**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/schedule-image?start=&end= | 生成周课表 PNG；theme=light\|dark\|auto（默认 auto）；rowH=16-60（默认 40）；scale=0.25-3（默认 2）；highlight=YYYY-MM-DD |
| GET | /api/schedule-image/monthly?year=&month= | 生成月课表日历网格 PNG；month=0-11（0=1月）；支持 endYear/endMonth 导出多个月份 |
| GET | /api/schedule-image/yearly?year= | 生成年课表概览 PNG（12 月卡片 + 年度统计）；支持 endYear 导出多个年份 |

**操作日志**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/audit-log | 查询操作日志，支持 limit / table / action 过滤（action: CREATE/UPDATE/DELETE/BATCH_CREATE/BATCH_UPDATE/BATCH_DELETE） |

**备份**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/backup | 导出全量数据 JSON |
| POST | /api/backup/restore | 从 JSON 原子还原（事务，teacherId 强制绑定） |

### 批量排课

**学期模式**（自动跳过节假日）：
```json
POST /api/schedules/batch
{
  "classId": 1,
  "semesterId": 1,
  "weekday": 1,
  "startTime": "08:00",
  "endTime": "10:00"
}
```

**日期模式**：
```json
POST /api/schedules/batch
{
  "classId": 1,
  "dates": ["2026-07-01", "2026-07-08", "2026-07-15"],
  "startTime": "09:00",
  "endTime": "11:00"
}
```

### 批量删课

**按 ID 数组**：
```json
DELETE /api/schedules/batch
{"ids": [10, 11, 12]}
```
返回 `{"count": 3, "ids": [10, 11, 12]}`

**按班级+起始日期（默认学期保护）**：
```json
DELETE /api/schedules/batch
{"classId": 1, "fromDate": "2026-05-11"}
```
仅删除 `date >= fromDate` 的排课；`semesterOnly` 默认 `true`，跨学期时自动过滤并返回 `semesterFiltered` 和 `hint`。设为 `false` 绕过学期限制。

**按日期范围（可附加 classId）**：
```json
DELETE /api/schedules/batch
{"classId": 1, "start": "2026-05-01", "end": "2026-05-31"}
```

### 批量调整排课

修改同一班级在指定范围内课程的时间或地点：

```json
PUT /api/schedules/batch
{
  "classId": 1,
  "fromDate": "2026-05-01",
  "weekday": 6,
  "semesterOnly": true,
  "updates": { "startTime": "14:00", "endTime": "16:00" }
}
```

- `classId`（必填）：班级 ID
- `fromDate`（可选）：YYYY-MM-DD，只修改该日期及之后的课
- `weekday`（可选）：0=周日，1=周一…6=周六；省略时匹配所有星期几
- `fromDate` 与 `weekday` 至少传一个,防止误改全部
- `semesterOnly`（默认 `true`）：跨学期保护开关。**仅在候选记录跨学期(部分在内、部分在外)时生效**,过滤掉学期外的部分；全部在学期内或全部在学期外时本参数不影响结果。设为 `false` 强制不过滤
- `updates` 只允许：`startTime`, `endTime`, `durationBilling`, `locationName`, `locationLat`, `locationLng`
- 修改时间时自动重算 `durationBilling`
- 跨学期被过滤时返回体附加 `semesterFiltered`(过滤数量)与 `hint`(提示文案)

### 导出排课明细

```
GET /api/schedules/export?start=2026-05-01&end=2026-05-31
GET /api/schedules/export?start=2026-05-01&end=2026-05-31&format=csv
```

JSON 格式含完整班级信息（`class` 字段）；CSV 含中文列头、星期中文名、UTF-8 BOM（Excel 直接打开不乱码）。

### 备份与还原

```bash
# 导出
curl -H "X-API-Key: <key>" http://localhost:8443/api/backup -o backup.json

# 还原
curl -X POST -H "X-API-Key: <key>" -H "Content-Type: application/json" \
  http://localhost:8443/api/backup/restore -d @backup.json
```

还原为事务原子操作：先删除当前教师所有数据，再按原 ID 重新写入。还原时 `teacherId` 强制覆盖为当前认证账号。

### 汇总统计响应示例

```json
GET /api/schedules/summary?start=2026-05-01&end=2026-05-31

{
  "count": 12,
  "hours": 24.0,
  "revenue": 10800,
  "byClass": [
    {"classId": 1, "name": "高三甲", "subject": "数学", "grade": "高三",
     "count": 8, "hours": 16, "revenue": 7200}
  ],
  "bySubject": [{"subject": "数学", "count": 8, "hours": 16, "revenue": 7200}],
  "byGrade":   [{"grade": "高三",  "count": 8, "hours": 16, "revenue": 7200}]
}
```

收入计算公式：`(unitPrice × studentCount - discountAmount) × (durationBilling / 60)`

## 项目结构

```
new_curriculum/
├── server/
│   ├── index.js                  # Express 入口，注册所有路由
│   ├── db/
│   │   ├── schema.js             # Drizzle ORM 表定义
│   │   └── index.js              # DB 连接、建表、迁移
│   ├── middleware/
│   │   └── auth.js               # JWT + API Key 双模式认证
│   ├── routes/
│   │   ├── auth.js               # 认证
│   │   ├── classes.js            # 班级
│   │   ├── students.js           # 学生
│   │   ├── schedules.js          # 排课（含 summary、export、free-slots、batch、range）
│   │   ├── semesters.js          # 学期
│   │   ├── holidays.js           # 节假日
│   │   ├── pricing-tiers.js      # 定价阶梯
│   │   ├── schedule-image.js     # PNG 图片生成（支持 theme/rowH/scale/highlight）
│   │   ├── audit-log.js          # 操作日志查询
│   │   ├── backup.js             # 全量备份与还原
│   │   └── agent-help.js         # AI Agent 帮助文档
│   ├── validations/              # express-validator 校验规则
│   │   ├── handle.js             # 统一校验结果中间件
│   │   ├── auth.js               # 认证校验
│   │   ├── classes.js            # 班级校验
│   │   ├── students.js           # 学生校验
│   │   ├── schedules.js          # 排课校验
│   │   ├── semesters.js          # 学期校验
│   │   ├── holidays.js           # 节假日校验
│   │   └── pricing-tiers.js      # 定价阶梯校验
│   ├── __tests__/                # vitest 集成测试（supertest HTTP 测试 + 单元测试）
│   └── services/
│       ├── holidays.js           # 节假日数据与查询
│       ├── browser.js            # Puppeteer 浏览器单例（复用）
│       ├── image-gen.js          # Puppeteer 周课表 PNG 渲染
│       ├── image-gen-monthly.js  # Puppeteer 月课表 PNG 渲染
│       ├── image-gen-yearly.js   # Puppeteer 年课表 PNG 渲染
│       ├── schedule-helpers.js   # 排课业务逻辑（冲突检测、批量操作）
│       └── audit.js              # 操作日志写入
├── src/                          # React 前端
│   ├── App.jsx                   # 路由
│   ├── api.js                    # 统一 fetch 封装（含 JWT 注入）
│   ├── components/               # 通用组件（Layout 布局）
│   ├── hooks/                    # 自定义 Hooks（useSwipeNavigation, useSimpleSwipe）
│   ├── auth/                     # 登录 / 注册页
│   ├── classes/                  # 班级管理、学生管理
│   ├── schedule/                 # 周/月/年课表、排课弹窗、批量操作、导出
│   ├── pricing/                  # 阶梯定价管理
│   ├── reports/                  # 统计报表
│   ├── settings/                 # 设置（节假日、学科、API Key）
│   └── utils/                    # 颜色、常量、日期、节假日工具
├── scripts/release.sh            # 构建打包脚本
├── .env.example                  # 环境变量模板
└── README.md
```

## 数据库表

| 表 | 说明 |
|---|---|
| teachers | 教师账号，含 API Key、学科列表 |
| classes | 班级（软删除），含学科/年级/定价/地点 |
| students | 学生档案 |
| class_students | 学生-班级多对多关联 |
| schedules | 排课记录，含时间/地点/计费时长 |
| semesters | 学期定义，用于批量排课 |
| holidays | 法定节假日与调休记录 |
| pricing_tiers | 阶梯定价规则 |
| audit_log | 操作日志，记录增删改的前后数据 |

## 数据备份

**文件层备份：**
```bash
cp data/data.db data/data.db.backup.$(date +%Y%m%d)
```

**API 备份（含还原）：**
```bash
# 导出
curl -H "X-API-Key: <key>" http://localhost:8443/api/backup -o backup.json
# 还原
curl -X POST -H "X-API-Key: <key>" -H "Content-Type: application/json" \
  http://localhost:8443/api/backup/restore -d @backup.json
```

## License

MIT
