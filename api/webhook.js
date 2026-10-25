const { bot } = require('../lib/bot');

module.exports = async (req, res) => {
  // Only accept POST requests from Telegram
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Webhook secret (prevent forgery)
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const received = req.headers['x-telegram-bot-api-secret-token'];
  if (secret && received !== secret) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  try {
    await bot.processUpdate(req.body);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(200).json({ ok: true }); // Still return 200 to prevent Telegram from retrying
  }
};
