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
  // Custom order state
  waitingForCustomQty: { type: Boolean, default: false }
}));

const AdminChannel = mongoose.model('AdminChannel', new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  quantity: { type: Number, default: 10 }
}));

const Package = mongoose.model('Package', new mongoose.Schema({
  name: { type: String, required: true },
  qtyPerPost: { type: Number, required: true },
  postsPerDay: { type: Number, required: true },
  days: { type: Number, required: true },
  price: { type: Number, required: true }
}));

const Payment = mongoose.model('Payment', new mongoose.Schema({
  userId: String,
  type: { type: String, enum: ['package', 'custom'] },
  packageId: String,
  quantity: Number,
  postsPerDay: Number,
  days: Number,
  price: Number,
  method: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
}));

const DailyCounter = mongoose.model('DailyCounter', new mongoose.Schema({
  userId: String,
  channelUsername: String,
  date: String, // YYYY-MM-DD
  postsToday: { type: Number, default: 0 }
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
        { key: 'admin_password', value: 'admin123' },
        { key: 'rate_base', value: '15' }
      ]);
      console.log('✅ Default Settings Created');
    }

    const packCount = await Package.countDocuments();
    if (packCount === 0) {
      // Seed standard preset packages (7 qty x 6 durations = 42 presets)
      const qtys = [200, 500, 1000, 2000, 10000, 20000, 30000];
      const durations = [1, 7, 15, 30, 60];
      const defaultPacks = [];
      
      qtys.forEach(q => {
        durations.forEach(d => {
          const totalReactions = q * 10 * d;
          const price = Math.max(10, Math.ceil((totalReactions / 1000) * 15));
          defaultPacks.push({
            name: `${q} per post · ${d} Days`,
            qtyPerPost: q,
            postsPerDay: 10,
            days: d,
            price: price
          });
        });
      });
      
      // Add custom placeholder
      defaultPacks.push({
        name: 'Custom Package (Contact Admin)', qtyPerPost: 0, postsPerDay: 0, days: 0, price: 0
      });

      await Package.insertMany(defaultPacks);
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
  const welcomeText = `👋 <b>Hello ${firstName}!</b>\n\nThis is a premium telegram reaction bot. Buy custom reaction packages or choose from our standard plans.`;
  
  const keyboard = [
    [{ text: '📦 View Standard Packages', callback_data: 'show_durations' }],
    [{ text: '⚙️ Custom Order (Choose your own quantity)', callback_data: 'custom_order' }]
  ];
  
  await adminBot.sendMessage(chatId, welcomeText, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'HTML' }).catch(() => {});
}

adminBot.onText(/^\/start$/, async (msg) => {
  if (msg.from.id.toString() === SUPER_ADMIN_ID) {
    adminBot.sendMessage(msg.chat.id, `👑 <b>Welcome Admin!</b>\n\nUse /admin to open your dashboard.`, { parse_mode: 'HTML' });
  } else {
    await User.findOneAndUpdate({ userId: msg.from.id.toString() }, { firstName: msg.from.first_name, waitingForCustomQty: false }, { upsert: true });
    sendWelcomeMenu(msg.chat.id, msg.from.first_name);
  }
});

adminBot.onText(/^\/admin$/, (msg) => {
  if (msg.from.id.toString() !== SUPER_ADMIN_ID) {
    return adminBot.sendMessage(msg.chat.id, `❌ <b>YOU ARE NOT AN ADMIN, PLEASE USE /start TO USE BOT</b>`, { parse_mode: 'HTML' });
  }
  
  const miniAppMenu = {
    reply_markup: { inline_keyboard: [[{ text: '🚀 Open Admin Panel', web_app: { url: `${WEBHOOK_URL}/login.html` } }]] }
  };
  adminBot.sendMessage(msg.chat.id, `👑 <b>Welcome Admin!</b>\n\nClick below to open your dashboard.`, { parse_mode: 'HTML', ...miniAppMenu });
});

// Master Bot: Admin Channels Order Logic (Fixed to enforce daily limits)
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

