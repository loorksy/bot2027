// =====================================================
// AUDIT SYSTEM - تسليم الرواتب
// =====================================================

const API_BASE = '/api/accounting'; // الـ accounting routes مركبة على هذا المسار

// Global state
let pendingUsers = [];
let currentDelivery = null;

// API Helper
const api = {
    async get(url) {
        const res = await fetch(API_BASE + url);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    async post(url, data) {
        const res = await fetch(API_BASE + url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }
};

// =====================================================
// INITIALIZATION
// =====================================================

document.addEventListener('DOMContentLoaded', async () => {
    await loadPendingSalaries();
    await loadStats();
});

// =====================================================
// LOAD PENDING SALARIES
// =====================================================

async function loadPendingSalaries() {
    const list = document.getElementById('pending-list');
    list.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <p>جاري التحميل...</p>
        </div>
    `;

    try {
        const data = await api.get('/audit/pending');
        pendingUsers = data.users || [];

        if (pendingUsers.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="icon">✅</div>
                    <p>لا توجد أمانات معلقة حالياً</p>
                </div>
            `;
            return;
        }

        renderPendingList(pendingUsers);
    } catch (e) {
        console.error('Error loading pending salaries:', e);
        list.innerHTML = `<div class="empty-state" style="color: #f44336;">❌ ${e.message}</div>`;
    }
}

function renderPendingList(users) {
    const list = document.getElementById('pending-list');
    list.innerHTML = '';

    users.forEach(user => {
        const commission = user.salary * 0.07;
        const netAmount = user.salary - commission;
        const initial = (user.userName || user.userId).charAt(0).toUpperCase();

        const row = document.createElement('div');
        row.className = 'user-row';
        row.setAttribute('data-user-id', user.userId);
        row.setAttribute('data-user-name', user.userName || '');

        row.innerHTML = `
            <div class="user-info">
                <div class="user-avatar">${initial}</div>
                <div class="user-details">
                    <h4>${user.userName || user.userId}</h4>
                    <span class="id-badge">ID: ${user.userId}</span>
                </div>
            </div>
            <div class="user-amount">
                <div class="amount-original">$${user.salary.toFixed(2)}</div>
                <div class="amount-net">$${netAmount.toFixed(2)}</div>
                <div class="commission-badge">عمولة: $${commission.toFixed(2)}</div>
            </div>
            <button class="deliver-btn" onclick="openConfirmModal('${user.userId}', '${user.userName || user.userId}', ${user.salary})">
                💵 تسليم
            </button>
        `;

        list.appendChild(row);
    });
}

// =====================================================
// FILTER USERS
// =====================================================

function filterUsers(query) {
    const q = query.toLowerCase().trim();
    const rows = document.querySelectorAll('#pending-list .user-row');

    rows.forEach(row => {
        const userId = row.getAttribute('data-user-id')?.toLowerCase() || '';
        const userName = row.getAttribute('data-user-name')?.toLowerCase() || '';

        if (!q || userId.includes(q) || userName.includes(q)) {
            row.style.display = 'flex';
            if (q) {
                row.style.background = 'rgba(102, 126, 234, 0.15)';
                row.style.borderLeft = '3px solid #667eea';
            } else {
                row.style.background = 'rgba(255, 255, 255, 0.02)';
                row.style.borderLeft = 'none';
            }
        } else {
            row.style.display = 'none';
        }
    });
}

// =====================================================
// CONFIRM DELIVERY MODAL
// =====================================================

function openConfirmModal(userId, userName, salary) {
    const commission = salary * 0.07;
    const netAmount = salary - commission;

    currentDelivery = { userId, userName, salary, commission, netAmount };

    document.getElementById('confirm-user-name').textContent = userName;
    document.getElementById('confirm-original').textContent = `$${salary.toFixed(2)}`;
    document.getElementById('confirm-commission').textContent = `-$${commission.toFixed(2)}`;
    document.getElementById('confirm-net').textContent = `$${netAmount.toFixed(2)}`;

    document.getElementById('confirm-modal').style.display = 'flex';
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    currentDelivery = null;
}

// =====================================================
// DELIVER SALARY
// =====================================================

