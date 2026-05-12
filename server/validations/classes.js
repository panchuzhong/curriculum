import { body } from 'express-validator';

const VALID_GRADES = ['初一', '初二', '初三', '高一', '高二', '高三', '大学'];
const PHONE_RE = /^1[3-9]\d{9}$/;
const DATE_RE = /^\d{4}(-\d{2}-\d{2})?$/;
const optionalPhone = (field, msg) =>
  body(field).optional({ checkFalsy: true }).matches(PHONE_RE).withMessage(msg);

export const validateCreateClass = [
  body('name').notEmpty().withMessage('班级名称不能为空'),
  body('grade').isIn(VALID_GRADES).withMessage(`年级须为: ${VALID_GRADES.join('/')}`),
  body('subject').notEmpty().withMessage('学科不能为空'),
  body('studentCount').isInt({ min: 1 }).withMessage('学生人数须为正整数'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负'),
  body('isCompetition').optional().isBoolean().withMessage('isCompetition 须为布尔值'),
];

export const validateUpdateClass = [
  body('name').optional().notEmpty().withMessage('班级名称不能为空'),
  body('grade').optional().isIn(VALID_GRADES).withMessage(`年级须为: ${VALID_GRADES.join('/')}`),
  body('subject').optional().notEmpty().withMessage('学科不能为空'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负'),
  body('studentCount').optional().isInt({ min: 1 }).withMessage('学生人数须为正整数'),
  body('isCompetition').optional().isBoolean().withMessage('isCompetition 须为布尔值'),
];

export const validateClassStudent = [
  body('name').notEmpty().withMessage('学生姓名不能为空'),
  body('birthDate').optional({ checkFalsy: true }).matches(DATE_RE).withMessage('出生日期格式须为 YYYY 或 YYYY-MM-DD'),
  optionalPhone('phone', '手机号格式不正确'),
  optionalPhone('parentPhone', '家长手机号格式不正确'),
];
