const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
app.use(express.json());

// ==========================================
// HARDCODED DETAILS
// ==========================================
const ADMIN_IDS = [6402927432]; 
const PANEL_URL = 'https://smmlite.com/api/v2';
const SERVICE_ID = '5160';
const ALLOWED_CHANNELS = ['damanpr0', 'Tricky_Earner_Is_Live']; 

// Vercel/Render Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN; 
const SMM_API_KEY = process.env.SMM_API_KEY; 
const PORT = process.env.PORT || 3000;

// Render apna external URL khud deta hai
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL 
  ? `${process.env.RENDER_EXTERNAL_URL}/webhook` 
  : `http://localhost:${PORT}/webhook`;

// ==========================================
// BOT & SERVER SETUP
// ==========================================
let currentQty = 10; 
let ordersCount = 0;
let failedCount = 0;
const isAdmin = (id) => ADMIN_IDS.includes(id);

// Bot Initialize (polling: false kyunki hum webhook use kar rahe hain)
const bot = new TelegramBot(BOT_TOKEN, { 
  polling: false,
  request: { agentOptions: { family: 4 } } 
});

// Webhook Set Karein
bot.setWebHook(WEBHOOK_URL)
  .then(() => console.log('✅ Webhook successfully set!'))
  .catch((err) => console.log('❌ Webhook error:', err.message));

// Render Webhook Route
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Render Health Check Route (Taaki Render ko lage bot zinda hai)
app.get('/', (req, res) => res.send('Bot is running perfectly!'));

// ==========================================
// SMM PANEL & TELEGRAM LOGIC
// ==========================================
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

bot.onText(/^\/start$/, (msg) => {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '❌ Not admin');
  bot.sendMessage(msg.chat.id, `🤖 <b>SMM Bot</b>\n\nTap a button below 👇`, mainMenu);
});

bot.onText(/^\/setqty\s+(\d+)$/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const qty = parseInt(match[1], 10);
  if (isNaN(qty) || qty < 1) return bot.sendMessage(msg.chat.id, '❌ Invalid quantity.');
  currentQty = qty;
  bot.sendMessage(msg.chat.id, `✅ Quantity updated to <b>${currentQty}</b>`, { parse_mode: 'HTML' });
});

bot.on('callback_query', async (query) => {
  if (!isAdmin(query.from.id)) return bot.answerCallbackQuery(query.id, { text: '❌ Not admin', show_alert: true });
  bot.answerCallbackQuery(query.id).catch(() => {});
  const chatId = query.message.chat.id, msgId = query.message.message_id;
  const back = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'refresh' }]] };

  if (query.data === 'stats') return bot.editMessageText(`📊 <b>Stats</b>\n\nTotal OK: <b>${ordersCount}</b>\nTotal Fail: <b>${failedCount}</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: back });
  
  if (query.data === 'balance') {
    try {
      const { data } = await axios.post(PANEL_URL, { key: SMM_API_KEY, action: 'balance' }, { timeout: 8000 });
      return bot.editMessageText(`💰 <b>Balance</b>\n\n<b>Smmlite</b>: ${data.balance} ${data.currency || ''}`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: back });
    } catch (e) { 
      return bot.editMessageText(`❌ Error: ${e.message}`, { chat_id: chatId, message_id: msgId, reply_markup: back }); 
    }
  }
  
  if (query.data === 'channels') {
    const channelsText = ALLOWED_CHANNELS.map(c => `@${c}`).join('\n');
    return bot.editMessageText(`📡 <b>Allowed Channels</b>\n\n${channelsText}`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: back });
  }
  
  if (query.data === 'qty') return bot.editMessageText(`🔢 <b>Quantity</b>\n\n<b>${currentQty}</b>\n\nChange via: <code>/setqty 20</code>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: back });
  
  if (query.data === 'service') return bot.editMessageText(`⚙️ <b>Service ID</b>\n\n<b>${SERVICE_ID}</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: back });
  
  if (query.data === 'refresh') return bot.editMessageText(`🤖 <b>SMM Bot</b>\n\nTap a button below 👇`, { chat_id: chatId, message_id: msgId, ...mainMenu });
});

bot.on('channel_post', async (msg) => {
  const username = msg.chat.username?.toLowerCase();
  if (!username || !ALLOWED_CHANNELS.includes(username)) return;
  
  const link = `https://t.me/${username}/${msg.message_id}`;
  const result = await placeOrder(link, currentQty);
  
  if (result.ok) {
    ordersCount++;
    console.log(`✅ Success: ${link} | Order ID: ${result.orderId}`);
  } else {
    failedCount++;
    console.log(`❌ Failed: ${link}`);
    for (const id of ADMIN_IDS) {
      bot.sendMessage(id, `❌ Order failed for ${link}`).catch(() => {});
    }
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
