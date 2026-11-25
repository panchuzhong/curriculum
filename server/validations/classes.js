import { body } from 'express-validator';
import { isValidDate, DATE_RANGE_SUFFIX } from './dates.js';
import { studentDetails } from './students.js';
import { isFiniteNumber } from './numbers.js';
import { singleValues } from './single-values.js';

export const VALID_GRADES = ['初一', '初二', '初三', '高一', '高二', '高三', '大学'];

export const validateCreateClass = [
  // isIn/isInt/isBoolean/isFloat 对数组逐元素校验，[] 和 ['高一'] 都能混过（规则见
  // single-values.js）；字符串字段有 isString 查类型、金额字段有 isFiniteNumber 兜底。
  singleValues(['grade', 'studentCount', 'isCompetition', 'defaultLocationLat', 'defaultLocationLng']),
  // isString keeps objects/arrays from reaching the driver as bind values; trim
  // makes whitespace-only names fail notEmpty.
  body('name').isString().withMessage('班级名称不能为空').bail().trim().notEmpty().withMessage('班级名称不能为空').isLength({ max: 100 }).withMessage('班级名称最多100个字符'),
  body('grade').isIn(VALID_GRADES).withMessage(`年级须为: ${VALID_GRADES.join('/')}`),
  body('subject').isString().withMessage('学科不能为空').bail().trim().notEmpty().withMessage('学科不能为空').isLength({ max: 50 }).withMessage('学科最多50个字符'),
  body('studentCount').isInt({ min: 1, max: Number.MAX_SAFE_INTEGER }).withMessage('学生人数须为正整数'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负').bail().custom(isFiniteNumber).withMessage('单价须为有限数字'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负').bail().custom(isFiniteNumber).withMessage('优惠金额须为有限数字'),
  body('isCompetition').optional().isBoolean().toBoolean().withMessage('isCompetition 须为布尔值'),
  body('discountReason').optional({ values: 'null' }).isString().withMessage('优惠原因最多500个字符').bail().isLength({ max: 500 }).withMessage('优惠原因最多500个字符'),
  body('defaultLocationName').optional({ values: 'null' }).isString().withMessage('默认地点最多200个字符').bail().isLength({ max: 200 }).withMessage('默认地点最多200个字符'),
  body('defaultLocationLat').optional({ values: 'null' }).if(v => v !== '').isFloat({ min: -90, max: 90 }).withMessage('纬度须为 -90 到 90'),
  body('defaultLocationLng').optional({ values: 'null' }).if(v => v !== '').isFloat({ min: -180, max: 180 }).withMessage('经度须为 -180 到 180'),
  body('defaultLocationLatFor').optional({ values: 'null' }).isString().withMessage('坐标来源地点最多200个字符').bail().isLength({ max: 200 }).withMessage('坐标来源地点最多200个字符'),
  body('defaultLocationLngFor').optional({ values: 'null' }).isString().withMessage('坐标来源地点最多200个字符').bail().isLength({ max: 200 }).withMessage('坐标来源地点最多200个字符'),
];

export const validateUpdateClass = [
  singleValues(['grade', 'studentCount', 'isCompetition', 'defaultLocationLat', 'defaultLocationLng']),
  body('name').optional().isString().withMessage('班级名称不能为空').bail().trim().notEmpty().withMessage('班级名称不能为空').isLength({ max: 100 }).withMessage('班级名称最多100个字符'),
  body('grade').optional().isIn(VALID_GRADES).withMessage(`年级须为: ${VALID_GRADES.join('/')}`),
  body('subject').optional().isString().withMessage('学科不能为空').bail().trim().notEmpty().withMessage('学科不能为空').isLength({ max: 50 }).withMessage('学科最多50个字符'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负').bail().custom(isFiniteNumber).withMessage('单价须为有限数字'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负').bail().custom(isFiniteNumber).withMessage('优惠金额须为有限数字'),
  body('studentCount').optional().isInt({ min: 1, max: Number.MAX_SAFE_INTEGER }).withMessage('学生人数须为正整数'),
  body('isCompetition').optional().isBoolean().toBoolean().withMessage('isCompetition 须为布尔值'),
  body('discountReason').optional({ values: 'null' }).isString().withMessage('优惠原因最多500个字符').bail().isLength({ max: 500 }).withMessage('优惠原因最多500个字符'),
  body('defaultLocationName').optional({ values: 'null' }).isString().withMessage('默认地点最多200个字符').bail().isLength({ max: 200 }).withMessage('默认地点最多200个字符'),
  body('defaultLocationLat').optional({ values: 'null' }).if(v => v !== '').isFloat({ min: -90, max: 90 }).withMessage('纬度须为 -90 到 90'),
  body('defaultLocationLng').optional({ values: 'null' }).if(v => v !== '').isFloat({ min: -180, max: 180 }).withMessage('经度须为 -180 到 180'),
  body('defaultLocationLatFor').optional({ values: 'null' }).isString().withMessage('坐标来源地点最多200个字符').bail().isLength({ max: 200 }).withMessage('坐标来源地点最多200个字符'),
  body('defaultLocationLngFor').optional({ values: 'null' }).isString().withMessage('坐标来源地点最多200个字符').bail().isLength({ max: 200 }).withMessage('坐标来源地点最多200个字符'),
];

export const validateCreatePricing = [
  singleValues(['studentCount']),
  body('studentCount').isInt({ min: 1, max: Number.MAX_SAFE_INTEGER }).withMessage('学生人数须为正整数'),
  body('unitPrice').isFloat({ min: 0 }).withMessage('单价不能为负').bail().custom(isFiniteNumber).withMessage('单价须为有限数字'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负').bail().custom(isFiniteNumber).withMessage('优惠金额须为有限数字'),
  body('discountReason').optional({ values: 'null' }).isString().withMessage('优惠原因最多500个字符').bail().isLength({ max: 500 }).withMessage('优惠原因最多500个字符'),
  body('effectiveFrom').custom(v => { if (!isValidDate(v)) throw new Error(`生效日期格式须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`); return true; }),
];

export const validateUpdatePricing = [
  singleValues(['studentCount']),
  body('studentCount').optional().isInt({ min: 1, max: Number.MAX_SAFE_INTEGER }).withMessage('学生人数须为正整数'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负').bail().custom(isFiniteNumber).withMessage('单价须为有限数字'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负').bail().custom(isFiniteNumber).withMessage('优惠金额须为有限数字'),
  body('discountReason').optional({ values: 'null' }).isString().withMessage('优惠原因最多500个字符').bail().isLength({ max: 500 }).withMessage('优惠原因最多500个字符'),
  body('effectiveFrom').optional().custom(v => { if (!isValidDate(v)) throw new Error(`生效日期格式须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`); return true; }),
];

export const validateClassStudent = [
  body('name').isString().withMessage('学生姓名不能为空').bail().trim().notEmpty().withMessage('学生姓名不能为空').isLength({ max: 100 }).withMessage('学生姓名最多100个字符'),
  ...studentDetails,
];
