# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

## 八荣八耻
- 以瞎猜接口为耻，以认真查询为荣！
- 以模糊执行为耻，以寻求确认为荣！
- 以臆想业务为耻，以人类确认为荣！
- 以创造接口为耻，以复用现有为荣！
- 以跳过验证为耻，以主动测试为荣！
- 以破坏架构为耻，以遵循规范为荣！
- 以假装理解为耻，以诚实无知为荣！
- 以盲目修改为耻，以谨慎重构为荣！

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Project: 课表管理系统 (Curriculum Scheduler)

**Stack:** React 19 + Vite + Tailwind CSS, Express 5, SQLite + Drizzle ORM
**Testing:** Vitest (unit), Playwright (E2E)
**Tests:** `npm test` (Vitest), `npx playwright test` (E2E)
**Dev:** `npm run dev` (Vite `:5174` + Express `:8443` concurrently)
**DB:** `server/db/index.js` (initDb), `server/db/schema.js` (Drizzle schema)

**Key patterns:**
- Server routes in `server/routes/` with auth middleware and validation
- React views in `src/schedule/` for week/month/year schedules
- Cross-view navigation: `src/utils/viewDate.js` (per-view store), `src/utils/navTarget.js` (tested pure function)
- Class detail tabs in `src/classes/ClassList.jsx`: 基本信息 / 定价历史 / 排课历史; the schedule-history default date range comes from `src/utils/semesterRange.js` (tested pure function)
- Date inputs: every `<input type="date">` carries `min={DATE_MIN} max={DATE_MAX}` from `src/utils/constants.js` — the native year segment never auto-advances and accepts 5+ digit years without a `max`; `src/utils/__tests__/dateInputs.test.js` fails if a new one is added without them
- Keyboard shortcuts: ArrowUp/Down (cycle sidebar nav links), Home (go to current week/month/year), ArrowLeft/Right (navigate periods), Ctrl+Arrow (jump by visible days in weekly view)
- Animation: CSS custom properties `--day-offset`/`--day-transition` on grid element

**Key subsystems:**
- Image generation: `server/services/image-gen.js` (weekly), `image-gen-monthly.js`, `image-gen-yearly.js` — Puppeteer screenshots
- Browser singleton: `server/services/browser.js` — shared Puppeteer instance
- Geocoding: `server/services/geocode.js`, `server/routes/geocode.js` — AMap API proxy
- Audit logging: `server/services/audit.js` — change tracking with before/after snapshots
- Backup/restore: `server/routes/backup.js` — JSON export/import with pre-restore snapshots
- Report cache: `server/services/report-cache.js` — in-memory cache for report generation
- Pricing history: `classPricing` table, `server/routes/classes.js` `/pricing` sub-routes
- Holidays: `server/services/holidays.js` (lookup helpers), `server/routes/holidays.js` (CRUD + batch import), `server/validations/holidays.js`
- Schedule helpers: `server/services/schedule-helpers.js` — date resolution, CSV export
- Agent help: `server/routes/agent-help.js` — machine-readable API docs
- Authentication: `server/routes/auth.js`, `src/auth/` — JWT + API key, login/register flows
- Student management: `server/routes/students.js`, `src/classes/StudentList.jsx` — CRUD with many-to-many class associations
- Semester management: `server/routes/semesters.js`, `src/schedule/SemesterManager.jsx` — CRUD for batch scheduling date ranges
- Pricing tiers: `server/routes/pricing-tiers.js`, `src/pricing/PricingTierManager.jsx` — per-teacher tiered pricing by student count
- Audit log viewing: `server/routes/audit-log.js` — query/cleanup endpoints for the audit trail
- Schedule image route: `server/routes/schedule-image.js` — serves weekly/monthly/yearly PNG generation

