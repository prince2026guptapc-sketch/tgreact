const API = window.location.origin;

// --- THEME LOGIC ---
function changeTheme(themeClass) {
    document.body.classList.remove('theme-light', 'theme-purple', 'theme-green', 'theme-red');
    if (themeClass !== '') document.body.classList.add(themeClass);
    localStorage.setItem('adminTheme', themeClass);
}

window.onload = () => {
    const savedTheme = localStorage.getItem('adminTheme');
    if (savedTheme) changeTheme(savedTheme);
    loadStats();
};

function openTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    btn.classList.add('active');

    if(tabId === 'tab-users') loadUsers();
    if(tabId === 'tab-packages') loadPackages();
    if(tabId === 'tab-settings') loadSettings();
    if(tabId === 'tab-channels') loadChannels();
}

function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.style.background = isError ? 'var(--danger)' : 'var(--success)';
    toast.style.display = 'block';
    setTimeout(() => toast.style.display = 'none', 3000);
}

function showTick(btnId, originalText) {
    const btn = document.getElementById(btnId);
    if(!btn) return;
    btn.innerText = '✅ Done!';
    btn.style.background = 'var(--success)';
    setTimeout(() => {
        btn.innerText = originalText;
        btn.style.background = 'var(--primary)';
    }, 2000);
}

// --- LOGOUT ---
function logout() {
    localStorage.removeItem('adminLoggedIn');
    window.location.href = 'login.html';
}

// --- 1. Settings & Credentials ---
async function loadSettings() {
    const res = await fetch(`${API}/api/admin/get-all-settings`);
    const data = await res.json();
    document.getElementById('upi_id').value = data.upi_id || '';
    document.getElementById('usdt_trc20').value = data.usdt_trc20 || '';
    document.getElementById('usdt_bsc').value = data.usdt_bsc || '';
    document.getElementById('usdt_tron').value = data.usdt_tron || '';
    document.getElementById('custom_rate').value = data.custom_rate || '';
}

async function saveSetting(key, btnId) {
    const value = document.getElementById(key).value;
    await fetch(`${API}/api/admin/update-setting`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ key, value })
    });
    showTick(btnId, `Update ${key.replace('_', ' ').toUpperCase()}`);
}

async function saveAllUsdt() {
    const trc20 = document.getElementById('usdt_trc20').value;
    const bsc = document.getElementById('usdt_bsc').value;
    const tron = document.getElementById('usdt_tron').value;
    await Promise.all([
        fetch(`${API}/api/admin/update-setting`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ key: 'usdt_trc20', value: trc20 }) }),
        fetch(`${API}/api/admin/update-setting`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ key: 'usdt_bsc', value: bsc }) }),
        fetch(`${API}/api/admin/update-setting`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ key: 'usdt_tron', value: tron }) })
    ]);
    showTick('btn-usdt_all', 'Update All USDT Addresses');
}

async function updateCredentials() {
    const newUsername = document.getElementById('newUsername').value;
    const newPassword = document.getElementById('newPassword').value;
    if(!newUsername && !newPassword) return alert('Enter new username or password!');

    await fetch(`${API}/api/admin/change-password`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ newUsername, newPassword })
    });
    
    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    showTick('btn-update-cred', 'Update Credentials');
}

// --- 2. Channels ---
async function loadChannels() {
    const res = await fetch(`${API}/api/admin/get-channels`);
    const channels = await res.json();
    const tbody = document.getElementById('channelTableBody');
    tbody.innerHTML = channels.length ? '' : '<tr><td colspan="3">No channels added.</td></tr>';
    channels.forEach(c => {
        tbody.innerHTML += `
            <tr>
                <td>@${c.username}</td>
                <td>${c.quantity}</td>
                <td><button class="btn-danger" onclick="deleteChannel('${c.username}')">Delete</button></td>
            </tr>
        `;
    });
}

async function addChannel() {
    const username = document.getElementById('chUsername').value.replace('@', '');
    const quantity = document.getElementById('chQty').value;
    if(!username || !quantity) return showToast('Fill all fields', true);

    await fetch(`${API}/api/admin/add-channel`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, quantity })
    });
    document.getElementById('chUsername').value = '';
    document.getElementById('chQty').value = '';
    showTick('btn-addchannel', 'Save Channel');
    loadChannels();
}

