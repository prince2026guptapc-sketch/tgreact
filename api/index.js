const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN; 
const HARDCODED_API_KEY = process.env.SMM_API_KEY; 
const ADMIN_IDS = [6402927432]; 
const HARDCODED_API_URL = 'https://smmlite.com/api/v2';
const HARDCODED_SERVICE_ID = '5160';
const ALLOWED_CHANNELS = ['damanpr0', 'Tricky_Earner_Is_Live']; 

let currentQty = 10; 
const isAdmin = (id) => ADMIN_IDS.includes(id);

// Bot Initialization
const bot = new TelegramBot(BOT_TOKEN, {
  request: { agentOptions: { family: 4 } }
});

const PANELS = [{ name: 'Smmlite', url: HARDCODED_API_URL, key: HARDCODED_API_KEY, service: HARDCODED_SERVICE_ID }];
let ordersCount = 0;
let failedCount = 0;

// Place Order Logic
async function placeOrder(link, quantity) {
  for (const panel of PANELS) {
    try {
      const { data } = await axios.post(panel.url, { key: panel.key, action: 'add', service: panel.service, link, quantity }, { timeout: 20000 });
      if (data?.error) throw new Error(data.error);
      if (!data?.order) throw new Error('No order ID');
      return { ok: true, orderId: data.order };
    } catch (err) { 
      console.log(`❌ Panel Error: ${err.message}`);
    }
  }
  return { ok: false };
}

// Menu Setup
const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📊 Stats', callback_data: 'stats' }, { text: '💰 Balance', callback_data: 'balance' }],
      [{ text: '📡 Channels', callback_data: 'channels' }, { text: '🔢 Quantity', callback_data: 'qty' }],
      [{ text: '⚙️ Service', callback_data: 'service' }],
    ],
  },
  parse_mode: 'Markdown',
};

bot.onText(/^\/start$/, (msg) => {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '❌ Not admin');
  bot.sendMessage(msg.chat.id, `🤖 *SMM Bot*\n\nTap a button below 👇`, mainMenu);
});

bot.onText(/^\/setqty\s+(\d+)$/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const qty = parseInt(match[1], 10);
  if (isNaN(qty) || qty < 1) return bot.sendMessage(msg.chat.id, '❌ Invalid quantity.');
  currentQty = qty;
  bot.sendMessage(msg.chat.id, `✅ Quantity updated to *${currentQty}*`, { parse_mode: 'Markdown' });
});

bot.on('callback_query', async (query) => {
  if (!isAdmin(query.from.id)) return bot.answerCallbackQuery(query.id, { text: '❌ Not admin', show_alert: true });
  bot.answerCallbackQuery(query.id).catch(() => {});
  const chatId = query.message.chat.id, msgId = query.message.message_id;
  const back = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'refresh' }]] };

  if (query.data === 'stats') return bot.editMessageText(`📊 *Stats*\n\nTotal OK: *${ordersCount}*\nTotal Fail: *${failedCount}*`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
  if (query.data === 'balance') {
    try {
      const { data } = await axios.post(PANELS[0].url, { key: PANELS[0].key, action: 'balance' }, { timeout: 10000 });
      return bot.editMessageText(`💰 *Balance*\n\n*Smmlite*: ${data.balance} ${data.currency || ''}`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
    } catch (e) { return bot.editMessageText(`❌ Error: ${e.message}`, { chat_id: chatId, message_id: msgId, reply_markup: back }); }
  }
  if (query.data === 'channels') return bot.editMessageText(`📡 *Allowed Channels*\n\n` + ALLOWED_CHANNELS.map(c => `@${c}`).join('\n'), { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
  if (query.data === 'qty') return bot.editMessageText(`🔢 *Quantity*\n\n*${currentQty}*\n\nChange via: \`/setqty 20\``, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
  if (query.data === 'service') return bot.editMessageText(`⚙️ *Service ID*\n\n*${HARDCODED_SERVICE_ID}*`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
  if (query.data === 'refresh') return bot.editMessageText(`🤖 *SMM Bot*\n\nTap a button below 👇`, { chat_id: chatId, message_id: msgId, ...mainMenu });
});

bot.on('channel_post', async (msg) => {
  const username = msg.chat.username?.toLowerCase();
  if (!username || !ALLOWED_CHANNELS.includes(username)) return;
  const link = `https://t.me/${username}/${msg.message_id}`;
  const result = await placeOrder(link, currentQty);
  if (result.ok) {
    ordersCount++;
    console.log(`✅ Success: ${link}`);
  } else {
    failedCount++;
    console.log(`❌ Failed: ${link}`);
    for (const id of ADMIN_IDS) bot.sendMessage(id, `❌ Order failed for ${link}`).catch(() => {});
  }
});

// Vercel Entry Point
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.processUpdate(req.body);
    }
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook Error:', err);
    return res.status(200).send('OK');
  }
};
