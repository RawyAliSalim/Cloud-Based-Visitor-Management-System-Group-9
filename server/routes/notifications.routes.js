const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const notificationsController = require('../controllers/notifications.controller');

const router = express.Router();

router.get('/', requireAuth, requireRole('host', 'front-desk', 'admin'), notificationsController.listNotifications);
router.get('/summary', requireAuth, requireRole('front-desk', 'admin'), notificationsController.summary);
// No requireAuth: also callable by an external scheduler with `Authorization: Bearer <CRON_SECRET>`.
router.post('/retry-due', notificationsController.retryDue);
router.post('/fcm-token', requireAuth, notificationsController.saveFcmToken);
router.post('/:id/acknowledge', requireAuth, requireRole('host'), notificationsController.acknowledgeNotification);
router.post('/:id/resend', requireAuth, requireRole('front-desk', 'admin'), notificationsController.resendNotification);

module.exports = router;
