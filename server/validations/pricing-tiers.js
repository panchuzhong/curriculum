import { body } from 'express-validator';
import { isFiniteNumber } from './numbers.js';
import { singleValues } from './single-values.js';

export const validateCreateTier = [
  // isInt 对数组逐元素校验（single-values.js）；单价有 isFiniteNumber 兜底。
  singleValues(['minStudents', 'maxStudents']),
  body('minStudents').isInt({ min: 1 }).toInt().withMessage('最小人数须为正整数'),
  body('maxStudents').isInt({ min: 1 }).toInt().withMessage('最大人数须为正整数')
    .custom((max, { req }) => {
      if (req.body.minStudents != null && +max < +req.body.minStudents) {
        throw new Error('最大人数须不小于最小人数');
      }
      return true;
    }),
  body('pricePerStudentPerHour').isFloat({ gt: 0 }).withMessage('单价须大于0').bail().custom(isFiniteNumber).withMessage('单价须为有限数字'),
];

export const validateUpdateTier = [
  singleValues(['minStudents', 'maxStudents']),
  body('minStudents').optional().isInt({ min: 1 }).toInt().withMessage('最小人数须为正整数'),
  body('maxStudents').optional().isInt({ min: 1 }).toInt().withMessage('最大人数须为正整数')
    .custom((max, { req }) => {
      if (req.body.minStudents != null && +max < +req.body.minStudents) {
        throw new Error('最大人数须不小于最小人数');
      }
      return true;
    }),
  body('pricePerStudentPerHour').optional().isFloat({ gt: 0 }).withMessage('单价须大于0').bail().custom(isFiniteNumber).withMessage('单价须为有限数字'),
];