async function deleteChannel(username) {
    if(!confirm('Delete this channel?')) return;
    await fetch(`${API}/api/admin/delete-channel/${username}`, { method: 'DELETE' });
    loadChannels();
}

// --- 3. Packages ---
async function loadPackages() {
    const res = await fetch(`${API}/api/admin/get-packages`);
    const packages = await res.json();
    const tbody = document.getElementById('packageTableBody');
    tbody.innerHTML = packages.length ? '' : '<tr><td colspan="4">No packages found.</td></tr>';
    packages.forEach(p => {
        tbody.innerHTML += `
            <tr>
                <td><b>${p.name}</b></td>
                <td>₹${p.price}</td>
                <td>${p.days} days</td>
                <td><button class="btn-danger" onclick="deletePackage('${p._id}')">Delete</button></td>
            </tr>
        `;
    });
}

async function addPackage() {
    const name = document.getElementById('pkgName').value;
    const price = document.getElementById('pkgPrice').value;
    const days = document.getElementById('pkgDays').value;
    if(!name || !price || !days) return showToast('Fill all fields', true);

    await fetch(`${API}/api/admin/add-package`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ name, price, days })
    });
    document.getElementById('pkgName').value = '';
    document.getElementById('pkgPrice').value = '';
    document.getElementById('pkgDays').value = '';
    showTick('btn-addpackage', 'Add Package');
    loadPackages();
}

async function deletePackage(id) {
    if(!confirm('Delete this package?')) return;
    await fetch(`${API}/api/admin/delete-package/${id}`, { method: 'DELETE' });
    loadPackages();
}

// --- 4. Users & Stats ---
async function loadUsers() {
    const res = await fetch(`${API}/api/admin/get-users`);
    const users = await res.json();
    const tbody = document.getElementById('userTableBody');
    tbody.innerHTML = users.length ? '' : '<tr><td colspan="4">No users found.</td></tr>';
    users.forEach(u => {
        const isExpired = u.expiryDate && new Date(u.expiryDate) < new Date();
        const status = (u.isPremium && !isExpired) ? '<span class="status-badge status-active">Active</span>' : '<span class="status-badge status-expired">Free / Expired</span>';
        const dateStr = u.expiryDate ? new Date(u.expiryDate).toLocaleDateString() : 'N/A';
        tbody.innerHTML += `
            <tr>
                <td><b>${u.firstName || 'User'}</b><br><small style="color:var(--text-muted)">ID: ${u.userId}</small></td>
                <td>${status}</td>
                <td>${dateStr}</td>
                <td>
                    <input type="number" id="days_${u.userId}" placeholder="Days" style="width: 70px; padding: 8px; display:inline-block; margin-bottom:0;">
                    <button id="btn-approve_${u.userId}" class="btn-approve" onclick="approveUser('${u.userId}')" style="margin-left:5px;">Approve</button>
                </td>
            </tr>
        `;
    });
}

async function approveUser(userId) {
    const days = document.getElementById(`days_${userId}`).value;
    if(!days) return alert('Enter days first!');
    await fetch(`${API}/api/admin/approve-user`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ userId, days })
    });
    showTick(`btn-approve_${userId}`, 'Approve');
    loadUsers();
}

async function loadStats() {
    const statsRes = await fetch(`${API}/api/admin/stats`);
    const stats = await statsRes.json();
    document.getElementById('statTotalUsers').innerText = stats.totalUsers || 0;
    document.getElementById('statPremiumUsers').innerText = stats.premiumUsers || 0;
}

// --- 5. Customer Bot Management ---
async function addCustomerBot() {
    const userId = document.getElementById('botUserId').value;
    const botToken = document.getElementById('botToken').value;
    const apiKey = document.getElementById('botApiKey').value || 'none';
    const channels = document.getElementById('botChannels').value;
    if(!userId || !botToken) return showToast('User ID and Bot Token are required!', true);

    const res = await fetch(`${API}/api/admin/add-customer-bot`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ userId, botToken, apiKey, channels })
    });
    
    if(res.ok) {
        document.getElementById('botUserId').value = '';
        document.getElementById('botToken').value = '';
        document.getElementById('botApiKey').value = '';
        document.getElementById('botChannels').value = '';
        showTick('btn-addbot', 'Add / Update Customer Bot');
    } else {
        showToast('Error adding bot', true);
    }
}
