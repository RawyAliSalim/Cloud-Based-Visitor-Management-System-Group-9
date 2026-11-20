const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const visitorsController = require('../controllers/visitors.controller');

const router = express.Router();

router.get('/', requireAuth, requireRole('front-desk', 'admin'), visitorsController.searchVisitors);

module.exports = router;
