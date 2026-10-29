const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const path = require('path');
const basicAuth = require('express-basic-auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'))); // Dashboard serve karne ke liye

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
  .then(() => {
    console.log('✅ Connected to MongoDB');
    initDatabase(); // Sirf ek baar safe initialization karega
  })
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

// SAFE INITIALIZATION (Data Reset Problem Solved)
async function initDatabase() {
  try {
    // Sirf tab add karega jab database bilkul khali ho
    const settingCount = await Setting.countDocuments();
    if (settingCount === 0) {
      await Setting.create([
        { key: 'upi_id', value: 'yourupi@ybl' },
        { key: 'usdt_trc20', value: 'YOUR_TRC20_ADDRESS' },
        { key: 'usdt_bsc', value: 'YOUR_BSC_ADDRESS' },
        { key: 'usdt_tron', value: 'YOUR_TRON_ADDRESS' }
      ]);
      console.log('✅ Default Settings Created');
    }
    
    const packCount = await Package.countDocuments();
    if (packCount === 0) {
      await Package.create([
        { name: '1 Week', price: 300, days: 7 },
        { name: '1 Month', price: 1000, days: 30 },
        { name: '6 Months', price: 5000, days: 180 },
        { name: '1 Year', price: 9000, days: 365 }
      ]);
      console.log('✅ Default Packages Created');
    }
  } catch (err) {
    console.log('❌ Init DB Error:', err.message);
  }
}

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

// ==========================================
// 1. MASTER BOT (ADMIN BOT)
// ==========================================
// FIX: Admin Bot ko pehle initialize kiya gaya hai taaki ReferenceError na aaye
const adminBot = new TelegramBot(MASTER_BOT_TOKEN, { polling: false });

adminBot.setWebHook(`${WEBHOOK_URL}/webhook/admin`)
  .then(() => console.log('✅ Admin Webhook set!'))
  .catch((err) => console.log('❌ Admin Webhook error:', err.message));

app.post('/webhook/admin', (req, res) => {
  adminBot.processUpdate(req.body);
  res.sendStatus(200);
});

// Function to generate Welcome & Plans Menu dynamically
async function sendWelcomeMenu(chatId, firstName) {
  const welcomeText = `👋 <b>Hello ${firstName}!</b>\n\nThis is a premium telegram reaction bot. That's provides high quality reaction service. Buy the service packages given below 👇`;
  
  const packages = await Package.find({});
  if (packages.length === 0) return adminBot.sendMessage(chatId, "❌ No packages available right now.");

  const keyboard = packages.map(p => [
    { text: `📅 ${p.name} - ₹${p.price}`, callback_data: `buy_pkg_${p._id}` }
  ]);
  const menu = { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'HTML' };
  await adminBot.sendMessage(chatId, welcomeText, menu).catch(() => {});
}

adminBot.onText(/^\/start$/, async (msg) => {
  if (msg.from.id.toString() === SUPER_ADMIN_ID) {
    const adminMenu = `👑 <b>Master Admin Panel</b>\n\n<b>Bot Commands:</b>\n/addchannel @channel\n/setqty @channel 50\n/approve &lt;user_id&gt; &lt;days&gt;\n/addbot &lt;user_id&gt; &lt;token&gt; &lt;apikey_or_none&gt; &lt;channel1,channel2&gt;\n\n<b>Web Dashboard:</b>\nApni website par /admin.html kholiye.`;
    adminBot.sendMessage(msg.chat.id, adminMenu, { parse_mode: 'HTML' });
  } else {
    sendWelcomeMenu(msg.chat.id, msg.from.first_name);
  }
});

// ... (Baki Admin Commands: addchannel, setqty, approve, addbot same rahenge) ...

