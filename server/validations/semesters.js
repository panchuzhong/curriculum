import { body } from 'express-validator';
import { isValidDate, DATE_RANGE_SUFFIX } from './dates.js';
import { singleValues } from './single-values.js';

const VALID_TYPES = ['spring', 'fall', 'summer', 'winter'];

export const validateCreateSemester = [
  // isIn 对数组逐元素校验（single-values.js）；日期字段的 custom 查类型，天然免疫。
  singleValues(['type']),
  body('name').isString().withMessage('学期名称不能为空').bail().trim().notEmpty().withMessage('学期名称不能为空').isLength({ max: 100 }).withMessage('学期名称不能为空'),
  body('type').isIn(VALID_TYPES).withMessage(`学期类型须为: ${VALID_TYPES.join('/')}`),
  body('startDate').custom(v => { if (!isValidDate(v)) throw new Error(`开始日期格式须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`); return true; }),
  body('endDate').custom(v => { if (!isValidDate(v)) throw new Error(`结束日期格式须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`); return true; })
    .custom((endDate, { req }) => {
      if (req.body.startDate && endDate < req.body.startDate) {
        throw new Error('结束日期须不早于开始日期');
      }
      return true;
    }),
];

export const validateUpdateSemester = [
  singleValues(['type']),
  body('name').optional().isString().withMessage('学期名称不能为空').bail().trim().notEmpty().withMessage('学期名称不能为空').isLength({ max: 100 }).withMessage('学期名称不能为空'),
  body('type').optional().isIn(VALID_TYPES).withMessage(`学期类型须为: ${VALID_TYPES.join('/')}`),
  body('startDate').optional().custom(v => { if (!isValidDate(v)) throw new Error(`开始日期格式须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`); return true; }),
  body('endDate').optional().custom(v => { if (!isValidDate(v)) throw new Error(`结束日期格式须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`); return true; })
    .custom((endDate, { req }) => {
      if (req.body.startDate && endDate < req.body.startDate) {
        throw new Error('结束日期须不早于开始日期');
      }
      return true;
    }),
];
