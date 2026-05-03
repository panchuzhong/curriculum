import { body } from 'express-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export const validateCreateSchedule = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('date').matches(DATE_RE).withMessage('日期格式须为 YYYY-MM-DD'),
  body('startTime').matches(TIME_RE).withMessage('开始时间格式须为 HH:MM'),
  body('endTime').matches(TIME_RE).withMessage('结束时间格式须为 HH:MM'),
];

export const validateBatchCreate = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('startTime').matches(TIME_RE).withMessage('开始时间格式须为 HH:MM'),
  body('endTime').matches(TIME_RE).withMessage('结束时间格式须为 HH:MM'),
  body('dates').optional().isArray().withMessage('dates 须为数组'),
  body('dates.*').optional().matches(DATE_RE).withMessage('日期格式须为 YYYY-MM-DD'),
  body('weekday').optional().isInt({ min: 0, max: 6 }).withMessage('weekday 须为0-6'),
  body('semesterId').optional().isInt({ min: 1 }).withMessage('semesterId 须为正整数'),
];

export const validateBatchUpdate = [
  body('classId').isInt({ min: 1 }).withMessage('classId 须为正整数'),
  body('updates').isObject().withMessage('updates 须为对象'),
];

export const validateBatchDelete = [
  body('ids').optional().isArray().withMessage('ids 须为数组'),
];
