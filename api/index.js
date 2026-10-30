const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ==========================================
// CONFIGURATION
// ==========================================
const SUPER_ADMIN_ID = "6402927432"; 
const SUPER_ADMIN_USERNAME = "@zetagamer0"; 
const MASTER_BOT_TOKEN = process.env.BOT_TOKEN; 
const MASTER_API_KEY = process.env.SMM_API_KEY; 

const PANEL_URL = 'https://smmlite.com/api/v2';
const SERVICE_ID = '5160';
const REACTION_PRICE_PER_1000 = 13; // Custom Price Logic

const MONGO_URI = process.env.MONGO_URI; 
const PORT = process.env.PORT || 3000;

const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL 
  ? `${process.env.RENDER_EXTERNAL_URL}` 
  : `http://localhost:${PORT}`;

// ==========================================
// DATABASE MODELS
// ==========================================
mongoose.connect(MONGO_URI)
  .then(() => { console.log('✅ Connected to MongoDB'); initDatabase(); })
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

// Updated Package Model
const Package = mongoose.model('Package', new mongoose.Schema({
  name: { type: String, required: true },
  posts: { type: Number, required: true },
  reactionsPerPost: { type: Number, required: true },
  quantity: { type: Number, required: true }, // Total quantity (posts * reactionsPerPost)
  days: { type: Number, required: true },
  price: { type: Number, required: true }
}));

const Setting = mongoose.model('Setting', new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String }
}));

// SAFE INITIALIZATION
async function initDatabase() {
  try {
    const settingCount = await Setting.countDocuments();
    if (settingCount === 0) {
      await Setting.create([
        { key: 'upi_id', value: 'yourupi@ybl' },
        { key: 'usdt_trc20', value: 'YOUR_TRC20_ADDRESS' },
        { key: 'usdt_bsc', value: 'YOUR_BSC_ADDRESS' },
        { key: 'usdt_tron', value: 'YOUR_TRON_ADDRESS' },
        { key: 'admin_username', value: 'admin' },
        { key: 'admin_password', value: 'admin123' }
      ]);
      console.log('✅ Default Settings Created');
    }
    const packCount = await Package.countDocuments();
    if (packCount === 0) {
      // Default packages: 10 posts, 1000 reactions per post = 10000 total
      await Package.create([
        { name: 'Starter Pack [10 Post]', posts: 10, reactionsPerPost: 1000, quantity: 10000, days: 7, price: 130 },
        { name: 'Pro Pack [50 Post]', posts: 50, reactionsPerPost: 1000, quantity: 50000, days: 30, price: 650 }
      ]);
      console.log('✅ Default Packages Created');
    }
  } catch (err) { console.log('❌ Init DB Error:', err.message); }
}

// ==========================================
// HELPERS & SMM PANEL API
// ==========================================
const activeBots = {}; 

async function placeOrder(link, quantity, apiKey) {
  try {
    console.log(`Attempting order: ${link} | Qty: ${quantity}`);
    const { data } = await axios.post(PANEL_URL, { 
      key: apiKey, action: 'add', service: SERVICE_ID, link: link, quantity: quantity 
    }, { timeout: 10000 });
    
    if (data?.error) throw new Error(data.error);
    if (!data?.order) throw new Error('No order ID received');
    
    console.log(`✅ Panel Success: Order ID ${data.order}`);
    return { ok: true, orderId: data.order };
  } catch (err) { 
    console.log(`❌ Panel Error: ${err.message}`);
    return { ok: false, error: err.message };
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

async function sendWelcomeMenu(chatId, firstName) {
  const welcomeText = `👋 <b>Hello ${firstName}!</b>\n\nThis is a premium telegram reaction bot. That's provides high quality reaction service. Buy the service packages given below 👇`;
  const packages = await Package.find({});
  if (packages.length === 0) return adminBot.sendMessage(chatId, "❌ No packages available right now.");
  
  const keyboard = packages.map(p => {
    return [{ text: `📅 ${p.name} (${p.quantity} Rxns) - ₹${p.price}`, callback_data: `buy_pkg_${p._id}` }];
  });
  
  const menu = { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'HTML' };
  await adminBot.sendMessage(chatId, welcomeText, menu).catch(() => {});
}

adminBot.onText(/^\/start$/, async (msg) => {
  if (msg.from.id.toString() === SUPER_ADMIN_ID) {
    adminBot.sendMessage(msg.chat.id, `👑 <b>Welcome Admin!</b>\n\nUse /admin to open your dashboard.`, { parse_mode: 'HTML' });
  } else {
    await User.findOneAndUpdate({ userId: msg.from.id.toString() }, { firstName: msg.from.first_name }, { upsert: true });
    sendWelcomeMenu(msg.chat.id, msg.from.first_name);
  }
});

// ADMIN MINI APP BUTTON
adminBot.onText(/^\/admin$/, (msg) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID) {
    return adminBot.sendMessage(msg.chat.id, `❌ <b>YOU ARE NOT AN ADMIN, PLEASE USE /start TO USE BOT</b>`, { parse_mode: 'HTML' });
  }
  
  const webAppUrl = `${WEBHOOK_URL}/login.html`;
  const miniAppMenu = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Open Admin Panel', web_app: { url: webAppUrl } }]
      ]
    }
  };
  adminBot.sendMessage(msg.chat.id, `👑 <b>Welcome Admin!</b>\n\nClick below to open your dashboard.`, { parse_mode: 'HTML', ...miniAppMenu });
});

