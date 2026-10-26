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
const ADMIN_IDS = [6402927432]; 
const PANEL_URL = 'https://smmlite.com/api/v2';
const SERVICE_ID = '5160';
const BOT_TOKEN = process.env.BOT_TOKEN; 
const SMM_API_KEY = process.env.SMM_API_KEY; 
const MONGO_URI = process.env.MONGO_URI; 
const UPI_ID = process.env.UPI_ID || 'yourupi@ybl'; // Yahan apni UPI ID dalein
const PORT = process.env.PORT || 3000;

const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL 
  ? `${process.env.RENDER_EXTERNAL_URL}/webhook` 
  : `http://localhost:${PORT}/webhook`;

// ==========================================
// DATABASE SETUP (Mongoose)
// ==========================================
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.log('❌ MongoDB Error:', err.message));

// Channel Model
const Channel = mongoose.model('Channel', new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  quantity: { type: Number, default: 10 }
}));

// User Model (Premium check ke liye)
const User = mongoose.model('User', new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  isPremium: { type: Boolean, default: false },
  premiumExpiry: { type: Date, default: null }
}));

// ==========================================
// BOT & SERVER SETUP
// ==========================================
const isAdmin = (id) => ADMIN_IDS.includes(id);

const bot = new TelegramBot(BOT_TOKEN, { 
  polling: false,
  request: { agentOptions: { family: 4 } } 
});

bot.setWebHook(WEBHOOK_URL)
  .then(() => console.log('✅ Webhook successfully set!'))
  .catch((err) => console.log('❌ Webhook error:', err.message));

app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Premium Bot is running!'));

// ==========================================
// SMM PANEL LOGIC
// ==========================================
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

// ==========================================
// COMMANDS
// ==========================================

// Start Menu
const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📊 Stats', callback_data: 'stats' }, { text: '💰 Balance', callback_data: 'balance' }],
      [{ text: '🤖 Buy Premium Bot (₹300/week)', callback_data: 'buybot' }],
    ],
  },
  parse_mode: 'HTML',
};

bot.onText(/^\/start$/, (msg) => {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '❌ You are not admin.');
  bot.sendMessage(msg.chat.id, `🤖 <b>Premium SMM Bot</b>\n\nUse these commands:\n/addchannel @username\n/setqty @username 50\n/buybot`, mainMenu);
});

// 1. ADD CHANNEL
bot.onText(/^\/addchannel\s+(@\w+)$/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const channelUsername = match[1].replace('@', '').toLowerCase();

  try {
    const exists = await Channel.findOne({ username: channelUsername });
    if (exists) return bot.sendMessage(msg.chat.id, `⚠️ Channel @${channelUsername} already added.`);

    await Channel.create({ username: channelUsername });
    bot.sendMessage(msg.chat.id, `✅ Channel @${channelUsername} added successfully!\nDefault Qty: 10`);
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Database Error: ${err.message}`);
  }
});

// 2. SET QTY FOR SPECIFIC CHANNEL
bot.onText(/^\/setqty\s+(@\w+)\s+(\d+)$/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const channelUsername = match[1].replace('@', '').toLowerCase();
  const qty = parseInt(match[2], 10);

  if (qty < 1) return bot.sendMessage(msg.chat.id, '❌ Invalid quantity.');

  try {
    const channel = await Channel.findOneAndUpdate(
      { username: channelUsername },
      { quantity: qty },
      { new: true }
    );
    if (!channel) return bot.sendMessage(msg.chat.id, `❌ Channel @${channelUsername} not found. Pehle /addchannel karein.`);

    bot.sendMessage(msg.chat.id, `✅ Quantity for @${channelUsername} set to <b>${qty}</b>`, { parse_mode: 'HTML' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Database Error: ${err.message}`);
  }
});

// 3. BUY BOT (Generate UPI QR)
bot.onText(/^\/buybot$/, async (msg) => {
  const chatId = msg.chat.id;
  const amount = 300; // ₹300/week
  const upiUrl = `upi://pay?pa=${UPI_ID}&pn=PremiumBot&am=${amount}&cu=INR&tn=Bot_Premium_${msg.from.id}`;

  try {
    // QR Code Generate karein
    const qrBuffer = await QRCode.toBuffer(upiUrl);
    
    bot.sendPhoto(chatId, qrBuffer, {
      caption: `🤖 <b>Premium Bot Subscription</b>\n\n💵 <b>Amount:</b> ₹${amount} / Week\n\nPay using any UPI App (GPay, PhonePe, Paytm).\n\n<b>After payment, send screenshot to @zetagamer0 for approval.</b>`,
      parse_mode: 'HTML'
    });
  } catch (err) {
    bot.sendMessage(chatId, `❌ QR Generation Failed: ${err.message}`);
  }
});

// 4. CHANNEL POST (Automatic Order)
bot.on('channel_post', async (msg) => {
  const username = msg.chat.username?.toLowerCase();
  if (!username) return;

  try {
    // Database mein check karein ki channel allowed hai ya nahi
    const channelData = await Channel.findOne({ username: username });
    if (!channelData) return; // Agar channel add nahi hai, toh ignore karein

    const link = `https://t.me/${username}/${msg.message_id}`;
    const result = await placeOrder(link, channelData.quantity);

    if (result.ok) {
      console.log(`✅ Success: ${link} | Order ID: ${result.orderId}`);
      // Yahan aap chahein toh channel mein success message bhej sakte hain
    } else {
      console.log(`❌ Failed: ${link}`);
      for (const id of ADMIN_IDS) {
        bot.sendMessage(id, `❌ Order failed for ${link}`).catch(() => {});
      }
    }
  } catch (err) {
    console.log('Channel Post Error:', err.message);
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Premium Server running on port ${PORT}`);
});
