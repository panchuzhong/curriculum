import { body } from 'express-validator';

export const validateRegister = [
  body('username').isString().bail().isAlphanumeric().isLength({ min: 3, max: 20 }).withMessage('用户名须为3-20位字母数字'),
  body('password').isString().bail().isLength({ min: 8, max: 128 }).withMessage('密码至少8位')
    .bail().custom(value => Buffer.byteLength(value, 'utf8') <= 72).withMessage('密码最多72个 UTF-8 字节'),
  body('name').isString().bail().notEmpty().isLength({ max: 100 }).withMessage('姓名不能为空且最多100个字符'),
];

export const validateLogin = [
  body('username').isString().bail().notEmpty().withMessage('用户名不能为空'),
  body('password').isString().bail().notEmpty().withMessage('密码不能为空'),
];

export const validateChangePassword = [
  body('oldPassword').isString().bail().notEmpty().withMessage('旧密码不能为空'),
  body('newPassword').isString().bail().isLength({ min: 8, max: 128 }).withMessage('新密码至少8位')
    .bail().custom(value => Buffer.byteLength(value, 'utf8') <= 72).withMessage('密码最多72个 UTF-8 字节'),
];

export const validateUpdateSubjects = [
  body('subjects').isArray({ max: 100 }).withMessage('subjects 必须是数组且最多100项'),
  body('subjects.*').isString().isLength({ min: 1, max: 20 }).withMessage('每项科目须为1-20个字符'),
];