// Master Bot: Admin Channels Order Logic
adminBot.on('channel_post', async (msg) => {
  const username = msg.chat.username?.toLowerCase();
  if (!username) return;
  
  const adminChannel = await AdminChannel.findOne({ username });
  if (!adminChannel) return;

  const link = `https://t.me/${username}/${msg.message_id}`;
  const result = await placeOrder(link, adminChannel.quantity, MASTER_API_KEY);
  if (result.ok) console.log(`✅ [Admin] Success: ${link}`);
  else adminBot.sendMessage(SUPER_ADMIN_ID, `❌ Admin Order Failed: ${link}`).catch(()=>{});
});

// User Callback Queries (Payment logic)
adminBot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  
  if (data.startsWith('buy_pkg_')) {
    const pkgId = data.replace('buy_pkg_', '');
    const pkg = await Package.findById(pkgId);
    if (!pkg) return adminBot.answerCallbackQuery(query.id, { text: 'Package not found!', show_alert: true });
    adminBot.answerCallbackQuery(query.id, { text: `Selected ${pkg.name}` });
    const payKeyboard = {
      reply_markup: { inline_keyboard: [
        [{ text: '💳 Pay via UPI', callback_data: `pay_upi_${pkg._id}` }],
        [{ text: '🪙 Pay via USDT', callback_data: `pay_usdt_${pkg._id}` }],
        [{ text: '⬅️ Back', callback_data: 'back_to_menu' }]
      ]}
    };
    adminBot.sendMessage(chatId, `You selected: <b>${pkg.name}</b>\nQuantity: ${pkg.quantity} reactions\nPrice: ₹${pkg.price}\n\nChoose payment method:`, { parse_mode: 'HTML', ...payKeyboard });
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
// 2. CUSTOMER BOTS (Dynamic Bots)
// ==========================================
async function startCustomerBot(user) {
  if (!user.botToken || user.userId.toString() === SUPER_ADMIN_ID) return;
  
  try {
    const bot = new TelegramBot(user.botToken, { polling: false });
    const botPath = `/webhook/${user.userId}`;
    await bot.setWebHook(`${WEBHOOK_URL}${botPath}`);
    activeBots[user.userId] = bot;

    bot.onText(/^\/start$/, async (msg) => {
      bot.sendMessage(msg.chat.id, `👋 <b>Hello ${msg.from.first_name}!</b>\n\nAap apne channel par orders lene ke liye taiyar hain.\n\nUse <code>/setqty 50</code> to change order quantity.`, { parse_mode: 'HTML' });
    });
    
    bot.onText(/^\/setqty\s+(\d+)$/, async (msg, match) => {
      const qty = parseInt(match[1], 10);
      if (qty < 1) return bot.sendMessage(msg.chat.id, '❌ Invalid quantity.');
      await User.updateOne({ userId: user.userId }, { quantity: qty });
      bot.sendMessage(msg.chat.id, `✅ Quantity updated to <b>${qty}</b> for all your channels.`, { parse_mode: 'HTML' });
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
      else bot.sendMessage(user.userId, `❌ Order failed for ${link}\nReason: ${result.error}`).catch(()=>{});
    });
  } catch (err) { console.log(`❌ Bot Error ${user.userId}:`, err.message); }
}

app.post('/webhook/:userId', (req, res) => {
  const userId = req.params.userId;
  if (activeBots[userId]) activeBots[userId].processUpdate(req.body);
  res.sendStatus(200);
});

// ==========================================
// 3. ADMIN WEB DASHBOARD API ROUTES
// ==========================================
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const userSetting = await Setting.findOne({ key: 'admin_username' });
    const passSetting = await Setting.findOne({ key: 'admin_password' });
    const validUser = userSetting ? userSetting.value : 'admin';
    const validPass = passSetting ? passSetting.value : 'admin123';
    if (username === validUser && password === validPass) res.json({ success: true });
    else res.status(401).json({ success: false, error: 'Invalid credentials' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/change-password', async (req, res) => {
  const { newUsername, newPassword } = req.body;
  try {
    if(newUsername) await Setting.findOneAndUpdate({ key: 'admin_username' }, { value: newUsername }, { upsert: true });
    if(newPassword) await Setting.findOneAndUpdate({ key: 'admin_password' }, { value: newPassword }, { upsert: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/get-all-settings', async (req, res) => {
  try {
    const settings = await Setting.find({});
    let data = { upi_id: '', usdt_trc20: '', usdt_bsc: '', usdt_tron: '' };
    settings.forEach(s => { if(data[s.key] !== undefined) data[s.key] = s.value; });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/update-setting', async (req, res) => {
  const { key, value } = req.body;
  try {
    await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/admin/get-packages', async (req, res) => {
  try { res.json(await Package.find({})); } catch (err) { res.status(500).json({ error: err.message }); }
});

// NAYA LOGIC: Custom Package Auto Price Calculation
app.post('/api/admin/add-package', async (req, res) => {
  const { name, posts, reactionsPerPost, days } = req.body;
  try {
    const postsNum = parseInt(posts, 10);
    const rxnsNum = parseInt(reactionsPerPost, 10);
    const totalQuantity = postsNum * rxnsNum;
    
    // Formula: (Total Reactions / 1000) * 13
    const autoPrice = (totalQuantity / 1000) * REACTION_PRICE_PER_1000; 
    
    await Package.create({ 
      name: name, 
      posts: postsNum,
      reactionsPerPost: rxnsNum,
      quantity: totalQuantity, 
      days: parseInt(days, 10), 
      price: Math.ceil(autoPrice) // Round off to nearest rupee
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/admin/delete-package/:id', async (req, res) => {
  try { await Package.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const premiumUsers = await User.countDocuments({ isPremium: true });
    res.json({ totalUsers, premiumUsers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/get-users', async (req, res) => {
  try { res.json(await User.find({}, 'userId firstName isPremium expiryDate quantity').sort({ _id: -1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/get-channels', async (req, res) => {
  try { res.json(await AdminChannel.find({})); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/add-channel', async (req, res) => {
  const { username, quantity } = req.body;
  try {
    await AdminChannel.findOneAndUpdate({ username: username.toLowerCase() }, { quantity: parseInt(quantity) }, { upsert: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/delete-channel/:username', async (req, res) => {
  await AdminChannel.findOneAndDelete({ username: req.params.username });
  res.json({ success: true });
});

app.post('/api/admin/approve-user', async (req, res) => {
  const { userId, days } = req.body;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + parseInt(days));
  try {
    await User.findOneAndUpdate({ userId: userId }, { isPremium: true, expiryDate: expiry }, { upsert: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/add-customer-bot', async (req, res) => {
  const { userId, botToken, apiKey, channels } = req.body;
  try {
    const channelArray = channels ? channels.split(',').map(c => c.trim().replace('@', '').toLowerCase()) : [];
    await User.findOneAndUpdate({ userId: userId }, { botToken: botToken, panelApiKey: apiKey === 'none' ? null : apiKey, channels: channelArray }, { upsert: true });
    await startCustomerBot(await User.findOne({ userId }));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/', (req, res) => res.send('Bot is running!'));

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  const usersWithBots = await User.find({ botToken: { $ne: null }, isPremium: true });
  for (const user of usersWithBots) await startCustomerBot(user);
});
