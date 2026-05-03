import { body } from 'express-validator';

export const validateCreateTier = [
  body('minStudents').isInt({ min: 1 }).withMessage('最小人数须为正整数'),
  body('maxStudents').isInt({ min: 1 }).withMessage('最大人数须为正整数'),
  body('pricePerStudentPerHour').isFloat({ gt: 0 }).withMessage('单价须大于0'),
];

export const validateUpdateTier = [
  body('minStudents').optional().isInt({ min: 1 }).withMessage('最小人数须为正整数'),
  body('maxStudents').optional().isInt({ min: 1 }).withMessage('最大人数须为正整数'),
  body('pricePerStudentPerHour').optional().isFloat({ gt: 0 }).withMessage('单价须大于0'),
];
