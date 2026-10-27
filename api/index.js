const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const mongoose = require('mongoose');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

// ==========================================
// CONFIGURATION
// ==========================================
const SUPER_ADMIN_ID = "6402927432"; // Aapki Master Telegram ID
const SUPER_ADMIN_USERNAME = "@zetagamer0"; // Aapki Telegram Username (Screenshot bhejne ke liye)
const MASTER_BOT_TOKEN = process.env.BOT_TOKEN; 
const MASTER_API_KEY = process.env.SMM_API_KEY; 

const PANEL_URL = 'https://smmlite.com/api/v2';
const SERVICE_ID = '5160';
const MONGO_URI = process.env.MONGO_URI; 
const UPI_ID = process.env.UPI_ID || 'yourupi@ybl'; 
const PORT = process.env.PORT || 3000;

const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL 
  ? `${process.env.RENDER_EXTERNAL_URL}` 
  : `http://localhost:${PORT}`;

// ==========================================
// DATABASE MODELS
// ==========================================
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.log('❌ MongoDB Error:', err.message));

const User = mongoose.model('User', new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  firstName: { type: String },
  isPremium: { type: Boolean, default: false },
  expiryDate: { type: Date, default: null },
  botToken: { type: String, default: null }, 
  panelApiKey: { type: String, default: null }, 
  channels: { type: [String], default: [] },
  quantity: { type: Number, default: 10 }
}));

const AdminChannel = mongoose.model('AdminChannel', new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  quantity: { type: Number, default: 10 }
}));

// ==========================================
// HELPERS
// ==========================================
const activeBots = {}; 

async function placeOrder(link, quantity, apiKey) {
  try {
    const { data } = await axios.post(PANEL_URL, { 
      key: apiKey, action: 'add', service: SERVICE_ID, link: link, quantity: quantity 
    }, { timeout: 8000 });
    if (data?.error) throw new Error(data.error);
    if (!data?.order) throw new Error('No order ID received');
    return { ok: true, orderId: data.order };
  } catch (err) { 
    console.log(`❌ Panel Error (${link}): ${err.message}`);
    return { ok: false };
  }
}

// Function to send Welcome Menu to users
async function sendWelcomeMenu(chatId, firstName) {
  const welcomeText = `👋 <b>Hello ${firstName}!</b>\n\nThis is a premium telegram reaction bot. That's provides high quality reaction service. Buy the service packages given below 👇 contact Admin for more information @zetagamer0`;
  
  const menu = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📅 1 Week - ₹300', callback_data: 'buy_300' }],
        [{ text: '📅 1 Month - ₹999', callback_data: 'buy_1000' }],
        [{ text: '📅 6 Months - ₹4999', callback_data: 'buy_5000' }],
        [{ text: '📅 1 Year - ₹8999', callback_data: 'buy_9000' }]
      ]
    },
    parse_mode: 'HTML'
  };

  await adminBot.sendMessage(chatId, welcomeText, menu).catch(() => {});
}

// ==========================================
// 1. MASTER BOT (Admin Bot & User Bot)
// ==========================================
const adminBot = new TelegramBot(MASTER_BOT_TOKEN, { polling: false });

adminBot.setWebHook(`${WEBHOOK_URL}/webhook/admin`)
  .then(() => console.log('✅ Admin Webhook set!'))
  .catch((err) => console.log('❌ Admin Webhook error:', err.message));

app.post('/webhook/admin', (req, res) => {
  adminBot.processUpdate(req.body);
  res.sendStatus(200);
});

// START COMMAND (Diffrentiates between Admin and Normal User)
adminBot.onText(/^\/start$/, (msg) => {
  if (msg.from.id.toString() === SUPER_ADMIN_ID) {
    // Admin Panel
    const adminMenu = `👑 <b>Master Admin Panel</b>\n\n<b>Available Commands:</b>\n/addchannel @channel\n/setqty @channel 50\n/approve &lt;user_id&gt; &lt;days&gt;\n/addbot &lt;user_id&gt; &lt;token&gt; &lt;apikey_or_none&gt; &lt;channel1,channel2&gt;`;
    adminBot.sendMessage(msg.chat.id, adminMenu, { parse_mode: 'HTML' });
  } else {
    // Normal User Welcome
    sendWelcomeMenu(msg.chat.id, msg.from.first_name);
  }
});

