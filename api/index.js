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
const SUPER_ADMIN_ID = 6402927432; // Aapki Telegram ID
const MASTER_BOT_TOKEN = process.env.BOT_TOKEN; 
const MASTER_API_KEY = process.env.SMM_API_KEY; // Master API Key

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

// User Model (Customer Details)
const User = mongoose.model('User', new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  firstName: { type: String },
  isPremium: { type: Boolean, default: false },
  expiryDate: { type: Date, default: null },
  botToken: { type: String, default: null }, 
  panelApiKey: { type: String, default: null }, // Optional API Key
  channels: { type: [String], default: [] },
  quantity: { type: Number, default: 10 }
}));

// Admin Channels Model (Aapke master bot ke liye)
const AdminChannel = mongoose.model('AdminChannel', new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  quantity: { type: Number, default: 10 }
}));

// ==========================================
// BOT SETUP & HELPERS
// ==========================================
const activeBots = {}; 

// Helper to place order
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

// ==========================================
// 1. MASTER BOT (Admin Bot)
// ==========================================
const adminBot = new TelegramBot(MASTER_BOT_TOKEN, { polling: false });

adminBot.setWebHook(`${WEBHOOK_URL}/webhook/admin`)
  .then(() => console.log('✅ Admin Webhook set!'))
  .catch((err) => console.log('❌ Admin Webhook error:', err.message));

app.post('/webhook/admin', (req, res) => {
  adminBot.processUpdate(req.body);
  res.sendStatus(200);
});

// Master Bot Commands
adminBot.onText(/^\/start$/, (msg) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID.toString()) return;
  adminBot.sendMessage(msg.chat.id, `👑 <b>Master Admin Panel</b>\n\n/addchannel @channel\n/setqty @channel 50\n/approve <user_id> <days>\n/addbot <user_id> <token> <apikey_or_none> <channel1,channel2>`);
});

// Admin can add his own channels
adminBot.onText(/^\/addchannel\s+(@\w+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID.toString()) return;
  const channel = match[1].replace('@', '').toLowerCase();
  try {
    await AdminChannel.findOneAndUpdate({ username: channel }, {}, { upsert: true });
    adminBot.sendMessage(msg.chat.id, `✅ Admin channel @${channel} added!`);
  } catch (err) { adminBot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`); }
});

// Admin can set quantity for his channels
adminBot.onText(/^\/setqty\s+(@\w+)\s+(\d+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID.toString()) return;
  const channel = match[1].replace('@', '').toLowerCase();
  const qty = parseInt(match[2], 10);
  try {
    const c = await AdminChannel.findOneAndUpdate({ username: channel }, { quantity: qty }, { new: true });
    if (!c) return adminBot.sendMessage(msg.chat.id, `❌ Channel not found. Add it first.`);
    adminBot.sendMessage(msg.chat.id, `✅ Admin Qty for @${channel} set to ${qty}`);
  } catch (err) { adminBot.sendMessage(msg.chat.id, `❌ Error.`); }
});

// Admin approves customer plan
adminBot.onText(/^\/approve\s+(\d+)\s+(\d+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID.toString()) return;
  const targetUserId = match[1];
  const days = parseInt(match[2], 10);
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  await User.findOneAndUpdate({ userId: targetUserId }, { isPremium: true, expiryDate: expiry }, { upsert: true });
  adminBot.sendMessage(msg.chat.id, `✅ User ${targetUserId} approved for ${days} days.`);
});

// Admin adds customer bot
adminBot.onText(/^\/addbot\s+(\d+)\s+([^\s]+)\s+([^\s]+)\s+(.+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID.toString()) return;
  const targetUserId = match[1];
  const botToken = match[2];
  const apiKey = match[3] === 'none' ? null : match[3]; // If 'none', use master key later
  const channels = match[4].split(',').map(c => c.trim().replace('@', '').toLowerCase());

  try {
    const user = await User.findOneAndUpdate(
      { userId: targetUserId },
      { botToken: botToken, panelApiKey: apiKey, channels: channels },
      { new: true, upsert: true }
    );
    adminBot.sendMessage(msg.chat.id, `✅ Customer Bot added for User ${targetUserId}.`);
    await startCustomerBot(user); // Start it immediately
  } catch (err) {
    adminBot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
  }
});

// Master Bot: Listen to Admin Channels
adminBot.on('channel_post', async (msg) => {
  const username = msg.chat.username?.toLowerCase();
  if (!username) return;

  const adminChannel = await AdminChannel.findOne({ username });
  if (!adminChannel) return;

  const link = `https://t.me/${username}/${msg.message_id}`;
  // Master API Key used here
  const result = await placeOrder(link, adminChannel.quantity, MASTER_API_KEY);
  if (result.ok) console.log(`✅ [Admin] Success: ${link}`);
  else console.log(`❌ [Admin] Failed: ${link}`);
});

// ==========================================
// 2. CUSTOMER BOTS (Dynamic)
// ==========================================
async function startCustomerBot(user) {
  if (!user.botToken) return;
  try {
    const bot = new TelegramBot(user.botToken, { polling: false });
    const botPath = `/webhook/${user.userId}`;
    await bot.setWebHook(`${WEBHOOK_URL}${botPath}`);
    activeBots[user.userId] = bot;

    // Customer commands
    bot.onText(/^\/start$/, (msg) => {
      bot.sendMessage(msg.chat.id, `👋 <b>Welcome!</b>\nUse <code>/setqty 50</code> to change order quantity.`, { parse_mode: 'HTML' });
    });

    bot.onText(/^\/setqty\s+(\d+)$/, async (msg, match) => {
      const qty = parseInt(match[1], 10);
      if (qty < 1) return bot.sendMessage(msg.chat.id, '❌ Invalid quantity.');
      await User.updateOne({ userId: user.userId }, { quantity: qty });
      bot.sendMessage(msg.chat.id, `✅ Quantity updated to <b>${qty}</b> for all your channels.`, { parse_mode: 'HTML' });
    });

    // Customer channels listener
    bot.on('channel_post', async (msg) => {
      const username = msg.chat.username?.toLowerCase();
      if (!username) return;

      const dbUser = await User.findOne({ userId: user.userId });
      if (!dbUser.isPremium || dbUser.expiryDate < new Date()) return;
      if (!dbUser.channels.includes(username)) return;

      const link = `https://t.me/${username}/${msg.message_id}`;
      
      // LOGIC: If customer has API key, use it. Otherwise use Master API Key.
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

// Routes for Customer Webhooks
app.post('/webhook/:userId', (req, res) => {
  const userId = req.params.userId;
  if (activeBots[userId]) {
    activeBots[userId].processUpdate(req.body);
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Hybrid Multi-Bot is running!'));

// ==========================================
// RECONNECT BOTS ON STARTUP
// ==========================================
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
