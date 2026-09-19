import { body } from 'express-validator';
import { isValidBirthDate } from './dates.js';

const PHONE_RE = /^1[3-9]\d{9}$/;

// 数字先转成字符串再校验。这些列在 SQLite 里是 TEXT，而 JSON 里的数字会原样绑进去，
// 按 REAL 亲和性转换后存成 "1990.0" / "13800000000.0"：接口返回 200、看着没事，
// 可客户端把读回来的值原样提交下一次修改时校验就不认了，那条学生记录从此改不动
// （改个电话号码都 400）。正则的隐式转换让它们在校验这一关看着是对的，
// 存进去才坏——所以要在校验之前就把类型normalize掉。
export const numToStr = (v) => (typeof v === 'number' && Number.isInteger(v) ? String(v) : v);

const birthDate = () => body('birthDate').optional({ checkFalsy: true })
  .customSanitizer(numToStr)
  .custom(value => {
    if (!isValidBirthDate(value)) throw new Error('出生日期格式须为有效的 YYYY 或 YYYY-MM-DD');
    return true;
  });

export const validateCreateStudent = [
  body('name').isString().withMessage('姓名不能为空').bail().trim().notEmpty().withMessage('姓名不能为空').isLength({ max: 100 }).withMessage('姓名最多100个字符'),
  birthDate(),
  body('phone').optional({ checkFalsy: true }).customSanitizer(numToStr).isLength({ max: 20 }).withMessage('手机号格式不正确').bail().matches(PHONE_RE).withMessage('手机号格式不正确'),
  body('parentPhone').optional({ checkFalsy: true }).customSanitizer(numToStr).isLength({ max: 20 }).withMessage('家长手机号格式不正确').bail().matches(PHONE_RE).withMessage('家长手机号格式不正确'),
  body('parentName').optional({ checkFalsy: true }).isString().withMessage('家长姓名最多100个字符').bail().isLength({ max: 100 }).withMessage('家长姓名最多100个字符'),
  body('note').optional({ checkFalsy: true }).isString().withMessage('备注最多2000个字符').bail().isLength({ max: 2000 }).withMessage('备注最多2000个字符'),
  body('classIds').optional().isArray({ max: 500 }).withMessage('classIds 须为数组且最多500项'),
  // toInt: the route matches ids against a Set of numbers, so "3" would be dropped.
  body('classIds.*').optional().isInt({ min: 1 }).toInt().withMessage('classIds 元素须为正整数'),
];

export const validateUpdateStudent = [
  body('name').optional().isString().withMessage('姓名不能为空').bail().trim().notEmpty().withMessage('姓名不能为空').isLength({ max: 100 }).withMessage('姓名最多100个字符'),
  birthDate(),
  body('phone').optional({ checkFalsy: true }).customSanitizer(numToStr).isLength({ max: 20 }).withMessage('手机号格式不正确').bail().matches(PHONE_RE).withMessage('手机号格式不正确'),
  body('parentPhone').optional({ checkFalsy: true }).customSanitizer(numToStr).isLength({ max: 20 }).withMessage('家长手机号格式不正确').bail().matches(PHONE_RE).withMessage('家长手机号格式不正确'),
  body('parentName').optional({ checkFalsy: true }).isString().withMessage('家长姓名最多100个字符').bail().isLength({ max: 100 }).withMessage('家长姓名最多100个字符'),
  body('note').optional({ checkFalsy: true }).isString().withMessage('备注最多2000个字符').bail().isLength({ max: 2000 }).withMessage('备注最多2000个字符'),
  body('classIds').optional().isArray({ max: 500 }).withMessage('classIds 须为数组且最多500项'),
  // toInt: the route matches ids against a Set of numbers, so "3" would be dropped.
  body('classIds.*').optional().isInt({ min: 1 }).toInt().withMessage('classIds 元素须为正整数'),
];
