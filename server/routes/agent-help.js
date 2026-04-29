import { Router } from 'express';
const router = Router();

router.get('/agent/help', (req, res) => {
  res.json({
    name: '课表管理系统 API',
    version: '1.0.0',
    auth: {
      type: 'API Key',
      header: 'X-API-Key',
      description: '在请求头中添加 X-API-Key 进行认证',
    },
    endpoints: {
      'GET /api/agent/help': '获取此帮助信息',
      'GET /api/classes': '获取班级列表',
      'POST /api/classes': '创建班级',
      'PUT /api/classes/:id': '更新班级',
      'DELETE /api/classes/:id': '删除班级',
      'GET /api/classes/:id/students': '获取学生列表',
      'POST /api/classes/:id/students': '添加学生',
      'DELETE /api/classes/:id/students/:sid': '删除学生',
      'GET /api/pricing-tiers': '获取定价阶梯',
      'POST /api/pricing-tiers': '创建定价阶梯',
      'PUT /api/pricing-tiers/:id': '更新定价阶梯',
      'DELETE /api/pricing-tiers/:id': '删除定价阶梯',
      'GET /api/schedules?start=&end=': '获取时间段内排课',
      'POST /api/schedules': '创建单次排课',
      'POST /api/schedules/batch': '批量排课（学期模式或日期模式）',
      'PUT /api/schedules/:id': '更新排课',
      'DELETE /api/schedules/:id': '删除排课',
      'GET /api/semesters': '获取学期列表',
      'POST /api/semesters': '创建学期',
      'PUT /api/semesters/:id': '更新学期',
      'GET /api/schedule-image?start=&end=': '生成课表 PNG 图片',
    },
    examples: {
      '获取本周课表': 'GET /api/schedules?start=2026-04-27&end=2026-05-03',
      '生成课表图片': 'GET /api/schedule-image?start=2026-04-27&end=2026-05-03',
    },
  });
});

export default router;
