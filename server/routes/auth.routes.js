const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { requireJson } = require('../middleware/validate');
const authController = require('../controllers/auth.controller');

const router = express.Router();

router.post('/login', requireJson, authController.login);
router.post('/logout', authController.logout);
router.get('/me', requireAuth, authController.me);
router.get('/hosts', requireAuth, authController.listHosts);

module.exports = router;
