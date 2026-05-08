import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { drizzleDb } from '../db/index.js';
import { schedules, classes } from '../db/schema.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { generateScheduleImage } from '../services/image-gen.js';
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
      .where(and(gte(schedules.date, start), lte(schedules.date, end)))
      .all()
      .filter(s => classIds.includes(s.classId))
      .map(s => ({ ...s, class: classMap[s.classId] }));

    const buffer = await generateScheduleImage(scheds, start, end, { theme, rowH, scale, highlight });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('Image generation failed:', err);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

export default router;
