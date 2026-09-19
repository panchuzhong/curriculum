import { body } from 'express-validator';
import { isValidDate, DATE_RANGE_SUFFIX } from './dates.js';

// withMessage() 只管紧挨着它的那一个校验器：整条链末尾挂一句话的话，前面那些
// 校验器失败时报的是默认文案「Invalid value」，而空值、非字符串正是最常见的出错方式。
const VALID_TYPES = ['holiday', 'workday'];

export const validateCreateHoliday = [
  body('date').custom(v => { if (!isValidDate(v)) throw new Error(`日期格式须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`); return true; }),
  body('type').isIn(VALID_TYPES).withMessage('类型须为 holiday 或 workday'),
  body('name').isString().withMessage('名称不能为空').bail().trim().notEmpty().withMessage('名称不能为空').isLength({ max: 100 }).withMessage('名称不能为空'),
];

export const validateUpdateHoliday = [
  body('date').optional().custom(v => { if (!isValidDate(v)) throw new Error(`日期格式须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`); return true; }),
  body('type').optional().isIn(VALID_TYPES).withMessage('类型须为 holiday 或 workday'),
  body('name').optional().isString().withMessage('名称不能为空').bail().trim().notEmpty().withMessage('名称不能为空').isLength({ max: 100 }).withMessage('名称不能为空'),
];

export const validateBatchHolidays = [
  body('items').isArray({ max: 365 }).withMessage('items 须为数组,最多 365 项'),
  body('items.*.date').custom(v => { if (!isValidDate(v)) throw new Error(`日期格式须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`); return true; }),
  body('items.*.type').isIn(VALID_TYPES).withMessage('类型须为 holiday 或 workday'),
  body('items.*.name').optional().isString().withMessage('名称最多100个字符').bail().isLength({ max: 100 }).withMessage('名称最多100个字符'),
];