// Handle Buttons (Package Click)
adminBot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  
  if (data.startsWith('buy_')) {
    const amount = data.split('_')[1];
    const upiUrl = `upi://pay?pa=${UPI_ID}&pn=PremiumBot&am=${amount}&cu=INR&tn=Bot_Premium_${query.from.id}`;

    try {
      const qrBuffer = await QRCode.toBuffer(upiUrl);
      const caption = `✅ <b>Selected Plan: ₹${amount}</b>\n\nScan this QR code and pay ₹${amount} to <b>${UPI_ID}</b>.\n\nAfter payment, send the screenshot to ${SUPER_ADMIN_USERNAME} for activation.`;
      
      adminBot.sendPhoto(chatId, qrBuffer, { caption: caption, parse_mode: 'HTML' });
      adminBot.answerCallbackQuery(query.id, { text: 'QR Generated!' });
    } catch (err) {
      adminBot.sendMessage(chatId, `❌ Error generating QR. Please try again.`);
    }
  }
});

// Admin Commands (Only for Admin)
adminBot.onText(/^\/addchannel\s+(@\w+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID) return;
  const channel = match[1].replace('@', '').toLowerCase();
  try {
    await AdminChannel.findOneAndUpdate({ username: channel }, {}, { upsert: true });
    adminBot.sendMessage(msg.chat.id, `✅ Admin channel @${channel} added!`);
  } catch (err) { adminBot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`); }
});

adminBot.onText(/^\/setqty\s+(@\w+)\s+(\d+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID) return;
  const channel = match[1].replace('@', '').toLowerCase();
  const qty = parseInt(match[2], 10);
  try {
    const c = await AdminChannel.findOneAndUpdate({ username: channel }, { quantity: qty }, { new: true });
    if (!c) return adminBot.sendMessage(msg.chat.id, `❌ Channel not found. Add it first.`);
    adminBot.sendMessage(msg.chat.id, `✅ Admin Qty for @${channel} set to ${qty}`);
  } catch (err) { adminBot.sendMessage(msg.chat.id, `❌ Error.`); }
});

adminBot.onText(/^\/approve\s+(\d+)\s+(\d+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID) return;
  const targetUserId = match[1];
  const days = parseInt(match[2], 10);
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  
  await User.findOneAndUpdate({ userId: targetUserId }, { isPremium: true, expiryDate: expiry }, { upsert: true });
  adminBot.sendMessage(msg.chat.id, `✅ User ${targetUserId} approved for ${days} days.`);
  adminBot.sendMessage(targetUserId, `🎉 Your Premium plan is active for ${days} days!`).catch(()=>{});
});

adminBot.onText(/^\/addbot\s+(\d+)\s+([^\s]+)\s+([^\s]+)\s+(.+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID) return;
  const targetUserId = match[1];
  const botToken = match[2];
  let apiKey = match[3].trim();
  const channels = match[4].split(',').map(c => c.trim().replace('@', '').toLowerCase());

  if (apiKey.toLowerCase() === 'none') apiKey = null;
  if (targetUserId === SUPER_ADMIN_ID) return adminBot.sendMessage(msg.chat.id, `❌ You cannot add yourself as a customer.`);

  try {
    const user = await User.findOneAndUpdate(
      { userId: targetUserId },
      { botToken: botToken, panelApiKey: apiKey, channels: channels },
      { new: true, upsert: true }
    );
    adminBot.sendMessage(msg.chat.id, `✅ Customer Bot added for User ${targetUserId}.`);
    await startCustomerBot(user); 
  } catch (err) {
    adminBot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
});

adminBot.on('channel_post', async (msg) => {
  const username = msg.chat.username?.toLowerCase();
  if (!username) return;
  const adminChannel = await AdminChannel.findOne({ username });
  if (!adminChannel) return;

  const link = `https://t.me/${username}/${msg.message_id}`;
  const result = await placeOrder(link, adminChannel.quantity, MASTER_API_KEY);
  if (result.ok) console.log(`✅ [Admin] Success: ${link}`);
});

