import { body } from 'express-validator';

export const validateRegister = [
  body('username').isAlphanumeric().isLength({ min: 3, max: 20 }).withMessage('用户名须为3-20位字母数字'),
  body('password').isLength({ min: 6 }).withMessage('密码至少6位'),
  body('name').notEmpty().withMessage('姓名不能为空'),
];

export const validateLogin = [
  body('username').notEmpty().withMessage('用户名不能为空'),
  body('password').notEmpty().withMessage('密码不能为空'),
];

export const validateChangePassword = [
  body('oldPassword').notEmpty().withMessage('旧密码不能为空'),
  body('newPassword').isLength({ min: 6 }).withMessage('新密码至少6位'),
];

export const validateUpdateSubjects = [
  body('subjects').isArray().withMessage('subjects 必须是数组'),
  body('subjects.*').isString().withMessage('科目必须是字符串'),
];
