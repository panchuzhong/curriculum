import { body } from 'express-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

export const validateCreateStudent = [
  body('name').notEmpty().withMessage('姓名不能为空'),
  body('birthDate').optional().matches(DATE_RE).withMessage('出生日期格式须为 YYYY-MM-DD'),
  body('phone').optional().matches(PHONE_RE).withMessage('手机号格式不正确'),
  body('parentPhone').optional().matches(PHONE_RE).withMessage('家长手机号格式不正确'),
  body('classIds').optional().isArray().withMessage('classIds 须为数组'),
];

export const validateUpdateStudent = [
  body('name').optional().notEmpty().withMessage('姓名不能为空'),
  body('birthDate').optional().matches(DATE_RE).withMessage('出生日期格式须为 YYYY-MM-DD'),
  body('phone').optional().matches(PHONE_RE).withMessage('手机号格式不正确'),
  body('parentPhone').optional().matches(PHONE_RE).withMessage('家长手机号格式不正确'),
  body('classIds').optional().isArray().withMessage('classIds 须为数组'),
];
