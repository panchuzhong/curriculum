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
  body('name').optional().notEmpty().withMessage('名称不能为空'),
];

export const validateBatchHolidays = [
  body('items').isArray({ max: 365 }).withMessage('items 须为数组,最多 365 项'),
];
