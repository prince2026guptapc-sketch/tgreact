const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ==========================================
// HARDCODED DETAILS (Saari info yahan hai)
// ==========================================
const ADMIN_IDS = [6402927432]; 
const PANEL_URL = 'https://smmlite.com/api/v2';
const SERVICE_ID = '5160';
const ALLOWED_CHANNELS = ['damanpr0', 'Tricky_Earner_Is_Live']; 

// Sirf yeh 2 Vercel Environment Variables se aayenge
const BOT_TOKEN = process.env.BOT_TOKEN; 
const SMM_API_KEY = process.env.SMM_API_KEY; 

// ==========================================
// BOT LOGIC START
// ==========================================
let currentQty = 10; 
let ordersCount = 0;
let failedCount = 0;

const isAdmin = (id) => ADMIN_IDS.includes(id);

// Bot Initialization
const bot = new TelegramBot(BOT_TOKEN, {
  request: { agentOptions: { family: 4 } }
});

// Menu Setup (HTML format use kiya hai taaki crash na ho)
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

// Place Order Logic (Timeout fix kiya gaya hai)
async function placeOrder(link, quantity) {
  try {
    const { data } = await axios.post(PANEL_URL, { 
      key: SMM_API_KEY, 
      action: 'add', 
      service: SERVICE_ID, 
      link: link, 
      quantity: quantity 
    }, { timeout: 8000 }); // Timeout 20s se kam karke 8s kiya gaya hai
    
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
      // Error message bhejte waqt parse_mode hataya gaya hai taaki link me special char ho toh crash na ho
      bot.sendMessage(id, `❌ Order failed for ${link}`).catch(() => {});
    }
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
};v
