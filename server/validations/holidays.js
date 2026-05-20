import { body } from 'express-validator';
import { isValidDate } from './dates.js';

const VALID_TYPES = ['holiday', 'workday'];

export const validateCreateHoliday = [
  body('date').custom(v => { if (!isValidDate(v)) throw new Error('日期格式须为有效的 YYYY-MM-DD'); return true; }),
  body('type').isIn(VALID_TYPES).withMessage('类型须为 holiday 或 workday'),
  body('name').notEmpty().withMessage('名称不能为空'),
];

export const validateUpdateHoliday = [
  body('date').optional().custom(v => { if (!isValidDate(v)) throw new Error('日期格式须为有效的 YYYY-MM-DD'); return true; }),
  body('type').optional().isIn(VALID_TYPES).withMessage('类型须为 holiday 或 workday'),
  body('name').optional().notEmpty().withMessage('名称不能为空'),
];

export const validateBatchHolidays = [
  body('items').isArray({ max: 365 }).withMessage('items 须为数组,最多 365 项'),
];
