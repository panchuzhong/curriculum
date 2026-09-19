import { body } from 'express-validator';
import { isValidDate, isValidBirthDate, DATE_RANGE_SUFFIX } from './dates.js';
import { numToStr } from './students.js';
import { isFiniteNumber } from './numbers.js';

export const VALID_GRADES = ['初一', '初二', '初三', '高一', '高二', '高三', '大学'];
const PHONE_RE = /^1[3-9]\d{9}$/;
// numToStr 和 students.js 用的是同一个：这条路由（POST /api/classes/:id/students）
// 建的也是学生，字段规则是照抄的，所以那边的"数字绑进 TEXT 列会存成 1990.0 /
// 13800000000.0，下一次修改就 400"同样适用。两边的行为由
// routes-classes 里的一条用例钉在一起。
const optionalPhone = (field, msg) =>
  body(field).optional({ checkFalsy: true }).customSanitizer(numToStr).matches(PHONE_RE).withMessage(msg);

export const validateCreateClass = [
  // isString keeps objects/arrays from reaching the driver as bind values; trim
  // makes whitespace-only names fail notEmpty.
  body('name').isString().withMessage('班级名称不能为空').bail().trim().notEmpty().withMessage('班级名称不能为空').isLength({ max: 100 }).withMessage('班级名称最多100个字符'),
  body('grade').isIn(VALID_GRADES).withMessage(`年级须为: ${VALID_GRADES.join('/')}`),
  body('subject').isString().withMessage('学科不能为空').bail().trim().notEmpty().withMessage('学科不能为空').isLength({ max: 50 }).withMessage('学科最多50个字符'),
  body('studentCount').isInt({ min: 1 }).withMessage('学生人数须为正整数'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负').bail().custom(isFiniteNumber).withMessage('单价须为有限数字'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负').bail().custom(isFiniteNumber).withMessage('优惠金额须为有限数字'),
  body('isCompetition').optional().isBoolean().toBoolean().withMessage('isCompetition 须为布尔值'),
  body('discountReason').optional({ values: 'null' }).isString().withMessage('优惠原因最多500个字符').bail().isLength({ max: 500 }).withMessage('优惠原因最多500个字符'),
  body('defaultLocationName').optional({ values: 'null' }).isString().withMessage('默认地点最多200个字符').bail().isLength({ max: 200 }).withMessage('默认地点最多200个字符'),
  body('defaultLocationLat').optional({ checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage('纬度须为 -90 到 90'),
  body('defaultLocationLng').optional({ checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('经度须为 -180 到 180'),
];

export const validateUpdateClass = [
  body('name').optional().isString().withMessage('班级名称不能为空').bail().trim().notEmpty().withMessage('班级名称不能为空').isLength({ max: 100 }).withMessage('班级名称最多100个字符'),
  body('grade').optional().isIn(VALID_GRADES).withMessage(`年级须为: ${VALID_GRADES.join('/')}`),
  body('subject').optional().isString().withMessage('学科不能为空').bail().trim().notEmpty().withMessage('学科不能为空').isLength({ max: 50 }).withMessage('学科最多50个字符'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负').bail().custom(isFiniteNumber).withMessage('单价须为有限数字'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负').bail().custom(isFiniteNumber).withMessage('优惠金额须为有限数字'),
  body('studentCount').optional().isInt({ min: 1 }).withMessage('学生人数须为正整数'),
  body('isCompetition').optional().isBoolean().toBoolean().withMessage('isCompetition 须为布尔值'),
  body('discountReason').optional({ values: 'null' }).isString().withMessage('优惠原因最多500个字符').bail().isLength({ max: 500 }).withMessage('优惠原因最多500个字符'),
  body('defaultLocationName').optional({ values: 'null' }).isString().withMessage('默认地点最多200个字符').bail().isLength({ max: 200 }).withMessage('默认地点最多200个字符'),
  body('defaultLocationLat').optional({ checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage('纬度须为 -90 到 90'),
  body('defaultLocationLng').optional({ checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('经度须为 -180 到 180'),
];

export const validateCreatePricing = [
  body('studentCount').isInt({ min: 1 }).withMessage('学生人数须为正整数'),
  body('unitPrice').isFloat({ min: 0 }).withMessage('单价不能为负').bail().custom(isFiniteNumber).withMessage('单价须为有限数字'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负').bail().custom(isFiniteNumber).withMessage('优惠金额须为有限数字'),
  body('discountReason').optional({ values: 'null' }).isString().withMessage('优惠原因最多500个字符').bail().isLength({ max: 500 }).withMessage('优惠原因最多500个字符'),
  body('effectiveFrom').custom(v => { if (!isValidDate(v)) throw new Error(`生效日期格式须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`); return true; }),
];

export const validateUpdatePricing = [
  body('studentCount').optional().isInt({ min: 1 }).withMessage('学生人数须为正整数'),
  body('unitPrice').optional().isFloat({ min: 0 }).withMessage('单价不能为负').bail().custom(isFiniteNumber).withMessage('单价须为有限数字'),
  body('discountAmount').optional().isFloat({ min: 0 }).withMessage('优惠金额不能为负').bail().custom(isFiniteNumber).withMessage('优惠金额须为有限数字'),
  body('discountReason').optional({ values: 'null' }).isString().withMessage('优惠原因最多500个字符').bail().isLength({ max: 500 }).withMessage('优惠原因最多500个字符'),
  body('effectiveFrom').optional().custom(v => { if (!isValidDate(v)) throw new Error(`生效日期格式须为有效的 YYYY-MM-DD${DATE_RANGE_SUFFIX}`); return true; }),
];

export const validateClassStudent = [
  body('name').isString().withMessage('学生姓名不能为空').bail().trim().notEmpty().withMessage('学生姓名不能为空').isLength({ max: 100 }).withMessage('学生姓名不能为空'),
  body('birthDate').optional({ checkFalsy: true }).customSanitizer(numToStr).custom(value => {
    if (!isValidBirthDate(value)) throw new Error('出生日期格式须为有效的 YYYY 或 YYYY-MM-DD');
    return true;
  }),
  optionalPhone('phone', '手机号格式不正确'),
  optionalPhone('parentPhone', '家长手机号格式不正确'),
  body('parentName').optional({ checkFalsy: true }).isString().withMessage('家长姓名最多100个字符').bail().isLength({ max: 100 }).withMessage('家长姓名最多100个字符'),
  body('note').optional({ checkFalsy: true }).isString().withMessage('备注最多2000个字符').bail().isLength({ max: 2000 }).withMessage('备注最多2000个字符'),
];
