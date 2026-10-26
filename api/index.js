const express = require('express');
const app = express();
app.use(express.json());

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Hardcoded Details
const ADMIN_IDS = [6402927432]; 
const PANEL_URL = 'https://smmlite.com/api/v2';
const SERVICE_ID = '5160';
const ALLOWED_CHANNELS = ['damanpr0', 'Tricky_Earner_Is_Live']; 

const BOT_TOKEN = process.env.BOT_TOKEN; 
const SMM_API_KEY = process.env.SMM_API_KEY; 

// Render automatically PORT set karta hai
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL 
  ? `${process.env.RENDER_EXTERNAL_URL}/webhook` 
  : `http://localhost:${PORT}/webhook`;

// Bot ko webhook mode mein initialize karein
const bot = new TelegramBot(BOT_TOKEN);
bot.setWebHook(WEBHOOK_URL).catch(err => console.log('Webhook set error:', err.message));

// Webhook endpoint
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health check (Render ke liye zaroori)
app.get('/', (req, res) => res.send('Bot is alive!'));

// Yahan se aapka baaki ka bot logic shuru hoga...
let currentQty = 10; 
let ordersCount = 0;
let failedCount = 0;
const isAdmin = (id) => ADMIN_IDS.includes(id);

const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📊 Stats', callback_data: 'stats' }, { text: '💰 Balance', callback_data: 'balance' }],
      [{ text: '📡 Channels', callback_data: 'channels' }, { text: '🔢 Quantity', callback_data: 'qty' }],
      [{ text: '⚙️ Service', callback_data: 'service' }],
    ],
  },
  parse_mode: 'HTML',
};

async function placeOrder(link, quantity) {
  try {
    const { data } = await axios.post(PANEL_URL, { 
      key: SMM_API_KEY, action: 'add', service: SERVICE_ID, link: link, quantity: quantity 
    }, { timeout: 8000 });
    if (data?.error) throw new Error(data.error);
    if (!data?.order) throw new Error('No order ID received');
    return { ok: true, orderId: data.order };
  } catch (err) { 
    console.log(`❌ Panel Error: ${err.message}`);
    return { ok: false };
  }
}

// ... (Aapke saare bot.onText, bot.on('callback_query'), bot.on('channel_post') waise hi rahenge jaise pichle code mein the) ...

// Server Start
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
