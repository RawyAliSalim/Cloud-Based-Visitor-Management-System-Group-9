const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const { validateIdParam } = require('../middleware/validate');
const visitorsController = require('../controllers/visitors.controller');

const router = express.Router();

router.get('/', requireAuth, requireRole('front-desk', 'admin'), visitorsController.searchVisitors);
router.get('/:id', requireAuth, requireRole('front-desk', 'admin'), validateIdParam, visitorsController.getVisitor);

module.exports = router;
