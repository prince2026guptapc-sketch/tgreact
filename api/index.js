// Code ke top par add karein
const translations = {
  en: {
    welcome: (name) => `👋 <b>Hello ${name}!</b>\n\nThis is a premium telegram reaction bot. Buy packages below 👇`,
    selectLang: `Please select your language / कृपया अपनी भाषा चुनें:`,
    choosePayment: `Choose payment method:`,
    payUpi: `💳 Pay via UPI`,
    payUsdt: `🪙 Pay via USDT`
  },
  hi: {
    welcome: (name) => `👋 <b>नमस्ते ${name}!</b>\n\nयह एक प्रीमियम टेलीग्राम रिएक्शन बॉट है। नीचे पैकेज खरीदें 👇`,
    selectLang: `कृपया अपनी भाषा चुनें:`,
    choosePayment: `भुगतान विधि चुनें:`,
    payUpi: `💳 UPI से भुगतान करें`,
    payUsdt: `🪙 USDT से भुगतान करें`
  }
};

// /start command mein language ka option add karein
adminBot.onText(/^\/start$/, async (msg) => {
  if (msg.from.id.toString() === SUPER_ADMIN_ID) {
    // Admin menu same rahega
  } else {
    // Language choose karne ka button
    const langMenu = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🇬🇧 English', callback_data: 'lang_en' }],
          [{ text: '🇮🇳 हिंदी', callback_data: 'lang_hi' }]
        ]
      }
    };
    adminBot.sendMessage(msg.chat.id, translations.en.selectLang, langMenu);
  }
});

// Callback query handle karein
adminBot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const lang = query.data.split('_')[1]; // 'en' ya 'hi'

  if (query.data.startsWith('lang_')) {
    // User ki language database mein save karein (User model mein 'lang' field add karna hoga)
    await User.updateOne({ userId: query.from.id.toString() }, { lang: lang }, { upsert: true });
    
    const t = translations[lang];
    adminBot.sendMessage(chatId, t.welcome(query.from.first_name));
    adminBot.answerCallbackQuery(query.id, { text: `Language changed to ${lang === 'en' ? 'English' : 'Hindi'}` });
  }
});
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
const SUPER_ADMIN_ID = "6402927432"; 
const SUPER_ADMIN_USERNAME = "@zetagamer0"; 
const MASTER_BOT_TOKEN = process.env.BOT_TOKEN; 
const MASTER_API_KEY = process.env.SMM_API_KEY; 

const PANEL_URL = 'https://smmlite.com/api/v2';
const SERVICE_ID = '5160';
const MONGO_URI = process.env.MONGO_URI; 
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

const Package = mongoose.model('Package', new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  days: { type: Number, required: true }
}));

const Setting = mongoose.model('Setting', new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String }
}));

// Initialize default packages and settings if empty
async function initDatabase() {
  const packCount = await Package.countDocuments();
  if (packCount === 0) {
    await Package.create([
      { name: '1 Week', price: 300, days: 7 },
      { name: '1 Month', price: 1000, days: 30 },
      { name: '6 Months', price: 5000, days: 180 },
      { name: '1 Year', price: 9000, days: 365 }
    ]);
  }
  await Setting.findOneAndUpdate({ key: 'upi_id' }, { value: 'yourupi@ybl' }, { upsert: true });
  await Setting.findOneAndUpdate({ key: 'usdt_trc20' }, { value: 'YOUR_TRC20_ADDRESS' }, { upsert: true });
  await Setting.findOneAndUpdate({ key: 'usdt_bsc' }, { value: 'YOUR_BSC_ADDRESS' }, { upsert: true });
  await Setting.findOneAndUpdate({ key: 'usdt_tron' }, { value: 'YOUR_TRON_ADDRESS' }, { upsert: true });
}
initDatabase();

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

