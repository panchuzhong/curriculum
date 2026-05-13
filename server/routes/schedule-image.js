import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { drizzleDb } from '../db/index.js';
import { schedules, classes, holidays } from '../db/schema.js';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { generateScheduleImage } from '../services/image-gen.js';
import { generateMonthlyImage } from '../services/image-gen-monthly.js';
import { generateYearlyImage } from '../services/image-gen-yearly.js';
import { resolveRange } from '../services/schedule-helpers.js';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const { theme, rowH, scale, highlight } = req.query;
    const { start, end } = resolveRange(req.query);
    if (!start || !end) return res.status(400).json({ error: 'start/end or range required' });

    const teacherClasses = drizzleDb.select().from(classes)
      .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
    const classIds = teacherClasses.map(c => c.id);
    if (classIds.length === 0) return res.status(404).json({ error: 'No classes' });

    const classMap = {};
    teacherClasses.forEach(c => classMap[c.id] = c);

    const scheds = drizzleDb.select().from(schedules)
      .where(and(gte(schedules.date, start), lte(schedules.date, end), inArray(schedules.classId, classIds)))
      .all()
      .map(s => ({ ...s, class: classMap[s.classId] }));

    const dbHolidays = drizzleDb.select().from(holidays)
      .where(eq(holidays.teacherId, req.teacherId)).all();

    const buffer = await generateScheduleImage(scheds, start, end, { theme, rowH, scale, highlight, dbHolidays });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('Image generation failed:', err);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

// GET /api/schedule-image/monthly?year=2026&month=5&endYear=2026&endMonth=8&theme=auto
router.get('/monthly', async (req, res) => {
  try {
    const year = parseInt(req.query.year);
    const month = parseInt(req.query.month);
    if (isNaN(year) || isNaN(month) || month < 0 || month > 11)
      return res.status(400).json({ error: 'year and month (0-11) required' });

    const endYear = req.query.endYear != null ? parseInt(req.query.endYear) : null;
    const endMonth = req.query.endMonth != null ? parseInt(req.query.endMonth) : null;
    const theme = req.query.theme;

    const teacherClasses = drizzleDb.select().from(classes)
      .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
    const classIds = teacherClasses.map(c => c.id);
    if (classIds.length === 0) return res.status(404).json({ error: 'No classes' });

    const classMap = {};
    teacherClasses.forEach(c => classMap[c.id] = c);

    // Query schedules for the full range
    const ey = endYear != null ? endYear : year;
    const em = endMonth != null ? endMonth : month;
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(ey, em + 1, 0).getDate();
    const endDate = `${ey}-${String(em + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const scheds = drizzleDb.select().from(schedules)
      .where(and(gte(schedules.date, startDate), lte(schedules.date, endDate), inArray(schedules.classId, classIds)))
      .all()
      .map(s => ({ ...s, class: classMap[s.classId] }));

    const dbHolidays = drizzleDb.select().from(holidays)
      .where(eq(holidays.teacherId, req.teacherId)).all();

    const buffer = await generateMonthlyImage(scheds, year, month, { theme, dbHolidays, endYear: ey, endMonth: em });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('Monthly image generation failed:', err);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

// GET /api/schedule-image/yearly?year=2026&endYear=2027&theme=auto
router.get('/yearly', async (req, res) => {
  try {
    const year = parseInt(req.query.year);
    if (isNaN(year)) return res.status(400).json({ error: 'year required' });

    const endYear = req.query.endYear != null ? parseInt(req.query.endYear) : null;
    const theme = req.query.theme;

    const teacherClasses = drizzleDb.select().from(classes)
      .where(and(eq(classes.teacherId, req.teacherId), eq(classes.deleted, false))).all();
    const classIds = teacherClasses.map(c => c.id);
    if (classIds.length === 0) return res.status(404).json({ error: 'No classes' });

    const classMap = {};
    teacherClasses.forEach(c => classMap[c.id] = c);

    const ey = endYear != null ? endYear : year;
    const scheds = drizzleDb.select().from(schedules)
      .where(and(gte(schedules.date, `${year}-01-01`), lte(schedules.date, `${ey}-12-31`), inArray(schedules.classId, classIds)))
      .all()
      .map(s => ({ ...s, class: classMap[s.classId] }));

    const buffer = await generateYearlyImage(scheds, year, { theme, endYear: ey });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('Yearly image generation failed:', err);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

export default router;