// USER CALLBACK QUERIES
adminBot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  
  if (data.startsWith('buy_pkg_')) {
    const pkgId = data.replace('buy_pkg_', '');
    const pkg = await Package.findById(pkgId);
    if (!pkg) return adminBot.answerCallbackQuery(query.id, { text: 'Package not found!', show_alert: true });
    
    adminBot.answerCallbackQuery(query.id, { text: `Selected ${pkg.name}` });
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
    adminBot.sendPhoto(chatId, qrBuffer, { 
      caption: `✅ <b>Plan: ${pkg.name} (₹${pkg.price})</b>\n\nScan & pay to UPI:\n<code>${upiId}</code>\n\nSend screenshot to ${SUPER_ADMIN_USERNAME}`, 
      parse_mode: 'HTML' 
    });
  }

  if (data.startsWith('pay_usdt_')) {
    const pkgId = data.replace('pay_usdt_', '');
    const pkg = await Package.findById(pkgId);
    const trc20 = await Setting.findOne({ key: 'usdt_trc20' });
    const bsc = await Setting.findOne({ key: 'usdt_bsc' });
    const tron = await Setting.findOne({ key: 'usdt_tron' });
    const text = `✅ <b>Plan: ${pkg.name} (₹${pkg.price})</b>\n\n<b>TRC20:</b>\n<code>${trc20 ? trc20.value : 'N/A'}</code>\n\n<b>BSC:</b>\n<code>${bsc ? bsc.value : 'N/A'}</code>\n\n<b>TRON:</b>\n<code>${tron ? tron.value : 'N/A'}</code>\n\n⚠️ Send correct network. Screenshot to ${SUPER_ADMIN_USERNAME}`;
    adminBot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  }

  if (data === 'back_to_menu') {
    adminBot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
    sendWelcomeMenu(chatId, query.from.first_name);
  }
});


// ==========================================
// 2. CUSTOMER BOTS (Same as before)
// ==========================================
async function startCustomerBot(user) {
  if (!user.botToken || user.userId.toString() === SUPER_ADMIN_ID) return;
  try {
    const bot = new TelegramBot(user.botToken, { polling: false });
    const botPath = `/webhook/${user.userId}`;
    await bot.setWebHook(`${WEBHOOK_URL}${botPath}`);
    activeBots[user.userId] = bot;

    bot.onText(/^\/start$/, (msg) => {
      bot.sendMessage(msg.chat.id, `👋 <b>Hello ${msg.from.first_name}!</b>\nUse /setqty to change.`, { parse_mode: 'HTML' });
    });
    // ... (Customer logic same as before)
  } catch (err) { console.log(`❌ Bot Error ${user.userId}:`, err.message); }
}


// ==========================================
// 3. ADVANCED ADMIN WEB DASHBOARD API ROUTES
// ==========================================
// Dashboard ko password se protect kiya (admin / admin123)
app.use('/admin.html', basicAuth({ users: { 'admin': 'admin123' }, challenge: true, realm: 'AdminPanel' }));

// Get Settings
app.get('/api/admin/get-settings', async (req, res) => {
  try {
    const upi = await Setting.findOne({ key: 'upi_id' });
    const trc20 = await Setting.findOne({ key: 'usdt_trc20' });
    res.json({ upi: upi?.value || '', trc20: trc20?.value || '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update Settings
app.post('/api/admin/update-setting', async (req, res) => {
  const { key, value } = req.body;
  try {
    await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Get Packages List
app.get('/api/admin/get-packages', async (req, res) => {
  try {
    const packages = await Package.find({});
    res.json(packages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add Package
app.post('/api/admin/add-package', async (req, res) => {
  const { name, price, days } = req.body;
  try {
    await Package.create({ name, price, days });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Delete Package
app.delete('/api/admin/delete-package/:id', async (req, res) => {
  try {
    await Package.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Get Stats (Total Users, Premium Users)
app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const premiumUsers = await User.countDocuments({ isPremium: true });
    res.json({ totalUsers, premiumUsers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ==========================================
// SERVER START
// ==========================================
app.get('/', (req, res) => res.send('Bot is running!'));

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  // Bots ko reconnect karein
  const usersWithBots = await User.find({ botToken: { $ne: null }, isPremium: true });
  for (const user of usersWithBots) {
    await startCustomerBot(user);
  }
});
