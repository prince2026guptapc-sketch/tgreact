const API = window.location.origin;

// --- THEME LOGIC ---
function changeTheme(themeClass) {
    // Remove all previous theme classes
    document.body.classList.remove('theme-light', 'theme-purple', 'theme-green', 'theme-red');
    
    // Add new theme if not default
    if (themeClass !== '') {
        document.body.classList.add(themeClass);
    }
    
    // Save to LocalStorage so it stays on refresh
    localStorage.setItem('adminTheme', themeClass);
}

// Load saved theme on start
window.onload = () => {
    const savedTheme = localStorage.getItem('adminTheme');
    if (savedTheme) changeTheme(savedTheme);
    loadStats();
};

// --- TAB LOGIC ---
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

// (Aap yahan pichle JS code ke saare API functions daal dein: loadSettings, saveSetting, addChannel, loadUsers, etc.)
// Jaise:
async function loadStats() {
    const statsRes = await fetch(`${API}/api/admin/stats`);
    const stats = await statsRes.json();
    document.getElementById('statTotalUsers').innerText = stats.totalUsers || 0;
    document.getElementById('statPremiumUsers').innerText = stats.premiumUsers || 0;
}
