const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ==========================================
// 1. CONFIGURATIONS (Hardcoded & Variables)
// ==========================================
const bot = new TelegramBot(BOT_TOKEN, {
  request: {
    agentOptions: {
      family: 4
    }
  }
});
const HARDCODED_API_KEY = process.env.SMM_API_KEY; 

const ADMIN_IDS = [6402927432]; 
const HARDCODED_API_URL = 'https://smmlite.com/api/v2';
const HARDCODED_SERVICE_ID = '5160';

// 📌 YAHAN APNE CHANNEL KE USERNAME DAALEIN (Bina @ ke)
// Agar multiple channels hain, toh comma laga kar add karein. Example: ['mychannel1', 'mychannel2']
const ALLOWED_CHANNELS = 'damanpr0'; 

// Default Quantity
const DEFAULT_QTY = 10; 

// ==========================================
// 2. SETUP
// ==========================================
const isAdmin = (id) => ADMIN_IDS.includes(id);
const bot = new TelegramBot(BOT_TOKEN);

const PANELS = [
  {
    name: 'Smmlite',
    url: HARDCODED_API_URL,
    key: HARDCODED_API_KEY, 
    service: HARDCODED_SERVICE_ID,
  }
];

// In-memory storage for stats (will reset on Vercel restart)
let ordersCount = 0;
let failedCount = 0;

// Place Order Logic
async function placeOrderWithFallback(link, quantity, serviceOverride) {
  const errors = [];
  for (const panel of PANELS) {
    try {
      const serviceId = serviceOverride || panel.service;
      const { data } = await axios.post(panel.url, { key: panel.key, action: 'add', service: serviceId, link, quantity }, { timeout: 15000 });
      if (data?.error) throw new Error(data.error);
      if (!data?.order) throw new Error('No order ID');
      return { ok: true, panel: panel.name, orderId: data.order };
    } catch (err) { errors.push(`${panel.name}: ${err.message}`); }
  }
  return { ok: false, errors };
}

// Commands & Menus
const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📊 Stats', callback_data: 'stats' }, { text: '💰 Balance', callback_data: 'balance' }],
      [{ text: '📡 Channels', callback_data: 'channels' }, { text: '🔢 Quantity', callback_data: 'qty' }],
      [{ text: '⚙️ Service', callback_data: 'service' }, { text: '🔌 Panels', callback_data: 'panels' }],
    ],
  },
  parse_mode: 'Markdown',
};

const menuText = `🤖 *SMM Bot*\n\nTap a button below 👇`;

bot.onText(/^\/start$/, (msg) => {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '❌ Not admin');
  bot.sendMessage(msg.chat.id, menuText, mainMenu);
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  if (!isAdmin(query.from.id)) return bot.answerCallbackQuery(query.id, { text: '❌ Not admin', show_alert: true });
  bot.answerCallbackQuery(query.id).catch(() => {});
  const back = { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'refresh' }]] };

  try {
    switch (query.data) {
      case 'stats': {
        return bot.editMessageText(`📊 *Stats*\n\nTotal OK: *${ordersCount}*\nTotal Fail: *${failedCount}*\n\n_(Stats reset on bot restart)_`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
      }
      case 'balance': {
        const lines = [];
        for (const p of PANELS) {
          try {
            const { data } = await axios.post(p.url, { key: p.key, action: 'balance' }, { timeout: 10000 });
            lines.push(`*${p.name}*: ${data.balance} ${data.currency || ''}`);
          } catch (e) { lines.push(`*${p.name}*: ❌ ${e.message}`); }
        }
        return bot.editMessageText(`💰 *Balances*\n\n${lines.join('\n')}`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
      }
      case 'channels': {
        const text = `📡 *Allowed Channels*\n\n` + ALLOWED_CHANNELS.map(c => `@${c}`).join('\n');
        return bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
      }
      case 'qty': return bot.editMessageText(`🔢 *Quantity*\n\n*${DEFAULT_QTY}*`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
      case 'service': return bot.editMessageText(`⚙️ *Service ID*\n\nCurrent: *${HARDCODED_SERVICE_ID}*`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
      case 'panels': return bot.editMessageText(`🔌 *Configured Panels*\n\n1. *Smmlite* — service \`${HARDCODED_SERVICE_ID}\``, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
      case 'refresh': return bot.editMessageText(menuText, { chat_id: chatId, message_id: msgId, ...mainMenu });
    }
  } catch (err) { console.error('Callback error:', err.message); }
});

// Auto Order on Channel Post
bot.on('channel_post', async (msg) => {
  try {
    const username = msg.chat.username?.toLowerCase();
    
    // Check if channel is in our allowed list
    if (!username || !ALLOWED_CHANNELS.includes(username)) return;

    const link = `https://t.me/${username}/${msg.message_id}`;
    
    const result = await placeOrderWithFallback(link, DEFAULT_QTY, HARDCODED_SERVICE_ID);

    if (result.ok) {
      ordersCount++;
      console.log(`✅ Order success: ${link} | ID: ${result.orderId}`);
    } else {
      failedCount++;
      console.log(`❌ Order failed: ${link} | ${result.errors.join(', ')}`);
      for (const id of ADMIN_IDS) {
        bot.sendMessage(id, `❌ Order failed for ${link}\n\n${result.errors.join('\n')}`).catch(() => {});
      }
    }
  } catch (err) { console.error('Handler error:', err.message); }
});

// ⚠️ VERCEL ENTRY POINT
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.processUpdate(req.body);
    }
    res.status(200).send('OK');
  } catch (err) {
    res.status(200).send('OK');
  }
};
