import { body } from 'express-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export const validateCreateSchedule = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('date').matches(DATE_RE).withMessage('日期格式须为 YYYY-MM-DD'),
  body('startTime').matches(TIME_RE).withMessage('开始时间格式须为 HH:MM'),
  body('endTime').matches(TIME_RE).withMessage('结束时间格式须为 HH:MM'),
  body('durationBilling').optional().isInt({ min: 0 }).withMessage('durationBilling 须为非负整数'),
];

export const validateBatchCreate = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('startTime').matches(TIME_RE).withMessage('开始时间格式须为 HH:MM'),
  body('endTime').matches(TIME_RE).withMessage('结束时间格式须为 HH:MM'),
  body('dates').optional().isArray({ max: 365 }).withMessage('dates 须为数组,最多 365 项'),
  body('dates.*').optional().matches(DATE_RE).withMessage('日期格式须为 YYYY-MM-DD'),
  body('weekday').optional().isInt({ min: 0, max: 6 }).withMessage('weekday 须为0-6'),
  body('semesterId').optional().isInt({ min: 1 }).withMessage('semesterId 须为正整数'),
  body('durationBilling').optional().isInt({ min: 0 }).withMessage('durationBilling 须为非负整数'),
];

export const validateBatchUpdate = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('fromDate').optional().matches(DATE_RE).withMessage('fromDate 格式须为 YYYY-MM-DD'),
  body('weekday').optional().isInt({ min: 0, max: 6 }).withMessage('weekday 须为0-6'),
  body('updates').isObject().withMessage('updates 须为对象'),
];

export const validateBatchDelete = [
  body('ids').optional().isArray().withMessage('ids 须为数组'),
  body('ids.*').optional().isInt({ min: 1 }).withMessage('ids 元素须为正整数'),
  body('classId').optional().isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('start').optional().matches(DATE_RE).withMessage('start 格式须为 YYYY-MM-DD'),
  body('end').optional().matches(DATE_RE).withMessage('end 格式须为 YYYY-MM-DD'),
];

export const validateUpdateSchedule = [
  body('classId').optional().isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('date').optional().matches(DATE_RE).withMessage('日期格式须为 YYYY-MM-DD'),
  body('startTime').optional().matches(TIME_RE).withMessage('开始时间格式须为 HH:MM'),
  body('endTime').optional().matches(TIME_RE).withMessage('结束时间格式须为 HH:MM'),
  body('durationBilling').optional().isInt({ min: 0 }).withMessage('durationBilling 须为非负整数'),
];
