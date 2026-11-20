const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const { requireJson, validateIdParam } = require('../middleware/validate');
const visitsController = require('../controllers/visits.controller');

const router = express.Router();
const ALL_ROLES = ['host', 'front-desk', 'admin'];

router.post('/', requireAuth, requireRole(...ALL_ROLES), requireJson, visitsController.createVisit);
router.patch('/:id', requireAuth, requireRole(...ALL_ROLES), validateIdParam, requireJson, visitsController.updateVisit);
router.post('/:id/cancel', requireAuth, requireRole(...ALL_ROLES), validateIdParam, visitsController.cancelVisit);

module.exports = router;