async function confirmDelivery() {
    if (!currentDelivery) return;

    const btn = document.getElementById('btn-confirm-deliver');
    btn.disabled = true;
    btn.textContent = '⏳ جاري التسليم...';

    try {
        const userId = currentDelivery.userId; // Store ID before closing modal (which nulls currentDelivery)

        await api.post('/audit/deliver', {
            userId: userId,
            salary: currentDelivery.salary,
            commission: currentDelivery.commission,
            netAmount: currentDelivery.netAmount
        });

        closeConfirmModal();

        // Remove user from list
        const row = document.querySelector(`[data-user-id="${userId}"]`);
        if (row) {
            row.style.animation = 'fadeOut 0.3s forwards';
            setTimeout(() => row.remove(), 300);
        }

        // Reload stats
        await loadStats();

        // Show success notification
        showNotification('✅ تم تسليم الراتب بنجاح!', 'success');

    } catch (e) {
        console.error('Error delivering salary:', e);
        showNotification('❌ خطأ: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ تأكيد التسليم';
    }
}

// =====================================================
// LOAD STATS
// =====================================================

async function loadStats() {
    try {
        const stats = await api.get('/audit/stats');

        document.getElementById('stat-pending-total').textContent = `$${(stats.pendingTotal || 0).toLocaleString()}`;
        document.getElementById('stat-pending-count').textContent = (stats.pendingCount || 0).toLocaleString();
        document.getElementById('stat-delivered-today').textContent = (stats.deliveredToday || 0).toLocaleString();
        document.getElementById('stat-commission-today').textContent = `$${(stats.commissionToday || 0).toFixed(2)}`;
    } catch (e) {
        console.warn('Could not load stats:', e);
    }
}

// =====================================================
// LOAD HISTORY
// =====================================================

async function loadHistory() {
    const container = document.getElementById('history-container');
    container.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <p>جاري التحميل...</p>
        </div>
    `;

    try {
        const data = await api.get('/audit/history');
        const deliveries = data.deliveries || [];

        if (deliveries.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📭</div>
                    <p>لا توجد تسليمات سابقة</p>
                </div>
            `;
            return;
        }

        let tableHtml = `
            <table class="history-table">
                <thead>
                    <tr>
                        <th>التاريخ</th>
                        <th>المستخدم</th>
                        <th>الراتب</th>
                        <th>العمولة</th>
                        <th>المُسلَّم</th>
                        <th>الحالة</th>
                    </tr>
                </thead>
                <tbody>
        `;

        deliveries.forEach(d => {
            const date = new Date(d.date).toLocaleDateString('ar-EG', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            tableHtml += `
                <tr>
                    <td>${date}</td>
                    <td>${d.userName || d.userId}</td>
                    <td>$${d.salary.toFixed(2)}</td>
                    <td style="color: #ff9800;">$${(d.salary * 0.07).toFixed(2)}</td>
                    <td style="color: #4caf50; font-weight: bold;">$${d.amount.toFixed(2)}</td>
                    <td><span class="status-delivered">✅ مُسلَّم</span></td>
                </tr>
            `;
        });

        tableHtml += '</tbody></table>';
        container.innerHTML = tableHtml;

    } catch (e) {
        console.error('Error loading history:', e);
        container.innerHTML = `<div class="empty-state" style="color: #f44336;">❌ ${e.message}</div>`;
    }
}

// =====================================================
// TABS
// =====================================================

function switchTab(tabName) {
    // Update button states
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.includes(tabName === 'pending' ? 'المعلقة' : 'السجل')) {
            btn.classList.add('active');
        }
    });

    // Show/hide tabs
    document.getElementById('tab-pending').classList.remove('active');
    document.getElementById('tab-history').classList.remove('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');

    // Load data for history tab
    if (tabName === 'history') {
        loadHistory();
    }
}

// =====================================================
// NOTIFICATION
// =====================================================

function showNotification(message, type = 'success') {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${type === 'success' ? '#4caf50' : '#f44336'};
        color: white;
        padding: 15px 30px;
        border-radius: 10px;
        font-size: 16px;
        z-index: 2000;
        animation: slideDown 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 3000);
}

// Add CSS animation for fadeOut
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeOut {
        to { opacity: 0; transform: translateX(-20px); }
    }
    @keyframes slideDown {
        from { transform: translateX(-50%) translateY(-100%); opacity: 0; }
        to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
`;
document.head.appendChild(style);
