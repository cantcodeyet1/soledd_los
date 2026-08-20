const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

router.get('/', (req, res) => {
  webhookController.verifyWebhook(req, res);
});

router.post('/', async (req, res) => {
  await webhookController.handleIncomingMessage(req, res);
});

module.exports = router;
