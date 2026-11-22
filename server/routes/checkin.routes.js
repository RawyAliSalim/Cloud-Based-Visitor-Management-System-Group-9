const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const { validateIdParam } = require('../middleware/validate');
const checkinController = require('../controllers/checkin.controller');

const router = express.Router();
const ALL_ROLES = ['host', 'front-desk', 'admin'];
const STAFF_ROLES = ['front-desk', 'admin'];

router.get('/', requireAuth, requireRole(...ALL_ROLES), checkinController.listVisits);
router.get('/on-site', requireAuth, requireRole(...STAFF_ROLES), checkinController.listOnSite);
router.get('/reports/activity', requireAuth, requireRole(...STAFF_ROLES), checkinController.activityReport);
router.get('/reports/export', requireAuth, requireRole(...STAFF_ROLES), checkinController.exportVisits);
router.get('/:id', requireAuth, requireRole(...ALL_ROLES), validateIdParam, checkinController.getVisit);
router.post('/:id/check-in', requireAuth, requireRole(...STAFF_ROLES), validateIdParam, checkinController.checkIn);
router.post('/:id/check-out', requireAuth, requireRole(...STAFF_ROLES), validateIdParam, checkinController.checkOut);

module.exports = router;