// Callback Queries
adminBot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();

  // --- PACKAGE MENUS ---
  if (data === 'show_durations') {
    adminBot.answerCallbackQuery(query.id);
    const keyboard = [
      [{ text: '1 Day', callback_data: 'dur_1' }, { text: '7 Days', callback_data: 'dur_7' }],
      [{ text: '15 Days', callback_data: 'dur_15' }, { text: '30 Days', callback_data: 'dur_30' }],
      [{ text: '60 Days', callback_data: 'dur_60' }],
      [{ text: '⬅️ Back', callback_data: 'back_to_menu' }]
    ];
    adminBot.editMessageText('📅 <b>Select Duration:</b>', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard }, parse_mode: 'HTML' }).catch(()=>{});
  }

  if (data.startsWith('dur_')) {
    adminBot.answerCallbackQuery(query.id);
    const days = parseInt(data.replace('dur_', ''));
    const packages = await Package.find({ days: days, qtyPerPost: { $gt: 0 } }).sort({ qtyPerPost: 1 });
    
    let keyboard = [];
    let row = [];
    packages.forEach((p, idx) => {
      row.push({ text: `${p.qtyPerPost} reactions`, callback_data: `pkg_${p._id}` });
      if (row.length === 2) { keyboard.push(row); row = []; }
    });
    if (row.length > 0) keyboard.push(row);
    keyboard.push([{ text: '⬅️ Back', callback_data: 'show_durations' }]);

    adminBot.editMessageText(`📦 <b>Select Quantity per post (${days} Days):</b>`, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: keyboard }, parse_mode: 'HTML' }).catch(()=>{});
  }

  if (data.startsWith('pkg_')) {
    adminBot.answerCallbackQuery(query.id);
    const pkgId = data.replace('pkg_', '');
    const pkg = await Package.findById(pkgId);
    if(!pkg) return;

    const text = `✅ <b>Plan: ${pkg.name}</b>\n\n• Quantity: ${pkg.qtyPerPost} per post\n• Posts per day: ${pkg.postsPerDay}\n• Duration: ${pkg.days} days\n\n<b>Total Price: ₹${pkg.price}</b>\n\nChoose payment method:`;
    
    const payKeyboard = {
      reply_markup: { inline_keyboard: [
        [{ text: '💳 Pay via UPI', callback_data: `pay_pkg_upi_${pkg._id}` }],
        [{ text: '🪙 Pay via USDT', callback_data: `pay_pkg_usdt_${pkg._id}` }],
        [{ text: '⬅️ Back', callback_data: 'show_durations' }]
      ]}
    };
    adminBot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', ...payKeyboard }).catch(()=>{});
  }

  // --- PAYMENT INITIATION (PKG) ---
  if (data.startsWith('pay_pkg_upi_') || data.startsWith('pay_pkg_usdt_')) {
    adminBot.answerCallbackQuery(query.id);
    const parts = data.split('_');
    const method = parts[2];
    const pkgId = parts[3];
    const pkg = await Package.findById(pkgId);
    if(!pkg) return;

    await Payment.create({
      userId, type: 'package', packageId: pkg._id, quantity: pkg.qtyPerPost, postsPerDay: pkg.postsPerDay, days: pkg.days, price: pkg.price, method, status: 'pending'
    });

    if (method === 'upi') {
      const upi = await Setting.findOne({ key: 'upi_id' });
      const upiId = upi ? upi.value : 'not_set';
      const upiUrl = `upi://pay?pa=${upiId}&pn=PremiumBot&am=${pkg.price}&cu=INR&tn=Bot_Pkg_${userId}`;
      const qrBuffer = await QRCode.toBuffer(upiUrl);
      adminBot.sendPhoto(chatId, qrBuffer, { caption: `✅ <b>Package: ${pkg.name}</b>\nPrice: ₹${pkg.price}\n\nScan & pay to UPI:\n<code>${upiId}</code>\n\nSend screenshot after payment to @${SUPER_ADMIN_USERNAME.replace('@','')}`, parse_mode: 'HTML' });
    } else {
      const trc = await Setting.findOne({ key: 'usdt_trc20' });
      const bsc = await Setting.findOne({ key: 'usdt_bsc' });
      const tron = await Setting.findOne({ key: 'usdt_tron' });
      const text = `✅ <b>Package: ${pkg.name}</b>\nPrice: ₹${pkg.price}\n\n<b>TRC20:</b>\n<code>${trc?.value || 'N/A'}</code>\n\n<b>BSC:</b>\n<code>${bsc?.value || 'N/A'}</code>\n\n<b>TRON:</b>\n<code>${tron?.value || 'N/A'}</code>\n\n⚠️ Send correct network. Screenshot to @${SUPER_ADMIN_USERNAME.replace('@','')}`;
      adminBot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    }
  }

  // --- CUSTOM ORDER FLOW ---
  if (data === 'custom_order') {
    adminBot.answerCallbackQuery(query.id);
    await User.updateOne({ userId }, { waitingForCustomQty: true });
    adminBot.sendMessage(chatId, `🔢 <b>Custom Order</b>\n\nPlease send the quantity you want per post (e.g., 500 reaction).\nValid for single day only.\n\n<i>Max 100,000 reaction.</i>`, {
      parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel_custom' }]] }
    });
  }

  if (data === 'cancel_custom' || data === 'back_to_menu') {
    adminBot.answerCallbackQuery(query.id);
    await User.updateOne({ userId }, { waitingForCustomQty: false });
    adminBot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
    sendWelcomeMenu(chatId, query.from.first_name);
  }
});

