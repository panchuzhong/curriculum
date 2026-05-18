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
  const existing = drizzleDb.select().from(pricingTiers)
    .where(eq(pricingTiers.teacherId, teacherId)).all();
  if (existing.length > 0) return;
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