// Function to generate Welcome & Plans Menu dynamically
async function sendWelcomeMenu(chatId, firstName) {
  const welcomeText = `👋 <b>Hello ${firstName}!</b>\n\nThis is a premium telegram reaction bot. That's provides high quality reaction service. Buy the service packages given below 👇`;
  
  const packages = await Package.find({});
  const keyboard = packages.map(p => [
    { text: `📅 ${p.name} - ₹${p.price}`, callback_data: `buy_pkg_${p._id}` }
  ]);

  const menu = { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'HTML' };
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

// START COMMAND
adminBot.onText(/^\/start$/, async (msg) => {
  if (msg.from.id.toString() === SUPER_ADMIN_ID) {
    const adminMenu = `👑 <b>Master Admin Panel</b>\n\n<b>Bot Commands:</b>\n/addchannel @channel\n/setqty @channel 50\n/approve &lt;user_id&gt; &lt;days&gt;\n/addbot &lt;user_id&gt; &lt;token&gt; &lt;apikey_or_none&gt; &lt;channel1,channel2&gt;\n\n<b>Payment & Packages:</b>\n/setupi &lt;upi_id&gt;\n/setusdt &lt;trc20|bsc|tron&gt; &lt;address&gt;\n/addpackage &lt;name&gt; &lt;price&gt; &lt;days&gt;\n/listpackages\n/deletepackage &lt;package_id&gt;`;
    adminBot.sendMessage(msg.chat.id, adminMenu, { parse_mode: 'HTML' });
  } else {
    sendWelcomeMenu(msg.chat.id, msg.from.first_name);
  }
});

// ADMIN: SET UPI ID
adminBot.onText(/^\/setupi\s+(.+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID) return;
  const upi = match[1].trim();
  await Setting.findOneAndUpdate({ key: 'upi_id' }, { value: upi }, { upsert: true });
  adminBot.sendMessage(msg.chat.id, `✅ UPI ID updated to: ${upi}`);
});

// ADMIN: SET USDT ADDRESS
adminBot.onText(/^\/setusdt\s+(trc20|bsc|tron)\s+(.+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID) return;
  const network = match[1].toLowerCase();
  const address = match[2].trim();
  await Setting.findOneAndUpdate({ key: `usdt_${network}` }, { value: address }, { upsert: true });
  adminBot.sendMessage(msg.chat.id, `✅ USDT ${network.toUpperCase()} address updated to:\n<code>${address}</code>`, { parse_mode: 'HTML' });
});

// ADMIN: ADD PACKAGE
adminBot.onText(/^\/addpackage\s+(.+)\s+(\d+)\s+(\d+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID) return;
  const name = match[1].trim();
  const price = parseInt(match[2], 10);
  const days = parseInt(match[3], 10);

  await Package.create({ name, price, days });
  adminBot.sendMessage(msg.chat.id, `✅ Package Added:\nName: ${name}\nPrice: ₹${price}\nDays: ${days}`);
});

// ADMIN: LIST PACKAGES
adminBot.onText(/^\/listpackages$/, async (msg) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID) return;
  const packages = await Package.find({});
  if (packages.length === 0) return adminBot.sendMessage(msg.chat.id, '❌ No packages found.');

  let text = `📦 <b>Available Packages:</b>\n\n`;
  packages.forEach(p => {
    text += `ID: <code>${p._id}</code>\nName: ${p.name}\nPrice: ₹${p.price}\nDays: ${p.days}\n\n`;
  });
  adminBot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

// ADMIN: DELETE PACKAGE
adminBot.onText(/^\/deletepackage\s+(.+)$/, async (msg, match) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID) return;
  const id = match[1].trim();
  try {
    await Package.findByIdAndDelete(id);
    adminBot.sendMessage(msg.chat.id, `✅ Package deleted successfully.`);
  } catch (err) {
    adminBot.sendMessage(msg.chat.id, `❌ Invalid Package ID.`);
  }
});

