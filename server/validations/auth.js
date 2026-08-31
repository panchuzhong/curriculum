import { body } from 'express-validator';

export const validateRegister = [
  body('username').isAlphanumeric().isLength({ min: 3, max: 20 }).withMessage('用户名须为3-20位字母数字'),
  body('password').isLength({ min: 8, max: 128 }).withMessage('密码至少8位'),
  body('name').notEmpty().isLength({ max: 100 }).withMessage('姓名不能为空且最多100个字符'),
];

export const validateLogin = [
  body('username').notEmpty().withMessage('用户名不能为空'),
  body('password').notEmpty().withMessage('密码不能为空'),
];

export const validateChangePassword = [
  body('oldPassword').notEmpty().withMessage('旧密码不能为空'),
  body('newPassword').isLength({ min: 8, max: 128 }).withMessage('新密码至少8位'),
];

export const validateUpdateSubjects = [
  body('subjects').isArray({ max: 100 }).withMessage('subjects 必须是数组且最多100项'),
  body('subjects.*').isString().isLength({ min: 1, max: 20 }).withMessage('每项科目须为1-20个字符'),
];
