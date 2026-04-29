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