// ADMIN OTHER COMMANDS
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
// USER CALLBACK QUERIES (Package & Payments)
// ==========================================
adminBot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  
  if (data.startsWith('buy_pkg_')) {
    const pkgId = data.replace('buy_pkg_', '');
    const pkg = await Package.findById(pkgId);
    if (!pkg) return adminBot.answerCallbackQuery(query.id, { text: 'Package not found!', show_alert: true });
    
    adminBot.answerCallbackQuery(query.id, { text: `Selected ${pkg.name} (₹${pkg.price})` });
    
    const payKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Pay via UPI', callback_data: `pay_upi_${pkg._id}` }],
          [{ text: '🪙 Pay via USDT', callback_data: `pay_usdt_${pkg._id}` }],
          [{ text: '⬅️ Back', callback_data: 'back_to_menu' }]
        ]
      }
    };
    adminBot.sendMessage(chatId, `You selected: <b>${pkg.name}</b> (₹${pkg.price})\n\nChoose payment method:`, { parse_mode: 'HTML', ...payKeyboard });
  }

  if (data.startsWith('pay_upi_')) {
    const pkgId = data.replace('pay_upi_', '');
    const pkg = await Package.findById(pkgId);
    const upiSetting = await Setting.findOne({ key: 'upi_id' });
    const upiId = upiSetting ? upiSetting.value : 'not_set';

    const upiUrl = `upi://pay?pa=${upiId}&pn=PremiumBot&am=${pkg.price}&cu=INR&tn=Bot_Premium_${query.from.id}`;
    const qrBuffer = await QRCode.toBuffer(upiUrl);
    const caption = `✅ <b>Plan: ${pkg.name} (₹${pkg.price})</b>\n\nScan this QR code or pay to UPI ID:\n<code>${upiId}</code>\n\nAfter payment, send the screenshot to ${SUPER_ADMIN_USERNAME} for activation.`;

    adminBot.sendPhoto(chatId, qrBuffer, { caption: caption, parse_mode: 'HTML' });
  }

  if (data.startsWith('pay_usdt_')) {
    const pkgId = data.replace('pay_usdt_', '');
    const pkg = await Package.findById(pkgId);
    const trc20 = await Setting.findOne({ key: 'usdt_trc20' });
    const bsc = await Setting.findOne({ key: 'usdt_bsc' });
    const tron = await Setting.findOne({ key: 'usdt_tron' });

    const text = `✅ <b>Plan: ${pkg.name} (₹${pkg.price})</b>\n\nSend the exact USDT amount to any of these addresses (Network specific):\n\n🔹 <b>TRC20:</b>\n<code>${trc20 ? trc20.value : 'Not Set'}</code>\n\n🔹 <b>BSC (BEP20):</b>\n<code>${bsc ? bsc.value : 'Not Set'}</code>\n\n🔹 <b>TRON:</b>\n<code>${tron ? tron.value : 'Not Set'}</code>\n\n⚠️ <b>WARNING:</b> Send ONLY to the correct network. Wrong network = loss of funds.\n\nAfter payment, send the screenshot to ${SUPER_ADMIN_USERNAME} for activation.`;

    adminBot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  }

  if (data === 'back_to_menu') {
    adminBot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
    sendWelcomeMenu(chatId, query.from.first_name);
  }
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
        const upiSetting = await Setting.findOne({ key: 'upi_id' });
        const upiId = upiSetting ? upiSetting.value : 'not_set';
        
        const upiUrl = `upi://pay?pa=${upiId}&pn=PremiumBot&am=${amount}&cu=INR&tn=Bot_Premium_${query.from.id}`;
        try {
          const qrBuffer = await QRCode.toBuffer(upiUrl);
          const caption = `✅ <b>Selected Plan: ₹${amount}</b>\n\nScan this QR code and pay ₹${amount} to <b>${upiId}</b>.\n\nAfter payment, send the screenshot to ${SUPER_ADMIN_USERNAME} for activation.`;
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