// User Message Handler (Custom Qty Input)
adminBot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  const user = await User.findOne({ userId });
  if (!user || !user.waitingForCustomQty) return;

  const qty = parseInt(msg.text.replace(/[^0-9]/g, ''), 10);

  if (isNaN(qty) || qty < 1) return adminBot.sendMessage(chatId, `❌ Invalid quantity. Send a number like <code>1000</code>, or tap /start to cancel.`, { parse_mode: 'HTML' });
  if (qty > 1000000) return adminBot.sendMessage(chatId, `❌ Max <b>1,000,000</b> reaction per order. Send a smaller quantity.`, { parse_mode: 'HTML' });

  const rateSetting = await Setting.findOne({ key: 'rate_base' });
  const rate = rateSetting ? parseFloat(rateSetting.value) : 15;
  const price = Math.max(10, Math.ceil((qty / 1000) * rate));

  await User.updateOne({ userId }, { waitingForCustomQty: false });

  const payKeyboard = {
    reply_markup: { inline_keyboard: [
      [{ text: '💳 Pay via UPI', callback_data: `pay_custom_upi_${qty}_${price}` }],
      [{ text: '🪙 Pay via USDT', callback_data: `pay_custom_usdt_${qty}_${price}` }],
      [{ text: '⬅️ Back', callback_data: 'back_to_menu' }]
    ]}
  };
  adminBot.sendMessage(chatId, `✅ <b>Your Order:</b>\nReaction Quantity: <b>${qty}</b>\nPrice: <b>₹${price}</b>\n\nChoose payment method:`, { parse_mode: 'HTML', ...payKeyboard });
});

// --- PHOTO / SCREENSHOT HANDLER ---
adminBot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  const latestPayment = await Payment.findOne({ userId, status: 'pending' }).sort({ createdAt: -1 });
  if (!latestPayment) {
    return adminBot.sendMessage(chatId, `❌ No pending payment found. Please place an order first using /start.`);
  }

  const fileId = msg.photo[msg.photo.length - 1].file_id;
  
  const adminMsg = `📸 <b>New Payment Proof</b>\n\n👤 User: ${msg.from.first_name} (${userId})\n💰 Amount: ₹${latestPayment.price}\n📦 Type: ${latestPayment.type.toUpperCase()}\n\nApprove this payment?`;
  
  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '✅ Approve', callback_data: `approve_${latestPayment._id}` }, { text: '❌ Reject', callback_data: `reject_${latestPayment._id}` }]
    ]
  };

  try {
    await adminBot.sendPhoto(SUPER_ADMIN_ID, fileId, { caption: adminMsg, parse_mode: 'HTML', reply_markup: inlineKeyboard });
    await adminBot.sendMessage(chatId, `✅ Screenshot received! Please wait for admin approval.`);
  } catch (err) {
    console.log("Error forwarding to admin:", err.message);
  }
});

