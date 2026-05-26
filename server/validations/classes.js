import { body } from 'express-validator';
import { isValidDate } from './dates.js';

const VALID_GRADES = ['初一', '初二', '初三', '高一', '高二', '高三', '大学'];
const PHONE_RE = /^1[3-9]\d{9}$/;
const DATE_RE = /^\d{4}(-\d{2}-\d{2})?$/;
const optionalPhone = (field, msg) =>
  body(field).optional({ checkFalsy: true }).matches(PHONE_RE).withMessage(msg);

export const validateCreateClass = [
  body('name').notEmpty().isLength({ max: 100 }).withMessage('班级名称不能为空'),
  body('grade').isIn(VALID_GRADES).withMessage(`年级须为: ${VALID_GRADES.join('/')}`),
  body('subject').notEmpty().withMessage('学科不能为空'),
  body('studentCount').isInt({ min: 1 }).withMessage('学生人数须为正整数'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负'),
  body('isCompetition').optional().isBoolean().withMessage('isCompetition 须为布尔值'),
  body('defaultLocationLat').optional({ checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage('纬度须为 -90 到 90'),
  body('defaultLocationLng').optional({ checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('经度须为 -180 到 180'),
];

export const validateUpdateClass = [
  body('name').optional().notEmpty().isLength({ max: 100 }).withMessage('班级名称不能为空'),
  body('grade').optional().isIn(VALID_GRADES).withMessage(`年级须为: ${VALID_GRADES.join('/')}`),
  body('subject').optional().notEmpty().withMessage('学科不能为空'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负'),
  body('studentCount').optional().isInt({ min: 1 }).withMessage('学生人数须为正整数'),
  body('isCompetition').optional().isBoolean().withMessage('isCompetition 须为布尔值'),
  body('defaultLocationLat').optional({ checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage('纬度须为 -90 到 90'),
  body('defaultLocationLng').optional({ checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('经度须为 -180 到 180'),
];

export const validateCreatePricing = [
  body('studentCount').isInt({ min: 1 }).withMessage('学生人数须为正整数'),
  body('unitPrice').isFloat({ min: 0 }).withMessage('单价不能为负'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负'),
  body('effectiveFrom').custom(v => { if (!isValidDate(v)) throw new Error('生效日期格式须为有效的 YYYY-MM-DD'); return true; }),
];

export const validateUpdatePricing = [
  body('studentCount').optional().isInt({ min: 1 }).withMessage('学生人数须为正整数'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负'),
  body('effectiveFrom').optional().custom(v => { if (!isValidDate(v)) throw new Error('生效日期格式须为有效的 YYYY-MM-DD'); return true; }),
];

export const validateClassStudent = [
  body('name').notEmpty().isLength({ max: 100 }).withMessage('学生姓名不能为空'),
  body('birthDate').optional({ checkFalsy: true }).matches(DATE_RE).withMessage('出生日期格式须为 YYYY 或 YYYY-MM-DD'),
  optionalPhone('phone', '手机号格式不正确'),
  optionalPhone('parentPhone', '家长手机号格式不正确'),
];
