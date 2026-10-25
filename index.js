const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { createClient } = require('@libsql/client/web');

// Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);

const bot = new TelegramBot(BOT_TOKEN);

// Turso Database Init
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Panels Config
const PANELS = [
  {
    name: 'Panel1',
    url: process.env.API_URL_1 || '',
    key: process.env.API_KEY_1 || '',
    service: process.env.SERVICE_ID_1 || '',
  }
].filter(p => p.url && p.key && p.service);

const DEFAULT_QTY = 10;
const isAdmin = (id) => ADMIN_IDS.includes(id);
const cleanServiceId = (id) => String(id || '').replace(/^#/, '').trim();

// DB Helpers
async function getState(key) {
  const r = await db.execute({ sql: 'SELECT value FROM state WHERE key = ?', args: [key] });
  return r.rows[0]?.value;
}
async function setState(key, value) {
  await db.execute({ sql: 'INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: [key, String(value)] });
}
async function getQty() { return Number((await getState('quantity')) || DEFAULT_QTY); }
async function getServiceId() { return cleanServiceId((await getState('service_id')) || PANELS[0]?.service || ''); }
async function isDuplicate(msgId) {
  const r = await db.execute({ sql: 'SELECT 1 FROM processed WHERE message_id = ?', args: [msgId] });
  return r.rows.length > 0;
}
async function markProcessed(msgId) {
  await db.execute({ sql: 'INSERT OR IGNORE INTO processed (message_id, processed_at) VALUES (?, ?)', args: [msgId, Date.now()] });
}
async function insertOrder(msgId, orderId, panel, status) {
  await db.execute({ sql: 'INSERT INTO orders (message_id, order_id, panel, status, created_at) VALUES (?, ?, ?, ?, ?)', args: [msgId, orderId, panel, status, Date.now()] });
}
async function listChannels() { return (await db.execute('SELECT * FROM channels WHERE active = 1 ORDER BY added_at DESC')).rows; }
async function addChannel(username, chatId, title, addedBy) {
  await db.execute({ sql: 'INSERT INTO channels (username, chat_id, title, added_by, added_at, active) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(username) DO UPDATE SET active = 1, title = excluded.title', args: [username.replace(/^@/, '').toLowerCase(), chatId, title, addedBy, Date.now()] });
}
async function removeChannel(username) {
  await db.execute({ sql: 'UPDATE channels SET active = 0 WHERE username = ?', args: [username.replace(/^@/, '').toLowerCase()] });
}
async function getChannel(username) {
  return (await db.execute({ sql: 'SELECT * FROM channels WHERE username = ? AND active = 1', args: [username.replace(/^@/, '').toLowerCase()] })).rows[0];
}

// Place Order Logic
async function placeOrderWithFallback(link, quantity, serviceOverride) {
  const errors = [];
  for (const panel of PANELS) {
    try {
      const serviceId = serviceOverride || cleanServiceId(panel.service);
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
      [{ text: '➕ Add Channel', callback_data: 'add_help' }, { text: '➖ Remove', callback_data: 'remove_help' }],
      [{ text: '🔄 Refresh', callback_data: 'refresh' }],
    ],
  },
  parse_mode: 'Markdown',
};

async function menuText() {
  const chans = await listChannels();
  const chanList = chans.length ? chans.map(c => `@${c.username}`).join(', ') : '_none_';
  return `🤖 *SMM Bot*\n\n📡 Channels: ${chanList}\n🔢 Quantity: *${await getQty()}*\n⚙️ Service: *${await getServiceId()}*\n🔌 Panels: *${PANELS.length}*\n\nTap a button below 👇`;
}

bot.onText(/^\/start$/, async (msg) => {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '❌ Not admin');
  bot.sendMessage(msg.chat.id, await menuText(), mainMenu);
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
        const total = (await db.execute('SELECT COUNT(*) c FROM orders')).rows[0].c;
        const ok = (await db.execute("SELECT COUNT(*) c FROM orders WHERE status='ok'")).rows[0].c;
        const fail = (await db.execute("SELECT COUNT(*) c FROM orders WHERE status='fail'")).rows[0].c;
        return bot.editMessageText(`📊 *Stats*\n\nTotal: *${total}*\n✅ OK: *${ok}*\n❌ Fail: *${fail}*`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: back });
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
      case 'refresh': return bot.editMessageText(await menuText(), { chat_id: chatId, message_id: msgId, ...mainMenu });
    }
  } catch (err) { console.error(err); }
});

bot.on('channel_post', async (msg) => {
  try {
    const username = msg.chat.username?.toLowerCase();
    if (!username || !(await getChannel(username)) || await isDuplicate(msg.message_id)) return;
    await markProcessed(msg.message_id);

    const link = `https://t.me/${username}/${msg.message_id}`;
    const result = await placeOrderWithFallback(link, await getQty(), await getServiceId());

    if (result.ok) await insertOrder(msg.message_id, String(result.orderId), result.panel, 'ok');
    else {
      await insertOrder(msg.message_id, null, null, 'fail');
      for (const id of ADMIN_IDS) bot.sendMessage(id, `❌ Order failed for ${link}\n\n${result.errors.join('\n')}`).catch(() => {});
    }
  } catch (err) { console.error(err); }
});

// ⚠️ VERCEL ENTRY POINT (Webhook Handler)
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
