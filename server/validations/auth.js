import { body } from 'express-validator';

// withMessage() 只作用于紧挨着它的那一个校验器。整条链末尾挂一句话，前面那些
// 校验器失败时用的仍是 express-validator 的默认文案「Invalid value」——而空值、
// 非字符串这些恰恰是最常见的出错方式。所以每个可能失败的校验器都得自己带上话。
// 网页端多数表单有自己的前置提示挡着，但 API 是这个项目对外的一等接口
// （见 /api/agent/help），调用方拿到「Invalid value」是没法据此改请求的。
const USERNAME_MSG = '用户名须为3-20位字母数字';
const NAME_MSG = '姓名不能为空且最多100个字符';
const PASSWORD_MIN_MSG = '密码至少8位';
const NEW_PASSWORD_MIN_MSG = '新密码至少8位';
const PASSWORD_BYTES_MSG = '密码最多72个 UTF-8 字节';

export const validateRegister = [
  body('username').isString().withMessage(USERNAME_MSG)
    .bail().isAlphanumeric().withMessage(USERNAME_MSG)
    .isLength({ min: 3, max: 20 }).withMessage(USERNAME_MSG),
  body('password').isString().withMessage(PASSWORD_MIN_MSG)
    .bail().isLength({ min: 8, max: 128 }).withMessage(PASSWORD_MIN_MSG)
    .bail().custom(value => Buffer.byteLength(value, 'utf8') <= 72).withMessage(PASSWORD_BYTES_MSG),
  body('name').isString().withMessage(NAME_MSG)
    .bail().notEmpty().withMessage(NAME_MSG)
    .isLength({ max: 100 }).withMessage(NAME_MSG),
];

export const validateLogin = [
  body('username').isString().withMessage('用户名不能为空')
    .bail().notEmpty().withMessage('用户名不能为空'),
  body('password').isString().withMessage('密码不能为空')
    .bail().notEmpty().withMessage('密码不能为空'),
];

export const validateChangePassword = [
  body('oldPassword').isString().withMessage('旧密码不能为空')
    .bail().notEmpty().withMessage('旧密码不能为空'),
  body('newPassword').isString().withMessage(NEW_PASSWORD_MIN_MSG)
    .bail().isLength({ min: 8, max: 128 }).withMessage(NEW_PASSWORD_MIN_MSG)
    .bail().custom(value => Buffer.byteLength(value, 'utf8') <= 72).withMessage(PASSWORD_BYTES_MSG),
];

export const validateUpdateSubjects = [
  body('subjects').isArray({ max: 100 }).withMessage('subjects 必须是数组且最多100项'),
  body('subjects.*').isString().withMessage('每项科目须为1-20个字符')
    .bail().isLength({ min: 1, max: 20 }).withMessage('每项科目须为1-20个字符'),
];
