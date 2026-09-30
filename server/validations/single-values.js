import { body } from 'express-validator';

// express-validator 的标准校验器（isInt/isFloat/isIn/isBoolean/matches/isLength…）对
// 数组逐个元素校验：[] 一个元素都没有、校验全过，['2026-01-01'] 也按元素照过——数组
// 随后原样到达路由，在 drizzle 绑定时抛成 500，或被 Number()/toBoolean() 静默强转
// （Number([12])=12、Number([])=0）。标量字段统一先过这一关。
// 本身就是数组的字段（ids/dates/classIds/items/subjects）不列进来；天然免疫、不必
// 再列的：isString（对整个值查类型）、带 typeof 守卫的 custom（isValidDate/
// isValidTime/isValidBirthDate）、跟在 isFloat+bail 后的 custom(isFiniteNumber)。
export const singleValues = (fields) =>
  body(fields).not().isArray().withMessage('参数须为单个值，不能是数组');
