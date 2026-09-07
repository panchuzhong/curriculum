import { body } from 'express-validator';
import { isValidDate } from './dates.js';

const PHONE_RE = /^1[3-9]\d{9}$/;
const isValidBirthDate = value => /^\d{4}$/.test(value) || isValidDate(value);
const birthDate = () => body('birthDate').optional({ checkFalsy: true }).custom(value => {
  if (!isValidBirthDate(value)) throw new Error('出生日期格式须为有效的 YYYY 或 YYYY-MM-DD');
  return true;
});

export const validateCreateStudent = [
  body('name').isString().trim().notEmpty().isLength({ max: 100 }).withMessage('姓名不能为空'),
  birthDate(),
  body('phone').optional({ checkFalsy: true }).isLength({ max: 20 }).matches(PHONE_RE).withMessage('手机号格式不正确'),
  body('parentPhone').optional({ checkFalsy: true }).isLength({ max: 20 }).matches(PHONE_RE).withMessage('家长手机号格式不正确'),
  body('parentName').optional({ checkFalsy: true }).isString().isLength({ max: 100 }).withMessage('家长姓名最多100个字符'),
  body('note').optional({ checkFalsy: true }).isString().isLength({ max: 2000 }).withMessage('备注最多2000个字符'),
  body('classIds').optional().isArray({ max: 500 }).withMessage('classIds 须为数组且最多500项'),
  // toInt: the route matches ids against a Set of numbers, so "3" would be dropped.
  body('classIds.*').optional().isInt({ min: 1 }).toInt().withMessage('classIds 元素须为正整数'),
];

export const validateUpdateStudent = [
  body('name').optional().isString().trim().notEmpty().isLength({ max: 100 }).withMessage('姓名不能为空'),
  birthDate(),
  body('phone').optional({ checkFalsy: true }).isLength({ max: 20 }).matches(PHONE_RE).withMessage('手机号格式不正确'),
  body('parentPhone').optional({ checkFalsy: true }).isLength({ max: 20 }).matches(PHONE_RE).withMessage('家长手机号格式不正确'),
  body('parentName').optional({ checkFalsy: true }).isString().isLength({ max: 100 }).withMessage('家长姓名最多100个字符'),
  body('note').optional({ checkFalsy: true }).isString().isLength({ max: 2000 }).withMessage('备注最多2000个字符'),
  body('classIds').optional().isArray({ max: 500 }).withMessage('classIds 须为数组且最多500项'),
  // toInt: the route matches ids against a Set of numbers, so "3" would be dropped.
  body('classIds.*').optional().isInt({ min: 1 }).toInt().withMessage('classIds 元素须为正整数'),
];
