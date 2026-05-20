import { body } from 'express-validator';
import { isValidDate, isValidTime } from './dates.js';

export const validateCreateSchedule = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('date').custom(v => { if (!isValidDate(v)) throw new Error('日期格式须为有效的 YYYY-MM-DD'); return true; }),
  body('startTime').custom(v => { if (!isValidTime(v)) throw new Error('开始时间须为有效的 HH:MM (00:00-23:59)'); return true; }),
  body('endTime').custom(v => { if (!isValidTime(v)) throw new Error('结束时间须为有效的 HH:MM (00:00-23:59)'); return true; }),
  body('durationBilling').optional().isInt({ min: 0 }).withMessage('durationBilling 须为非负整数'),
];

export const validateBatchCreate = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('startTime').custom(v => { if (!isValidTime(v)) throw new Error('开始时间须为有效的 HH:MM (00:00-23:59)'); return true; }),
  body('endTime').custom(v => { if (!isValidTime(v)) throw new Error('结束时间须为有效的 HH:MM (00:00-23:59)'); return true; }),
  body('dates').optional().isArray({ max: 365 }).withMessage('dates 须为数组,最多 365 项'),
  body('dates.*').optional().custom(v => { if (!isValidDate(v)) throw new Error('日期格式须为有效的 YYYY-MM-DD'); return true; }),
  body('weekday').optional().isInt({ min: 0, max: 6 }).withMessage('weekday 须为0-6'),
  body('semesterId').optional().isInt({ min: 1 }).withMessage('semesterId 须为正整数'),
  body('durationBilling').optional().isInt({ min: 0 }).withMessage('durationBilling 须为非负整数'),
  body('preview').optional().isBoolean().withMessage('preview 须为布尔值'),
];

export const validateBatchUpdate = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('fromDate').optional().custom(v => { if (!isValidDate(v)) throw new Error('fromDate 格式须为有效的 YYYY-MM-DD'); return true; }),
  body('toDate').optional().custom(v => { if (!isValidDate(v)) throw new Error('toDate 格式须为有效的 YYYY-MM-DD'); return true; }),
  body('weekday').optional().isInt({ min: 0, max: 6 }).withMessage('weekday 须为0-6'),
  body('semesterOnly').optional().isBoolean().withMessage('semesterOnly 须为布尔值'),
  body('updates').isObject().withMessage('updates 须为对象'),
];

export const validateBatchDelete = [
  body('ids').optional().isArray({ max: 500 }).withMessage('ids 最多 500 项'),
  body('ids.*').optional().isInt({ min: 1 }).withMessage('ids 元素须为正整数'),
  body('classId').optional().isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('start').optional().custom(v => { if (!isValidDate(v)) throw new Error('start 格式须为有效的 YYYY-MM-DD'); return true; }),
  body('end').optional().custom(v => { if (!isValidDate(v)) throw new Error('end 格式须为有效的 YYYY-MM-DD'); return true; }),
  body('fromDate').optional().custom(v => { if (!isValidDate(v)) throw new Error('fromDate 格式须为有效的 YYYY-MM-DD'); return true; }),
  body('semesterOnly').optional().isBoolean().withMessage('semesterOnly 须为布尔值'),
  body('dryRun').optional().isBoolean().withMessage('dryRun 须为布尔值'),
];

export const validateUpdateSchedule = [
  body('classId').optional().isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('date').optional().custom(v => { if (!isValidDate(v)) throw new Error('日期格式须为有效的 YYYY-MM-DD'); return true; }),
  body('startTime').optional().custom(v => { if (!isValidTime(v)) throw new Error('开始时间须为有效的 HH:MM (00:00-23:59)'); return true; }),
  body('endTime').optional().custom(v => { if (!isValidTime(v)) throw new Error('结束时间须为有效的 HH:MM (00:00-23:59)'); return true; }),
  body('durationBilling').optional().isInt({ min: 0 }).withMessage('durationBilling 须为非负整数'),
];
