import { body } from 'express-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TYPES = ['spring', 'fall', 'summer', 'winter'];

export const validateCreateSemester = [
  body('name').notEmpty().withMessage('学期名称不能为空'),
  body('type').isIn(VALID_TYPES).withMessage(`学期类型须为: ${VALID_TYPES.join('/')}`),
  body('startDate').matches(DATE_RE).withMessage('开始日期格式须为 YYYY-MM-DD'),
  body('endDate').matches(DATE_RE).withMessage('结束日期格式须为 YYYY-MM-DD'),
];

export const validateUpdateSemester = [
  body('name').optional().notEmpty().withMessage('学期名称不能为空'),
  body('type').optional().isIn(VALID_TYPES).withMessage(`学期类型须为: ${VALID_TYPES.join('/')}`),
  body('startDate').optional().matches(DATE_RE).withMessage('开始日期格式须为 YYYY-MM-DD'),
  body('endDate').optional().matches(DATE_RE).withMessage('结束日期格式须为 YYYY-MM-DD'),
];
