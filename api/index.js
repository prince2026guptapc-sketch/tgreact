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
const PANEL_URL = 'https://smmlite.com/api/v2';
const SERVICE_ID = '5160';

const MASTER_BOT_TOKEN = process.env.BOT_TOKEN; 
const MONGO_URI = process.env.MONGO_URI; 
const UPI_ID = process.env.UPI_ID || 'yourupi@ybl'; 
const PORT = process.env.PORT || 3000;

const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL 
  ? `${process.env.RENDER_EXTERNAL_URL}/webhook` 
  : `http://localhost:${PORT}/webhook`;

// ==========================================
// DATABASE MODELS (Multi-Bot Architecture)
// ==========================================
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.log('❌ MongoDB Error:', err.message));

// User Model (Customer Account)
const User = mongoose.model('User', new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  firstName: { type: String },
  isPremium: { type: Boolean, default: false },
  expiryDate: { type: Date, default: null },
  // Customer ka apna bot aur API
  botToken: { type: String, default: null }, 
  panelApiKey: { type: String, default: null },
  channels: { type: [String], default: [] }, // Customer ke channels ki list
  quantity: { type: Number, default: 10 }    // Default qty
}));

// ==========================================
// BOT & SERVER SETUP (Dynamic Webhooks)
// ==========================================
// Ek object jisme hum sabhi customer bots ke instances store karenge
const activeBots = {}; 

// Master Bot (Aapke control ke liye)
const adminBot = new TelegramBot(MASTER_BOT_TOKEN, { polling: false });

adminBot.setWebHook(`${WEBHOOK_URL}/admin`)
  .then(() => console.log('✅ Admin Webhook set!'))
  .catch((err) => console.log('❌ Admin Webhook error:', err.message));

app.post('/webhook/admin', (req, res) => {
  adminBot.processUpdate(req.body);
  res.sendStatus(200);
});

// Function to initialize a customer's bot
async function startCustomerBot(user) {
  if (!user.botToken) return;

  try {
    const bot = new TelegramBot(user.botToken, { polling: false });
    const botPath = `/webhook/${user.userId}`;
    
    // Set webhook for this specific customer's bot
    await bot.setWebHook(`${WEBHOOK_URL}${botPath}`);
    activeBots[user.userId] = bot;

    // Handle messages for customer's bot
    bot.onText(/^\/start$/, (msg) => {
      bot.sendMessage(msg.chat.id, `👋 <b>Welcome to your Premium Bot!</b>\n\nUse <code>/setqty 50</code> to change order quantity for all your channels.`, { parse_mode: 'HTML' });
    });

    // Customer can only change quantity
    bot.onText(/^\/setqty\s+(\d+)$/, async (msg, match) => {
      const qty = parseInt(match[1], 10);
      if (qty < 1) return bot.sendMessage(msg.chat.id, '❌ Invalid quantity.');

      // Update quantity in DB
      await User.updateOne({ userId: user.userId }, { quantity: qty });
      bot.sendMessage(msg.chat.id, `✅ Quantity updated to <b>${qty}</b> for all your channels.`, { parse_mode: 'HTML' });
    });

    // Handle channel posts for this bot
    bot.on('channel_post', async (msg) => {
      const username = msg.chat.username?.toLowerCase();
      if (!username) return;

      // Check if channel is managed by this user and user is premium
      const dbUser = await User.findOne({ userId: user.userId });
      if (!dbUser.isPremium || dbUser.expiryDate < new Date()) {
        return; // Plan expired, ignore
      }

      if (!dbUser.channels.includes(username)) return; // Channel not added by admin

      const link = `https://t.me/${username}/${msg.message_id}`;
      
      // Place order using CUSTOMER'S API key
      try {
        const { data } = await axios.post(PANEL_URL, { 
          key: dbUser.panelApiKey, action: 'add', service: SERVICE_ID, link: link, quantity: dbUser.quantity 
        }, { timeout: 8000 });

        if (data?.error) throw new Error(data.error);
        if (!data?.order) throw new Error('No order ID');
        
        console.log(`✅ [User ${user.userId}] Success: ${link}`);
      } catch (err) {
        console.log(`❌ [User ${user.userId}] Panel Error: ${err.message}`);
        bot.sendMessage(user.userId, `❌ Order failed for ${link}`).catch(()=>{});
      }
    });

    console.log(`🤖 Customer Bot initialized for User: ${user.userId}`);
  } catch (err) {
    console.log(`❌ Failed to start bot for ${user.userId}:`, err.message);
  }
}

// Routes for all customer webhooks
app.post('/webhook/:userId', (req, res) => {
  const userId = req.params.userId;
  if (activeBots[userId]) {
    activeBots[userId].processUpdate(req.body);
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Multi-Bot SaaS is running!'));


// ==========================================
// SUPER ADMIN COMMANDS (Aapke liye)
// ==========================================

adminBot.onText(/^\/start$/, (msg) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID.toString()) return;
  adminBot.sendMessage(msg.chat.id, `👑 <b>Master Admin Panel</b>\n\n/approve <user_id> <days>\n/addbot <user_id> <token> <apikey> <channel1,channel2>`);
});

// 1. Approve User for X days
adminBot.onText(/^\/approve\s+(\d+)\s+(\d+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID.toString()) return;
  const targetUserId = match[1];
  const days = parseInt(match[2], 10);

  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);

  await User.findOneAndUpdate(
    { userId: targetUserId },
    { isPremium: true, expiryDate: expiry },
    { upsert: true }
  );
  adminBot.sendMessage(msg.chat.id, `✅ User ${targetUserId} approved for ${days} days.`);
});

// 2. Add / Update Customer Bot Details
adminBot.onText(/^\/addbot\s+(\d+)\s+([^\s]+)\s+([^\s]+)\s+(.+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID.toString()) return;
  
  const targetUserId = match[1];
  const botToken = match[2];
  const panelApiKey = match[3];
  const channelList = match[4].split(',').map(c => c.trim().replace('@', '').toLowerCase());

  try {
    // Save to DB
    const user = await User.findOneAndUpdate(
      { userId: targetUserId },
      { 
        botToken: botToken, 
        panelApiKey: panelApiKey,
        channels: channelList 
      },
      { new: true, upsert: true }
    );

    adminBot.sendMessage(msg.chat.id, `✅ Bot details added for User ${targetUserId}.\nChannels: ${channelList.join(', ')}`);

    // Start the bot immediately
    await startCustomerBot(user);

  } catch (err) {
    adminBot.sendMessage(msg.chat.id, `❌ Error adding bot: ${err.message}`);
  }
});

// ==========================================
// RECONNECT BOTS ON STARTUP
// ==========================================
// Jab Render restart hota hai, toh sabhi active bots ko wapas start karna hota hai
async function reconnectAllBots() {
  const usersWithBots = await User.find({ botToken: { $ne: null }, isPremium: true });
  for (const user of usersWithBots) {
    await startCustomerBot(user);
  }
}

app.listen(PORT, async () => {
  console.log(`🚀 Multi-Bot Server running on port ${PORT}`);
  // Thodi der wait karke bots ko start karein
  setTimeout(reconnectAllBots, 3000); 
});
