
// ================= API HELPER =================
const api = {
    async get(endpoint) {
        const res = await fetch(`/api/accounting${endpoint}`);
        if (!res.ok) {
            const errorText = await res.text();
            let errorMessage = errorText;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error || errorText;
            } catch (e) { }
            throw new Error(errorMessage);
        }
        return res.json();
    },
    async post(endpoint, data) {
        const res = await fetch(`/api/accounting${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    async put(endpoint, data) {
        const res = await fetch(`/api/accounting${endpoint}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    async delete(endpoint) {
        const res = await fetch(`/api/accounting${endpoint}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }
};

function hideAllPages() {
    const pages = ['page-transfer-companies', 'page-company-detail'];
    pages.forEach(pageId => {
        const el = document.getElementById(pageId);
        if (el) el.style.display = 'none';
    });
}

// ================= TRANSFER COMPANIES =================
let currentCompanyId = null;

async function showTransferCompanies() {
    hideAllPages();
    document.getElementById('page-transfer-companies').style.display = 'block';
    window.location.hash = '#transfer-companies';

    const grid = document.getElementById('companies-grid');
    grid.innerHTML = '<p>جاري التحميل...</p>';

    try {
        const companies = await api.get('/transfer-companies');
        grid.innerHTML = '';

        if (companies.length === 0) {
            grid.innerHTML = '<p class="text-center muted">لا توجد شركات. أضف شركة جديدة.</p>';
            return;
        }

        companies.forEach(c => {
            const card = document.createElement('div');
            card.className = 'ai-card';
            card.style.cssText = 'padding: 20px; cursor: pointer; transition: transform 0.2s;';
            card.onmouseover = () => card.style.transform = 'scale(1.02)';
            card.onmouseout = () => card.style.transform = 'scale(1)';
            card.onclick = () => openCompanyDetail(c.id);

            const statusBadge = c.isActive
                ? '<span style="background: #1a4a1a; color: #4caf50; padding: 2px 8px; border-radius: 10px; font-size: 11px;">نشطة</span>'
                : '<span style="background: #4a1a1a; color: #f44336; padding: 2px 8px; border-radius: 10px; font-size: 11px;">موقوفة</span>';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h3 style="margin: 0;">🏢 ${c.name}</h3>
                    ${statusBadge}
                </div>
                <div style="font-size: 28px; font-weight: bold; margin: 15px 0; color: ${c.balance > 0 ? '#4caf50' : '#888'};">
                    $${c.balance.toLocaleString()}
                </div>
                <div style="font-size: 12px; color: #888;">الذمة الحالية</div>
                <div style="font-size: 11px; color: #666; margin-top: 5px;">تحويلات: ${c._count.transfers} | تسليمات: ${c._count.deliveries}</div>
            `;
            grid.appendChild(card);
        });
    } catch (e) {
        grid.innerHTML = `<p class="text-red">${e.message}</p>`;
    }
}

async function openCompanyDetail(companyId) {
    currentCompanyId = companyId;
    hideAllPages();
    document.getElementById('page-company-detail').style.display = 'block';
    window.location.hash = `#company/${companyId}`;

    try {
        const stats = await api.get(`/transfer-companies/${companyId}/stats`);

        document.getElementById('company-detail-name').textContent = `🏢 ${stats.company.name}`;
        document.getElementById('stat-balance').textContent = `$${stats.stats.currentBalance.toLocaleString()}`;
        document.getElementById('stat-total-in').textContent = `$${stats.stats.totalTransferred.toLocaleString()}`;
        document.getElementById('stat-delivered').textContent = `$${stats.stats.totalDelivered.toLocaleString()}`;
        document.getElementById('stat-returned').textContent = `$${stats.stats.totalReturned.toLocaleString()}`;

        loadCompanyTransfers(stats.transfers);
        loadCompanyDeliveries(stats.deliveries);
        loadCompanyReturns(stats.returns);
    } catch (e) {
        alert('خطأ: ' + e.message);
        showTransferCompanies();
    }
}