// ==========================================
// 2. CUSTOMER BOTS (Dynamic)
// ==========================================
async function startCustomerBot(user) {
  if (!user.botToken) return;
  if (user.userId.toString() === SUPER_ADMIN_ID) return; 

  try {
    const bot = new TelegramBot(user.botToken, { polling: false });
    const botPath = `/webhook/${user.userId}`;
    await bot.setWebHook(`${WEBHOOK_URL}${botPath}`);
    activeBots[user.userId] = bot;

    bot.onText(/^\/start$/, (msg) => {
      const welcomeText = `👋 <b>Hello ${msg.from.first_name}!</b>\n\nThis is a premium telegram reaction bot. That's provides high quality reaction service. Buy the service packages given below 👇`;
      const menu = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📅 1 Week - ₹300', callback_data: 'buy_300' }],
            [{ text: '📅 1 Month - ₹1000', callback_data: 'buy_1000' }],
            [{ text: '📅 6 Months - ₹5000', callback_data: 'buy_5000' }],
            [{ text: '📅 1 Year - ₹9000', callback_data: 'buy_9000' }]
          ]
        },
        parse_mode: 'HTML'
      };
      bot.sendMessage(msg.chat.id, welcomeText, menu).catch(()=>{});
    });

    bot.on('callback_query', async (query) => {
      if (query.data.startsWith('buy_')) {
        const amount = query.data.split('_')[1];
        const chatId = query.message.chat.id;
        const upiUrl = `upi://pay?pa=${UPI_ID}&pn=PremiumBot&am=${amount}&cu=INR&tn=Bot_Premium_${query.from.id}`;
        try {
          const qrBuffer = await QRCode.toBuffer(upiUrl);
          const caption = `✅ <b>Selected Plan: ₹${amount}</b>\n\nScan this QR code and pay ₹${amount} to <b>${UPI_ID}</b>.\n\nAfter payment, send the screenshot to ${SUPER_ADMIN_USERNAME} for activation.`;
          bot.sendPhoto(chatId, qrBuffer, { caption: caption, parse_mode: 'HTML' });
          bot.answerCallbackQuery(query.id, { text: 'QR Generated!' });
        } catch (err) { bot.sendMessage(chatId, `❌ Error generating QR.`); }
      }
    });

    bot.onText(/^\/setqty\s+(\d+)$/, async (msg, match) => {
      const qty = parseInt(match[1], 10);
      if (qty < 1) return bot.sendMessage(msg.chat.id, '❌ Invalid quantity.');
      await User.updateOne({ userId: user.userId }, { quantity: qty });
      bot.sendMessage(msg.chat.id, `✅ Quantity updated to <b>${qty}</b>`, { parse_mode: 'HTML' });
    });

    bot.on('channel_post', async (msg) => {
      const username = msg.chat.username?.toLowerCase();
      if (!username) return;

      const dbUser = await User.findOne({ userId: user.userId });
      if (!dbUser.isPremium || dbUser.expiryDate < new Date()) return;
      if (!dbUser.channels.includes(username)) return;

      const link = `https://t.me/${username}/${msg.message_id}`;
      const apiKeyToUse = dbUser.panelApiKey ? dbUser.panelApiKey : MASTER_API_KEY;
      const result = await placeOrder(link, dbUser.quantity, apiKeyToUse);
      
      if (result.ok) console.log(`✅ [Customer ${user.userId}] Success: ${link}`);
      else bot.sendMessage(user.userId, `❌ Order failed for ${link}`).catch(()=>{});
    });

    console.log(`🤖 Customer Bot initialized for User: ${user.userId}`);
  } catch (err) {
    console.log(`❌ Failed to start bot for ${user.userId}:`, err.message);
  }
}

app.post('/webhook/:userId', (req, res) => {
  const userId = req.params.userId;
  if (activeBots[userId]) {
    activeBots[userId].processUpdate(req.body);
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Hybrid Multi-Bot is running!'));

async function reconnectAllBots() {
  const usersWithBots = await User.find({ botToken: { $ne: null }, isPremium: true });
  for (const user of usersWithBots) {
    await startCustomerBot(user);
  }
}

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  setTimeout(reconnectAllBots, 3000); 
});