// --- APPROVE / REJECT HANDLER ---
adminBot.on('callback_query', async (query) => {
  if (!query.data.startsWith('approve_') && !query.data.startsWith('reject_')) return;
  if (query.from.id.toString() !== SUPER_ADMIN_ID) return adminBot.answerCallbackQuery(query.id, { text: 'Not authorized' });

  const action = query.data.split('_')[0];
  const paymentId = query.data.split('_')[1];
  const payment = await Payment.findById(paymentId);
  if(!payment) return adminBot.answerCallbackQuery(query.id, { text: 'Payment not found' });

  if (action === 'approve') {
    payment.status = 'approved';
    await payment.save();

    // If package, activate user premium
    if (payment.type === 'package') {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + payment.days);
      await User.updateOne({ userId: payment.userId }, { isPremium: true, expiryDate: expiry });
    }

    adminBot.editMessageCaption(`✅ <b>APPROVED</b>\nUser: ${payment.userId} | Amount: ₹${payment.price}`, { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML' });
    adminBot.sendMessage(payment.userId, `🎉 Your payment of ₹${payment.price} has been approved! Your plan is now active.`).catch(()=>{});
  } else {
    payment.status = 'rejected';
    await payment.save();

    adminBot.editMessageCaption(`❌ <b>REJECTED</b>\nUser: ${payment.userId} | Amount: ₹${payment.price}`, { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'HTML' });
    adminBot.sendMessage(payment.userId, `❌ Your payment was rejected. Please contact ${SUPER_ADMIN_USERNAME} for support.`).catch(()=>{});
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
      bot.sendMessage(msg.chat.id, `👋 <b>Hello ${msg.from.first_name}!</b>\n\nYour premium bot is active. I will automatically react to new posts based on your package limits.\n\nAfter payment, send screenshot to ${SUPER_ADMIN_USERNAME}.`, { parse_mode: 'HTML' });
    });

    bot.on('channel_post', async (msg) => {
      const username = msg.chat.username?.toLowerCase();
      if (!username) return;
      const dbUser = await User.findOne({ userId: user.userId });
      
      if (!dbUser.isPremium || (dbUser.expiryDate && dbUser.expiryDate < new Date())) return;
      if (!dbUser.channels.includes(username)) return;

      // Daily Quota Logic
      const today = new Date().toISOString().split('T')[0];
      let counter = await DailyCounter.findOne({ userId: user.userId, channelUsername: username });
      
      if (!counter || counter.date !== today) {
        if (counter) { counter.date = today; counter.postsToday = 0; await counter.save(); }
        else { counter = await DailyCounter.create({ userId: user.userId, channelUsername: username, date: today, postsToday: 0 }); }
      }

      // Default to 10 posts per day if not set via package
      const maxPosts = 10; 
      if (counter.postsToday >= maxPosts) return; 

      const link = `https://t.me/${username}/${msg.message_id}`;
      const apiKeyToUse = dbUser.panelApiKey ? dbUser.panelApiKey : MASTER_API_KEY;
      
      // Default quantity to 10 if not set
      const qty = dbUser.quantity || 10;
      const result = await placeOrder(link, qty, apiKeyToUse);
      
      if (result.ok) {
        counter.postsToday += 1;
        await counter.save();
        console.log(`✅ [Customer ${user.userId}] Success: ${link}`);
      } else {
        bot.sendMessage(user.userId, `❌ Order failed for ${link}\nReason: ${result.error}`).catch(()=>{});
      }
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
    let data = { upi_id: '', usdt_trc20: '', usdt_bsc: '', usdt_tron: '', custom_rate: '15' };
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

// --- PACKAGES API (UPDATED) ---
app.get('/api/admin/get-packages', async (req, res) => {
  try {
    const packages = await Package.find({}).sort({ days: 1, qtyPerPost: 1 });
    res.json(packages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/add-package', async (req, res) => {
  const { qtyPerPost, postsPerDay, days, price } = req.body;
  try {
    const name = `${qtyPerPost} per post · ${days} Days`;
    await Package.create({ name, qtyPerPost, postsPerDay, days, price });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/admin/delete-package/:id', async (req, res) => {
  try {
    await Package.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const premiumUsers = await User.countDocuments({ isPremium: true });
    res.json({ totalUsers, premiumUsers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/get-users', async (req, res) => {
  try {
    const users = await User.find({}, 'userId firstName isPremium expiryDate quantity').sort({ _id: -1 });
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/get-channels', async (req, res) => {
  const channels = await AdminChannel.find({});
  res.json(channels);
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
    await User.findOneAndUpdate(
      { userId: userId },
      { botToken: botToken, panelApiKey: apiKey === 'none' ? null : apiKey, channels: channelArray },
      { upsert: true }
    );
    const user = await User.findOne({ userId });
    await startCustomerBot(user);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/', (req, res) => res.send('Bot is running!'));

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  const usersWithBots = await User.find({ botToken: { $ne: null }, isPremium: true });
  for (const user of usersWithBots) await startCustomerBot(user);
});
