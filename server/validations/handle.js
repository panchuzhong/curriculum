import { validationResult } from 'express-validator';

export default function handle(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const first = errors.array()[0];
  res.status(400).json({ error: first.msg });
}