function loadCompanyTransfers(transfers) {
    const tbody = document.getElementById('list-company-transfers');
    tbody.innerHTML = '';

    if (transfers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center muted">لا توجد تحويلات</td></tr>';
        return;
    }

    transfers.forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(t.date).toLocaleDateString('ar-EG')}</td>
            <td class="text-green">$${t.amount.toLocaleString()}</td>
            <td>${t.period ? t.period.name : '-'}</td>
            <td>${t.description || '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function loadCompanyDeliveries(deliveries) {
    const tbody = document.getElementById('list-company-deliveries');
    tbody.innerHTML = '';

    if (deliveries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center muted">لا توجد تسليمات</td></tr>';
        return;
    }

    deliveries.forEach(d => {
        const tr = document.createElement('tr');
        const debtBadge = d.isDebt ? '<span class="text-red">✓ دين</span>' : '-';
        tr.innerHTML = `
            <td>${new Date(d.date).toLocaleDateString('ar-EG')}</td>
            <td>${d.user.name || d.user.id}</td>
            <td class="text-yellow">$${d.amount.toLocaleString()}</td>
            <td>${debtBadge}</td>
        `;
        tbody.appendChild(tr);
    });
}

function loadCompanyReturns(returns) {
    const tbody = document.getElementById('list-company-returns');
    tbody.innerHTML = '';

    if (returns.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center muted">لا توجد مرتجعات</td></tr>';
        return;
    }

    returns.forEach(r => {
        const tr = document.createElement('tr');
        const destination = r.destination === 'CUSTODY' ? 'الأمانات' : 'الخزينة';
        tr.innerHTML = `
            <td>${new Date(r.date).toLocaleDateString('ar-EG')}</td>
            <td class="text-yellow">$${r.amount.toLocaleString()}</td>
            <td>${destination}</td>
            <td>${r.description || '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function switchCompanyTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`company-tab-${tabName}`).style.display = 'block';
    event.target.classList.add('active');
}

// Modals
function openNewCompanyModal() {
    document.getElementById('modal-new-company').style.display = 'flex';
    document.getElementById('inp-new-company-name').value = '';
}

function closeNewCompanyModal() {
    document.getElementById('modal-new-company').style.display = 'none';
}

async function createCompany() {
    const name = document.getElementById('inp-new-company-name').value.trim();
    if (!name) {
        alert('يرجى إدخال اسم الشركة');
        return;
    }
    try {
        await api.post('/transfer-companies', { name });
        closeNewCompanyModal();
        showTransferCompanies();
        alert('✅ تم إضافة الشركة بنجاح');
    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

async function openTransferMoneyModal() {
    document.getElementById('modal-transfer-money').style.display = 'flex';
    try {
        const periods = await api.get('/periods');
        const select = document.getElementById('inp-transfer-period');
        select.innerHTML = periods.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    } catch (e) {
        alert('خطأ في تحميل الدورات: ' + e.message);
    }
}

function closeTransferMoneyModal() {
    document.getElementById('modal-transfer-money').style.display = 'none';
}

async function confirmTransferMoney() {
    const amount = parseFloat(document.getElementById('inp-transfer-amount').value);
    const periodId = document.getElementById('inp-transfer-period').value;
    const description = document.getElementById('inp-transfer-description').value;

    if (!amount || amount <= 0) {
        alert('يرجى إدخال مبلغ صحيح');
        return;
    }
    if (!periodId) {
        alert('يرجى اختيار الدورة');
        return;
    }

    try {
        await api.post(`/transfer-companies/${currentCompanyId}/transfer`, {
            amount, periodId, description
        });
        closeTransferMoneyModal();
        openCompanyDetail(currentCompanyId);
        alert('✅ تم نقل المبلغ بنجاح');
    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

function openRegisterReturnModal() {
    document.getElementById('modal-register-return').style.display = 'flex';
}

function closeRegisterReturnModal() {
    document.getElementById('modal-register-return').style.display = 'none';
}

async function confirmRegisterReturn() {
    const amount = parseFloat(document.getElementById('inp-return-amount').value);
    const destination = document.getElementById('inp-return-destination').value;
    const description = document.getElementById('inp-return-description').value;

    if (!amount || amount <= 0) {
        alert('يرجى إدخال مبلغ صحيح');
        return;
    }

    try {
        await api.post('/company-returns', {
            companyId: currentCompanyId,
            amount, destination, description
        });
        closeRegisterReturnModal();
        openCompanyDetail(currentCompanyId);
        alert('✅ تم تسجيل المرتجع بنجاح');
    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

console.log('✅ Transfer Companies loaded!');

// Auto-load companies on page load
window.onload = () => {
    showTransferCompanies();
};
