import { body } from 'express-validator';
import { isValidDate } from './dates.js';

const VALID_TYPES = ['spring', 'fall', 'summer', 'winter'];

export const validateCreateSemester = [
  body('name').notEmpty().isLength({ max: 100 }).withMessage('学期名称不能为空'),
  body('type').isIn(VALID_TYPES).withMessage(`学期类型须为: ${VALID_TYPES.join('/')}`),
  body('startDate').custom(v => { if (!isValidDate(v)) throw new Error('开始日期格式须为有效的 YYYY-MM-DD'); return true; }),
  body('endDate').custom(v => { if (!isValidDate(v)) throw new Error('结束日期格式须为有效的 YYYY-MM-DD'); return true; })
    .custom((endDate, { req }) => {
      if (req.body.startDate && endDate < req.body.startDate) {
        throw new Error('结束日期须不早于开始日期');
      }
      return true;
    }),
];

export const validateUpdateSemester = [
  body('name').optional().notEmpty().isLength({ max: 100 }).withMessage('学期名称不能为空'),
  body('type').optional().isIn(VALID_TYPES).withMessage(`学期类型须为: ${VALID_TYPES.join('/')}`),
  body('startDate').optional().custom(v => { if (!isValidDate(v)) throw new Error('开始日期格式须为有效的 YYYY-MM-DD'); return true; }),
  body('endDate').optional().custom(v => { if (!isValidDate(v)) throw new Error('结束日期格式须为有效的 YYYY-MM-DD'); return true; })
    .custom((endDate, { req }) => {
      if (req.body.startDate && endDate < req.body.startDate) {
        throw new Error('结束日期须不早于开始日期');
      }
      return true;
    }),
];
