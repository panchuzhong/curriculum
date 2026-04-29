import { Router } from 'express';
import { drizzleDb } from '../db/index.js';
import { schedules, classes, semesters } from '../db/schema.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { isHoliday } from '../services/holidays.js';

const router = Router();
router.use(authMiddleware);

function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

    const current = new Date(semester.startDate + 'T00:00:00');
    const end = new Date(semester.endDate + 'T00:00:00');
    while (current <= end) {
      const dateStr = toLocalDateStr(current);
      if (current.getDay() === weekday && !isHoliday(dateStr)) {
        targetDates.push(dateStr);
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
