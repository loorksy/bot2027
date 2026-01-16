
// Minimal Accounting JS

let currentPeriodId = null;

// ================= API HELPERS =================
const api = {
    async get(endpoint) {
        const res = await fetch(`/api/accounting${endpoint}`);
        if (!res.ok) {
            const errorText = await res.text();
            let errorMessage = errorText;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.error || errorText;
            } catch (e) {
                // If not JSON, use text as is
            }
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
        const res = await fetch(`/api/accounting${endpoint}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    async upload(endpoint, formData) {
        const res = await fetch(`/api/accounting${endpoint}`, {
            method: 'POST',
            body: formData
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }
};

// ================= PAGE NAVIGATION =================

function hideAllPages() {
    const pages = [
        'page-dashboard',
        'page-details',
        'page-main-agency',
        'page-sub-agencies',
        'page-agency-detail',
        'page-treasury',
        'page-agency-wallets',
        'page-agency-wallet-detail',
        'page-unknown-users',
        'page-transfer-companies',
        'page-company-detail'
    ];

    pages.forEach(pageId => {
        const el = document.getElementById(pageId);
        if (el) el.style.display = 'none';
    });
}

function showDashboard() {
    hideAllPages();
    document.getElementById('page-dashboard').style.display = 'block';
    refreshCycles();
    updateSafeBalance();
}

async function updateSafeBalance() {
    try {
        const stats = await api.get('/reports/general-stats');
        const badge = document.getElementById('safe-balance-badge');
        if (badge) {
            badge.style.display = 'block';
            badge.innerText = `💰 الخزنة: $${stats.totalWalletBalance.toLocaleString()}`;
        }
    } catch (e) { console.error('Failed to load safe balance', e); }
}

function openCreateModal() {
    document.getElementById('modal-create').style.display = 'flex';
}

function closeModal(modalId = 'modal-create') {
    document.getElementById(modalId).style.display = 'none';
}

function switchTab(tab) {
    document.getElementById('tab-soulchill').style.display = 'none';
    document.getElementById('tab-agent').style.display = 'none';
    document.getElementById('btn-soulchill').classList.remove('active');
    document.getElementById('btn-agent').classList.remove('active');

    document.getElementById(`tab-${tab}`).style.display = 'block';
    document.getElementById(`btn-${tab}`).classList.add('active');
}

// ================= LOGIC =================

async function refreshCycles() {
    const tbody = document.getElementById('cycles-list');
    tbody.innerHTML = '<tr><td colspan="4">جاري التحميل...</td></tr>';

    try {
        const periods = await api.get('/periods');
        tbody.innerHTML = '';

        if (periods.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">لا توجد دورات. قم بإنشاء واحدة.</td></tr>';
            return;
        }

        periods.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><b>${p.name}</b></td>
                <td>${p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '-'}</td>
                <td><span class="badge ${p.status === 'OPEN' ? 'text-green' : 'text-red'}">${p.status}</span></td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="openDetails('${p.id}', '${p.name}')">فتح</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-red">${err.message}</td></tr>`;
    }
}

async function createCycle() {
    const name = document.getElementById('inp-name').value;
    const fileSoulchill = document.getElementById('file-soulchill').files[0];
    const fileAgent = document.getElementById('file-agent').files[0];

    if (!name) return alert('يرجى كتابة اسم الدورة');

    // UI Feedback
    const btn = document.querySelector('button[onclick="createCycle()"]');
    const oldText = btn.textContent;
    btn.textContent = 'جاري العمل...';
    btn.disabled = true;

    try {
        // 1. Create Period
        const today = new Date();
        const nextMonth = new Date();
        nextMonth.setDate(today.getDate() + 30);

        const period = await api.post('/periods', {
            name,
            startDate: today.toISOString().split('T')[0],
            endDate: nextMonth.toISOString().split('T')[0]
        });
        const id = period.id;
        let msg = '✅ تم إنشاء الدورة';

        // 2. Upload Combined Sheets
        if (fileSoulchill || fileAgent) {
            try {
                const fd = new FormData();
                if (fileSoulchill) fd.append('adminFile', fileSoulchill);
                if (fileAgent) fd.append('agentFile', fileAgent);
                fd.append('periodId', id);

                await api.upload('/reports/import-combined', fd);
                msg += '\n✅ تم استيراد البيانات وحساب الأرباح';
            } catch (e) {
                msg += '\n❌ فشل الاستيراد: ' + e.message;
            }
        }

        alert(msg);
        closeModal();
        refreshCycles();

    } catch (err) {
        alert('خطأ كلي: ' + err.message);
    } finally {
        btn.textContent = oldText;
        btn.disabled = false;
    }
}

async function openDetails(id, name) {
    currentPeriodId = id;
    document.getElementById('detail-title').innerText = name;

    document.getElementById('page-dashboard').style.display = 'none';
    document.getElementById('page-details').style.display = 'block';

    // Load Data
    loadSoulchillData(id);
    loadAgentData(id);
}

async function loadSoulchillData(id) {
    const tbody = document.getElementById('list-soulchill');
    tbody.innerHTML = '<tr><td colspan="5">جاري التحميل...</td></tr>';
    // Currently we don't save Soulchill rows individually in DB (Needs schema update if required).
    // For now, assume we display "Aggregated Profit" or fetch Period Summary

    try {
        const period = await api.get(`/periods/${id}`);
        // If we want rows, we need a new API. 
        // Showing Summary for now as placeholder for "Data Table"
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center" style="padding: 20px;">
                    <h3>إجمالي أرباح الإدارة: $${period.summary?.totalIncoming || 0}</h3>
                    <small>نعمل على إضافة عرض التفاصيل (أسطر) قريباً</small>
                </td>
            </tr>
        `;
    } catch (e) { tbody.innerHTML = `<tr><td colspan="5">${e.message}</td></tr>`; }
}

async function loadAgentData(id) {
    const tbody = document.getElementById('list-agent');
    tbody.innerHTML = '<tr><td colspan="4">جاري التحميل...</td></tr>';

    try {
        const salaries = await api.get(`/salaries?periodId=${id}`);
        tbody.innerHTML = '';

        if (salaries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">لا توجد بيانات وكيل</td></tr>';
            return;
        }

        // Aggregate Totals
        let totalNet = 0;
        let totalFee = 0;

        salaries.forEach(s => {
            const net = s.amountBase; // Column D (Salary)
            const fee = net * 0.07;   // 7% Fee

            totalNet += net;
            totalFee += fee;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${s.userId}</td>
                <td>$${net.toFixed(2)}</td>
                <td class="text-green">+$${fee.toFixed(2)}</td>
                <td>$${(net).toFixed(2)} (Payable)</td> 
            `;
            tbody.appendChild(tr);
        });

        // Add Summary Row
        const sumRow = document.createElement('tr');
        sumRow.style.fontWeight = 'bold';
        sumRow.style.background = '#222';
        sumRow.innerHTML = `
            <td>الإجمالي</td>
            <td>$${totalNet.toFixed(2)}</td>
            <td class="text-green">+$${totalFee.toFixed(2)}</td>
            <td>-</td>
        `;
        tbody.prepend(sumRow);

    } catch (e) { tbody.innerHTML = `<tr><td colspan="4">${e.message}</td></tr>`; }
}

// ================= MAIN & SUB AGENCIES =================
let currentAgency = 'Main';
let allUsersCache = [];

function hideAllPages() {
    document.getElementById('page-dashboard').style.display = 'none';
    document.getElementById('page-details').style.display = 'none';
    document.getElementById('page-main-agency').style.display = 'none';
    document.getElementById('page-sub-agencies').style.display = 'none';
    document.getElementById('page-agency-profile').style.display = 'none';
    document.getElementById('page-treasury').style.display = 'none';
    document.getElementById('page-agency-wallets').style.display = 'none';
    document.getElementById('page-wallet-detail').style.display = 'none';
    document.getElementById('page-unknown-users').style.display = 'none';
}

function showDashboard() {
    hideAllPages();
    document.getElementById('page-dashboard').style.display = 'block';
    window.location.hash = '#dashboard';
    refreshCycles();
}

async function showMainAgency() {
    hideAllPages();
    document.getElementById('page-main-agency').style.display = 'block';
    window.location.hash = '#main-agency';
    currentAgency = 'Main';

    const tbody = document.getElementById('main-users-list');
    tbody.innerHTML = '<tr><td colspan="5">جاري التحميل...</td></tr>';

    try {
        const response = await api.get('/users');
        // Ensure response is an array
        allUsersCache = Array.isArray(response) ? response : Object.values(response || {});
        const users = allUsersCache.filter(u => getAgencyName(u) === 'Main');
        renderMainAgencyUsersTable(tbody, users);

        // Load Main Agency config
        try {
            const mainAgency = await api.get('/agencies/Main');
            document.getElementById('main-salary-ratio').value = mainAgency.salaryTransferRatio ?? 7;
        } catch (e) {
            // Main agency might not exist yet, use default
            document.getElementById('main-salary-ratio').value = 7;
        }
    } catch (e) {
        console.error('Error loading main agency users:', e);
        const errorMsg = e.message || 'حدث خطأ غير معروف';
        tbody.innerHTML = `<tr><td colspan="5" style="color: red; text-align: center;">خطأ في التحميل: ${errorMsg}</td></tr>`;
    }
}

async function saveMainAgencyConfig() {
    const salaryVal = parseFloat(document.getElementById('main-salary-ratio').value);
    const salaryRatio = isNaN(salaryVal) ? 7 : salaryVal;

    try {
        // Try to update Main agency, or create it if it doesn't exist
        try {
            await api.put('/agencies/Main', { salaryTransferRatio: salaryRatio });
        } catch (e) {
            // If Main doesn't exist, create it
            await api.post('/agencies', { name: 'Main', salaryTransferRatio: salaryRatio });
        }

        alert('✅ تم حفظ الإعدادات\nجاري إعادة حساب الدورات...');

        // Auto-recalculate all periods
        const periods = await api.get('/periods');
        for (const period of periods) {
            await api.post(`/periods/${period.id}/recalculate`);
        }
        alert('✅ تم تحديث جميع الحسابات');
    } catch (e) {
        alert('❌ خطأ: ' + e.message);
    }
}

function renderMainAgencyUsersTable(tbody, users) {
    tbody.innerHTML = '';

    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">لا يوجد مستخدمين في الوكالة الرئيسية.</td></tr>';
        return;
    }

    users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${u.id || '-'}</td>
            <td>${u.name || '-'}</td>
            <td>${u.country || '-'}</td>
            <td>${u.phone || '-'}</td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="editUser('${u.id}')">✏ تعديل</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function showSubAgencies() {
    hideAllPages();
    document.getElementById('page-sub-agencies').style.display = 'block';
    window.location.hash = '#sub-agencies';

    const grid = document.getElementById('agencies-grid');
    grid.innerHTML = '<p>جاري التحميل...</p>';

    try {
        // Fetch both users and agencies from DB
        const [users, dbAgencies] = await Promise.all([
            api.get('/users'),
            api.get('/agencies')
        ]);
        allUsersCache = users;

        // Collect agencies from users
        const agenciesFromUsers = new Set();
        allUsersCache.forEach(u => {
            const name = getAgencyName(u);
            if (name !== 'Main') agenciesFromUsers.add(name);
        });

        // Collect agencies from DB
        const agenciesFromDB = new Set(dbAgencies.map(a => a.name));

        // Merge both sources
        const allAgencies = new Set([...agenciesFromUsers, ...agenciesFromDB]);

        grid.innerHTML = '';
        if (allAgencies.size === 0) {
            grid.innerHTML = '<p class="text-center">لا توجد وكالات فرعية. قم بإنشاء واحدة.</p>';
            return;
        }

        // كارد المستخدمين المعلقين أولاً
        try {
            const suspended = await api.get('/suspended-users');
            if (suspended.count > 0) {
                const suspendedCard = document.createElement('div');
                suspendedCard.className = 'ai-card';
                suspendedCard.style.cssText = 'cursor: pointer; text-align: center; padding: 20px; border: 2px solid #f44336; background: linear-gradient(135deg, #4a1a1a 0%, #2a0a0a 100%);';
                suspendedCard.onmouseover = () => suspendedCard.style.borderColor = '#ff5722';
                suspendedCard.onmouseout = () => suspendedCard.style.borderColor = '#f44336';
                suspendedCard.innerHTML = `
                    <h3 style="margin: 0 0 10px 0; color: #f44336;">⏸️ المستخدمين المعلقين</h3>
                    <p style="margin: 0; color: #ff9800; font-size: 24px; font-weight: bold;">${suspended.count}</p>
                    <p style="margin: 5px 0 0 0; color: #888; font-size: 12px;">بحاجة لتحديد الوكالة</p>
                `;
                suspendedCard.onclick = () => showSuspendedUsers();
                grid.appendChild(suspendedCard);
            }
        } catch (e) { console.warn('Could not load suspended users:', e); }

        allAgencies.forEach(ag => {
            const count = allUsersCache.filter(u => getAgencyName(u) === ag).length;
            const card = document.createElement('div');
            card.className = 'ai-card';
            card.style.cursor = 'pointer';
            card.style.textAlign = 'center';
            card.style.padding = '20px';
            card.style.border = '1px solid #444';
            card.onmouseover = () => card.style.borderColor = '#007bff';
            card.onmouseout = () => card.style.borderColor = '#444';

            card.innerHTML = `
                <h3 style="margin: 0 0 10px 0; color: #007bff;">${ag}</h3>
                <p style="margin: 0; color: #aaa;">${count} مستخدم</p>
            `;
            card.onclick = () => openAgencyProfile(ag);
            grid.appendChild(card);
        });

    } catch (e) { grid.innerHTML = `<p class="text-red">${e.message}</p>`; }
}

async function openAgencyProfile(agencyName) {
    hideAllPages();
    document.getElementById('page-agency-profile').style.display = 'block';

    currentAgency = agencyName;
    document.getElementById('profile-agency-name').innerText = agencyName;

    const users = allUsersCache.filter(u => getAgencyName(u) === agencyName);
    document.getElementById('profile-user-count').innerText = users.length;

    // Show suspended users warning badge
    try {
        const warnings = await api.get(`/agency-warnings/${encodeURIComponent(agencyName)}`);
        const warningContainer = document.getElementById('agency-warning-badge');
        if (warningContainer) {
            if (warnings.hasWarning && warnings.suspendedCount > 0) {
                warningContainer.innerHTML = `
                    <button onclick="showSuspendedUsers()" style="background: linear-gradient(90deg, #f44336 0%, #ff5722 100%); color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px;">
                        🔴 ${warnings.suspendedCount} مستخدمين معلقين
                    </button>
                `;
                warningContainer.style.display = 'block';
            } else {
                warningContainer.style.display = 'none';
            }
        }
    } catch (e) { console.warn('Could not load agency warnings:', e); }

    const tbody = document.getElementById('profile-users-list');
    renderUsersTable(tbody, users, true); // Allow delete for Sub-Agencies

    // Load agency data from DB
    try {
        const agency = await api.get(`/agencies/${encodeURIComponent(agencyName)}`);

        // Populate Ratios
        document.getElementById('inp-mgmt-ratio').value = agency.managementRatio ?? (agency.profitRatio ?? 10);
        document.getElementById('inp-salary-ratio').value = agency.salaryTransferRatio ?? 7;

        // Update activation status UI
        const isActive = agency.isActive !== false;
        updateAgencyStatusUI(isActive);
        window.currentAgencyIsActive = isActive;
    } catch (e) {
        document.getElementById('inp-mgmt-ratio').value = 10;
        document.getElementById('inp-salary-ratio').value = 7;
        updateAgencyStatusUI(true);
        window.currentAgencyIsActive = true;
    }
}

async function saveAgencyConfig() {
    if (!currentAgency) return;
    const mgmtVal = parseFloat(document.getElementById('inp-mgmt-ratio').value);
    const salaryVal = parseFloat(document.getElementById('inp-salary-ratio').value);
    const mgmtRatio = isNaN(mgmtVal) ? 10 : mgmtVal;
    const salaryRatio = isNaN(salaryVal) ? 7 : salaryVal;

    // DEBUG LOGGING
    console.log('🔍 DEBUG: saveAgencyConfig called');
    console.log('  Agency:', currentAgency);
    console.log('  Input Value (raw):', document.getElementById('inp-mgmt-ratio').value);
    console.log('  Parsed Value:', mgmtVal);
    console.log('  Final mgmtRatio:', mgmtRatio);
    console.log('  Sending to API:', { managementRatio: mgmtRatio, salaryTransferRatio: salaryRatio });

    try {
        await api.put(`/agencies/${encodeURIComponent(currentAgency)}`, {
            managementRatio: mgmtRatio,
            salaryTransferRatio: salaryRatio,
            profitRatio: mgmtRatio // Sync legacy
        });

        // Auto-recalculate all periods after ratio change
        alert('✅ تم حفظ الإعدادات\nجاري إعادة حساب جميع الدورات...');

        try {
            const periods = await api.get('/periods');
            for (const period of periods) {
                await api.post(`/periods/${period.id}/recalculate`);
            }
            alert('✅ تم تحديث جميع الحسابات بناءً على النسب الجديدة');
        } catch (recalcErr) {
            console.warn('Recalculation warning:', recalcErr);
            alert('⚠️ تم حفظ الإعدادات لكن لم يتم إعادة الحساب تلقائياً. قد تحتاج لإعادة رفع الشيتات.');
        }
    } catch (e) {
        alert('❌ خطأ: ' + e.message);
    }
}

function updateAgencyStatusUI(isActive) {
    const badge = document.getElementById('agency-status-badge');
    const btn = document.getElementById('btn-toggle-agency');

    if (isActive) {
        badge.style.background = '#1a4a1a';
        badge.style.color = '#4caf50';
        badge.innerText = '✅ مفعّلة';
        btn.innerText = '⏸️ إيقاف الوكالة';
        btn.className = 'btn btn-secondary btn-sm';
    } else {
        badge.style.background = '#4a1a1a';
        badge.style.color = '#f44336';
        badge.innerText = '⏸️ موقوفة';
        btn.innerText = '▶️ تفعيل الوكالة';
        btn.className = 'btn btn-primary btn-sm';
    }
}

async function toggleAgencyActive() {
    if (!currentAgency || currentAgency === 'Main') {
        alert('لا يمكن تغيير حالة الوكالة الرئيسية');
        return;
    }

    try {
        const result = await api.post(`/agencies/${encodeURIComponent(currentAgency)}/toggle-active`, {});
        window.currentAgencyIsActive = result.isActive;
        updateAgencyStatusUI(result.isActive);

        alert(result.isActive ? '✅ تم تفعيل الوكالة\nجاري إعادة حساب الدورات...' : '⏸️ تم إيقاف الوكالة\nجاري إعادة حساب الدورات...');

        // Auto-recalculate all periods after status change
        try {
            const periods = await api.get('/periods');
            for (const period of periods) {
                await api.post(`/periods/${period.id}/recalculate`);
            }
            alert('✅ تم تحديث جميع الحسابات');
        } catch (recalcErr) {
            console.warn('Recalculation warning:', recalcErr);
            alert('⚠️ تم تغيير الحالة لكن قد تحتاج لإعادة حساب الدورات يدوياً');
        }
    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

function openRenameAgencyModal() {
    const newName = prompt('أدخل الاسم الجديد للوكالة:', currentAgency);
    if (!newName || newName.trim() === '' || newName.trim() === currentAgency) return;

    renameAgency(newName.trim());
}

async function renameAgency(newName) {
    if (!currentAgency || currentAgency === 'Main') {
        alert('لا يمكن تغيير اسم الوكالة الرئيسية');
        return;
    }

    try {
        await api.post(`/agencies/${encodeURIComponent(currentAgency)}/rename`, { newName });
        alert('✅ تم تغيير اسم الوكالة بنجاح');

        // Update current agency and reload
        currentAgency = newName;
        openAgencyProfile(newName);
    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

async function saveAgencyRatio() {
    const ratio = document.getElementById('inp-agency-ratio').value;
    if (!currentAgency || currentAgency === 'Main') {
        alert('لا يمكن تغيير نسبة الوكالة الرئيسية');
        return;
    }

    try {
        await api.put(`/agencies/${encodeURIComponent(currentAgency)}`, {
            profitRatio: parseFloat(ratio)
        });
        alert('تم حفظ النسبة بنجاح ✅');
    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

// ================= PAGINATION VARIABLES =================
let currentUsersPage = 1;
const USERS_PER_PAGE = 50;
let filteredUsersCache = [];
let allAgencyUsers = [];

function renderUsersTable(tbody, users, showDelete = false) {
    // Store for pagination
    allAgencyUsers = users;
    currentUsersPage = 1;
    filterUsersTable(); // This will handle rendering with current filter
}

function filterUsersTable() {
    const searchTerm = (document.getElementById('inp-users-search')?.value || '').toLowerCase().trim();

    if (searchTerm) {
        filteredUsersCache = allAgencyUsers.filter(u =>
            (u.id && u.id.toString().includes(searchTerm)) ||
            (u.name && u.name.toLowerCase().includes(searchTerm))
        );
    } else {
        filteredUsersCache = [...allAgencyUsers];
    }

    currentUsersPage = 1;
    renderCurrentPage();
}

function renderCurrentPage() {
    const tbody = document.getElementById('profile-users-list');
    if (!tbody) return;

    const totalPages = Math.ceil(filteredUsersCache.length / USERS_PER_PAGE) || 1;
    const start = (currentUsersPage - 1) * USERS_PER_PAGE;
    const end = start + USERS_PER_PAGE;
    const pageUsers = filteredUsersCache.slice(start, end);

    // Update pagination info
    const pageInfo = document.getElementById('page-info');
    if (pageInfo) {
        pageInfo.textContent = `صفحة ${currentUsersPage} من ${totalPages} (${filteredUsersCache.length} مستخدم)`;
    }

    tbody.innerHTML = '';
    if (pageUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="23" class="text-center">لا يوجد مستخدمين.</td></tr>';
        return;
    }

    pageUsers.forEach(u => {
        const tr = document.createElement('tr');
        const deleteBtn = `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')" style="margin-right: 5px;">🗑</button>`;
        tr.innerHTML = `
            <td>${u.id}</td>
            <td>${u.name || '-'}</td>
            <td>${u.gender || '-'}</td>
            <td>${u.roomNumber || '-'}</td>
            <td>${u.agencyName || '-'}</td>
            <td>${u.agencyId || '-'}</td>
            <td>${u.region || '-'}</td>
            <td>${u.country || '-'}</td>
            <td>${u.regDate || '-'}</td>
            <td>${u.hasOtherAccount ? '✓' : '-'}</td>
            <td>${u.hours || '-'}</td>
            <td>${u.goldReceived ? u.goldReceived.toLocaleString() : '-'}</td>
            <td>${u.goldFromLastMonth ? u.goldFromLastMonth.toLocaleString() : '-'}</td>
            <td>${u.goldFromRatio ? u.goldFromRatio.toLocaleString() : '-'}</td>
            <td>${u.totalTarget ? u.totalTarget.toLocaleString() : '-'}</td>
            <td>${u.lastMonthLevel || '-'}</td>
            <td>${u.level || '-'}</td>
            <td>${u.targetSalary ? u.targetSalary.toLocaleString() : '-'}</td>
            <td>${u.activityBonus ? u.activityBonus.toLocaleString() : '-'}</td>
            <td>${u.firstWeekBonus ? u.firstWeekBonus.toLocaleString() : '-'}</td>
            <td>${u.monthlyBonus ? u.monthlyBonus.toLocaleString() : '-'}</td>
            <td style="font-weight: bold; color: #4caf50;">${u.totalSalary ? u.totalSalary.toLocaleString() : '-'}</td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="editUser('${u.id}')">✏</button>
                ${deleteBtn}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function prevUsersPage() {
    if (currentUsersPage > 1) {
        currentUsersPage--;
        renderCurrentPage();
    }
}

function nextUsersPage() {
    const totalPages = Math.ceil(filteredUsersCache.length / USERS_PER_PAGE) || 1;
    if (currentUsersPage < totalPages) {
        currentUsersPage++;
        renderCurrentPage();
    }
}

function getAgencyName(u) {
    if (!u.agencyName || ['Soulchill', 'WhiteAgency', 'Main'].includes(u.agencyName)) return 'Main';
    return u.agencyName;
}

function openAddAgencyModal() {
    document.getElementById('modal-add-agency').style.display = 'flex';
}

async function addAgency() {
    const name = document.getElementById('inp-agency-name').value.trim();
    if (!name) return alert('أدخل الاسم');
    if (name.toLowerCase() === 'main') return alert('لا يمكن استخدام اسم "Main"');

    try {
        // Save agency to database with default 10% ratio
        await api.put(`/agencies/${encodeURIComponent(name)}`, {
            profitRatio: 10
        });

        closeModal('modal-add-agency');
        document.getElementById('inp-agency-name').value = ''; // Clear input

        // Refresh sub-agencies list and then open the new agency
        await showSubAgencies();
        openAgencyProfile(name);

    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

function openAddUserModal(agency = null) {
    window.isEditingUser = false;
    document.querySelector('#modal-add-user h3').innerText = 'إضافة مستخدم جديد';
    document.getElementById('btn-save-user').innerText = 'إضافة';
    document.getElementById('inp-user-id').disabled = false;
    document.getElementById('inp-user-id').value = '';
    document.getElementById('inp-user-name').value = '';
    document.getElementById('inp-user-country').value = '';

    document.getElementById('inp-user-agency').value = agency || currentAgency;
    document.getElementById('modal-add-user').style.display = 'flex';
}

async function addUser() {
    const id = document.getElementById('inp-user-id').value.trim();
    const name = document.getElementById('inp-user-name').value.trim();
    const country = document.getElementById('inp-user-country').value.trim();
    const agency = document.getElementById('inp-user-agency').value.trim();

    if (!id || !name) return alert('البيانات ناقصة');

    try {
        if (window.isEditingUser) {
            // Use original ID for the update endpoint
            const originalId = window.editingUserId || id;
            const newId = id; // User might have changed the ID

            await api.put(`/users/${originalId}`, {
                id: newId, // Include new ID in body for potential ID change
                name, country, agencyName: agency, type: 'Host'
            });
            alert('تم التعديل');
        } else {
            // Adding new user - check for duplicates first
            try {
                await api.post('/users', {
                    id, name, country, agencyName: agency, type: 'Host'
                });
                alert('تمت الإضافة');
            } catch (err) {
                // Check if it's a duplicate ID error
                if (err.message.includes('مستخدم بالفعل') || err.message.includes('already exists')) {
                    const confirmMsg = err.message +
                        `\n\n⚠️ تعارض في الوكالات!` +
                        `\n🔴 الوكالة الموجود فيها حالياً: (مذكورة أعلاه)` +
                        `\n🟢 الوكالة التي تحاول إضافته إليها: ${agency}` +
                        `\n\nهل تريد تأكيد النقل وتخصيصه لهذه الوكالة (${agency})؟`;

                    const forceAdd = confirm(confirmMsg);
                    if (forceAdd) {
                        // Force update to reassign to this agency
                        await api.put(`/users/${id}`, {
                            name, country, agencyName: agency, type: 'Host'
                        });
                        alert('تم تحديث المستخدم ونقله لهذه الوكالة');
                    } else {
                        return; // User cancelled
                    }
                } else {
                    throw err; // Rethrow other errors
                }
            }
        }
        closeModal('modal-add-user');

        if (currentAgency === 'Main') showMainAgency();
        else openAgencyProfile(currentAgency);

    } catch (e) { alert(e.message); }
}

function editUser(id) {
    console.log('[editUser] Called with ID:', id, 'Type:', typeof id);
    console.log('[editUser] allUsersCache length:', allUsersCache?.length);
    console.log('[editUser] First few users:', allUsersCache?.slice(0, 3));

    // Ensure loose comparison for ID (string vs number)
    const user = allUsersCache.find(u => u.id == id);
    console.log('[editUser] Found user:', user);

    if (!user) {
        alert('لم يتم العثور على المستخدم! (ID: ' + id + ')');
        return;
    }

    window.isEditingUser = true; // Flag for reusing Add Modal
    window.editingUserId = id; // Store original ID for update
    document.querySelector('#modal-add-user h3').innerText = 'تعديل مستخدم';

    const saveBtn = document.getElementById('btn-save-user');
    if (saveBtn) saveBtn.innerText = 'حفظ التعديلات';

    document.getElementById('inp-user-id').value = user.id;

    // Allow ID editing for sub-agency users only
    const isMainAgency = getAgencyName(user) === 'Main';
    document.getElementById('inp-user-id').disabled = isMainAgency;

    document.getElementById('inp-user-name').value = user.name;
    document.getElementById('inp-user-country').value = user.country || '';
    document.getElementById('inp-user-agency').value = getAgencyName(user);

    document.getElementById('modal-add-user').style.display = 'flex';
}

async function deleteUser(id) {
    if (!confirm('هل أنت متأكد من حذف هذا المستخدم؟ لا يمكن التراجع.')) return;

    try {
        await api.delete(`/users/${id}`);
        // Remove from cache locally to avoid full refetch if possible, or just refresh
        allUsersCache = allUsersCache.filter(u => u.id != id);

        // Refresh Current View
        if (document.getElementById('page-main-agency').style.display === 'block') {
            showMainAgency();
        } else {
            openAgencyProfile(currentAgency);
        }
    } catch (e) { alert(e.message); }
}

function deleteAgency() {
    if (!confirm('هل أنت متأكد؟ (Visual Only)')) return;
    showSubAgencies();
}

// ================= DOWNLOAD TEMPLATE =================
function downloadUsersTemplate() {
    // Create CSV header
    const headers = ['ID', 'الاسم', 'الهاتف', 'الدولة', 'الوكالة', 'العنوان'];
    const exampleRow = ['12345678', 'اسم المستخدم', '0912345678', 'سوريا', 'اسم الوكالة (اختياري)', 'العنوان (اختياري)'];

    const csvContent = '\uFEFF' + headers.join(',') + '\n' + exampleRow.join(',') + '\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'users_template.csv';
    link.click();
}

// ================= BULK ID IMPORT FROM SHEET =================
async function openBulkIdImportModal() {
    document.getElementById('inp-bulk-ids').value = '';
    document.getElementById('inp-bulk-agency').value = currentAgency || 'Main';
    document.getElementById('modal-bulk-import').style.display = 'flex';

    // Load periods into dropdown
    const select = document.getElementById('sel-bulk-period');
    select.innerHTML = '<option value="">جاري التحميل...</option>';

    try {
        const periods = await api.get('/periods');
        select.innerHTML = '';

        if (periods.length === 0) {
            select.innerHTML = '<option value="">لا توجد دورات. أنشئ دورة أولاً.</option>';
            return;
        }

        periods.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} (${new Date(p.startDate).toLocaleDateString('ar-EG')})`;
            select.appendChild(opt);
        });
    } catch (e) {
        select.innerHTML = '<option value="">خطأ في تحميل الدورات</option>';
    }
}

function closeBulkImportModal() {
    document.getElementById('modal-bulk-import').style.display = 'none';
}

async function processBulkImport() {
    const periodId = document.getElementById('sel-bulk-period').value;
    const idsText = document.getElementById('inp-bulk-ids').value.trim();
    const targetAgency = document.getElementById('inp-bulk-agency').value.trim() || currentAgency;

    if (!periodId) return alert('يرجى اختيار الدورة');
    if (!idsText) return alert('يرجى إدخال قائمة الـ IDs');

    // Parse IDs (one per line)
    const requestedIds = idsText.split('\n').map(id => id.trim()).filter(id => id);
    if (requestedIds.length === 0) return alert('لا توجد IDs صالحة');

    // Fetch sheet data from API for selected period
    let sheetData;
    try {
        sheetData = await api.get(`/sheet-data/${periodId}`);
    } catch (e) {
        return alert('خطأ: ' + e.message + '\n\nيرجى التأكد من رفع شيت الإدارة لهذه الدورة.');
    }

    if (!sheetData.records || sheetData.records.length === 0) {
        return alert('لا توجد بيانات في شيت الإدارة لهذه الدورة.');
    }

    // Build a map from sheet data: ID -> user info
    // Columns: A=ID, B=Name, C=Gender, D=Room, E=Agency, F=AgencyId, G=Region, H=Country, I=RegDate
    const sheetMap = {};
    for (const row of sheetData.records) {
        const id = row[0]?.toString();
        if (id) {
            sheetMap[id] = {
                id: id,
                name: row[1] || '',
                gender: row[2] || '',
                roomNumber: row[3] || '',
                agencyName: row[4] || '',
                agencyId: row[5] || '',
                region: row[6] || '',
                country: row[7] || '',
                regDate: row[8] || '',
                hasOtherAccount: row[9] === '1' || row[9] === 1,
                hours: parseFloat(row[10]) || 0,
                goldReceived: parseFloat(row[11]) || 0,
                goldFromLastMonth: parseFloat(row[12]) || 0,
                goldFromRatio: parseFloat(row[13]) || 0,
                totalTarget: parseFloat(row[14]) || 0,
                lastMonthLevel: row[15] || '',
                level: row[16] || '',
                targetSalary: parseFloat(row[17]) || 0,
                activityBonus: parseFloat(row[18]) || 0,
                firstWeekBonus: parseFloat(row[19]) || 0,
                monthlyBonus: parseFloat(row[20]) || 0,
                totalSalary: parseFloat(row[21]) || 0,
                profit: parseFloat(row[22]) || 0 // Map Agency Profit from Col 22
            };
        }
    }

    // Find matches
    const foundUsers = [];
    const notFound = [];

    for (const id of requestedIds) {
        if (sheetMap[id]) {
            foundUsers.push(sheetMap[id]);
        } else {
            notFound.push(id);
        }
    }

    if (foundUsers.length === 0) {
        return alert(`لم يتم العثور على أي من الـ IDs في بيانات الشيت!\nIDs المطلوبة: ${requestedIds.join(', ')}`);
    }

    // Confirm import
    let message = `✅ تم العثور على ${foundUsers.length} مستخدم`;
    if (notFound.length > 0) {
        message += `\n⚠️ لم يتم العثور على ${notFound.length}: ${notFound.slice(0, 5).join(', ')}${notFound.length > 5 ? '...' : ''}`;
    }

    // Check for Agency Mismatch (Sheet vs Target)
    const mismatched = foundUsers.filter(u => {
        // Normalize: 'Main' vs empty/Main
        const sheetAg = u.agencyName || 'Main';
        const targetAg = targetAgency || 'Main';
        return sheetAg !== targetAg;
    });

    if (mismatched.length > 0) {
        message += `\n\n⚠️ تــنــبــيــه:`;
        message += `\nهناك ${mismatched.length} مستخدم مسجلين في وكالات أخرى في الشيت!`;
        message += `\n(سيتم نقلهم إلى ${targetAgency})`;
    }

    message += `\n\nهل تريد استيرادهم إلى وكالة "${targetAgency}"؟`;

    if (!confirm(message)) return;

    // Use Backend Import Logic via /users/import-json (supports JSON rows)
    const rows = foundUsers.map(u => ({
        ...u,
        originalAgency: u.agencyName, // Preserve original for Anti-Poaching check
        agencyName: targetAgency // Target agency
    }));

    const btn = document.querySelector('button[onclick="processBulkImport()"]');
    const oldText = btn.textContent;
    btn.textContent = 'جاري المعالجة...';
    btn.disabled = true;

    try {
        const res = await api.post('/users/import-json', {
            rows: rows,
            agencyOverride: targetAgency
        });

        handleImportResponse(res, closeBulkImportModal);
    } catch (e) {
        alert('خطأ في الاستيراد: ' + e.message);
    } finally {
        btn.textContent = oldText;
        btn.disabled = false;
    }
}

// ================= IMPORT USERS =================

function handleImportResponse(res, modalToClose = null) {
    let message = `تم التحميل!\nجديد: ${res.newUsers}`;
    if (res.updatedUsers > 0) message += `\nتحديث: ${res.updatedUsers}`;

    // Check for cross-agency conflicts (SUSPENDED)
    if (res.crossAgencyConflicts && res.crossAgencyConflicts.length > 0) {
        const conflicts = res.crossAgencyConflicts;
        message += `\n\n🔴 تم تعليق ${conflicts.length} مستخدم بسبب تعارض بين الوكالات!`;
        message += `\n\nالمستخدمين المعلقين موجودين في أكثر من وكالة`;
        message += `\nيرجى تحديد الوكالة الصحيحة من صفحة المعلقين.`;
        alert(message);
        if (modalToClose) modalToClose();
        showSuspendedUsers();
        return;
    }

    // Check for duplicates (same agency) or just show success
    if (res.duplicates && res.duplicates.length > 0) {
        message += `\n\n⚠️ تم العثور على ${res.duplicates.length} مستخدم مكرر`;
        alert(message);
        window.pendingDuplicates = res.duplicates;
        if (modalToClose) modalToClose();
        showDuplicatesReviewModal();
    } else {
        alert(message);
        if (modalToClose) modalToClose();
        refreshCurrentView();
    }
}

function refreshCurrentView() {
    if (document.getElementById('page-sub-agencies').style.display === 'block') {
        showSubAgencies();
    } else if (document.getElementById('page-main-agency').style.display === 'block') {
        showMainAgency();
    } else if (document.getElementById('page-agency-profile').style.display === 'block') {
        openAgencyProfile(currentAgency);
    }
}
function openImportUsersModal(forCurrentAgency = false) {
    window.isAgencyImport = forCurrentAgency;
    const title = forCurrentAgency ? `استيراد مستخدمين لـ (${currentAgency})` : 'استيراد قاعدة بيانات المستخدمين';
    document.querySelector('#modal-import-users h2').innerText = title;

    document.getElementById('modal-import-users').style.display = 'flex';
}

function closeModalUsers() {
    document.getElementById('modal-import-users').style.display = 'none';
}

async function importUsers() {
    const file = document.getElementById('file-users-db').files[0];
    if (!file) return alert('يرجى اختيار ملف');

    // Check Override
    let agencyOverride = null;
    if (window.isAgencyImport && currentAgency && currentAgency !== 'Main') {
        agencyOverride = currentAgency;
    }

    const btn = document.querySelector('button[onclick="importUsers()"]');
    const oldText = btn.textContent;
    btn.textContent = 'جاري الرفع...';
    btn.disabled = true;

    try {
        const fd = new FormData();
        fd.append('file', file);
        if (agencyOverride) fd.append('agencyOverride', agencyOverride);

        const res = await api.upload('/users/import', fd);

        handleImportResponse(res, closeModalUsers);

    } catch (err) {
        alert('خطأ: ' + err.message);
    } finally {
        btn.textContent = oldText;
        btn.disabled = false;
    }
}

function showDuplicatesReviewModal() {
    const duplicates = window.pendingDuplicates || [];
    if (duplicates.length === 0) return;

    // Create review modal if not exists
    let modal = document.getElementById('modal-duplicates-review');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-duplicates-review';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 700px; max-height: 80vh; overflow-y: auto;">
                <h2>⚠️ مراجعة المستخدمين المكررين</h2>
                <p style="color: #aaa;">هؤلاء المستخدمين موجودين مسبقاً. اختر الإجراء لكل واحد:</p>
                <table class="data-table" id="duplicates-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>الاسم (جديد)</th>
                            <th>موجود حالياً</th>
                            <th>الوكالة الحالية</th>
                            <th>الوكالة الجديدة (الهدف)</th>
                            <th>إجراء</th>
                        </tr>
                    </thead>
                    <tbody id="duplicates-list"></tbody>
                </table>
                <div class="modal-actions" style="margin-top: 15px;">
                    <button class="btn btn-secondary" onclick="closeDuplicatesModal()">إغلاق</button>
                    <button class="btn btn-primary" onclick="approveAllDuplicates()">✅ قبول الكل ونقلهم</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Populate table
    const tbody = document.getElementById('duplicates-list');
    tbody.innerHTML = '';

    duplicates.forEach((dup, index) => {
        const tr = document.createElement('tr');
        tr.id = `dup-row-${index}`;
        tr.innerHTML = `
            <td><span style="color: #f39c12;">⚠️</span> ${dup.existingUser.id}</td>
            <td>${dup.importData.name}</td>
            <td>${dup.existingUser.name}</td>
            <td style="color: #f44336; font-weight: bold;">${dup.existingUser.agencyName || 'غير محدد'}</td>
            <td style="color: #4caf50; font-weight: bold;">${dup.importData.agencyName || 'Main'}</td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="resolveDuplicate(${index}, 'approve')">✅ قبول وتحديث</button>
                <button class="btn btn-danger btn-sm" onclick="resolveDuplicate(${index}, 'skip')" style="margin-right: 5px;">❌ تخطي</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    modal.style.display = 'flex';
}

function closeDuplicatesModal() {
    const modal = document.getElementById('modal-duplicates-review');
    if (modal) modal.style.display = 'none';
    window.pendingDuplicates = [];
}

async function resolveDuplicate(index, action) {
    const dup = window.pendingDuplicates[index];
    if (!dup) return;

    const row = document.getElementById(`dup-row-${index}`);

    if (action === 'approve') {
        try {
            await api.post('/users/resolve-duplicate', {
                id: dup.existingUser.id,
                importData: dup.importData,
                action: 'approve'
            });
            row.style.background = '#1a3a1a';
            row.innerHTML = `<td colspan="5" style="color: #4caf50;">✅ تم تحديث ${dup.existingUser.id} ونقله للوكالة الجديدة</td>`;
        } catch (e) {
            alert('خطأ: ' + e.message);
        }
    } else {
        row.style.background = '#3a1a1a';
        row.innerHTML = `<td colspan="5" style="color: #aaa;">❌ تم تخطي ${dup.existingUser.id}</td>`;
    }

    // Remove from pending
    window.pendingDuplicates[index] = null;
}

async function approveAllDuplicates() {
    if (!confirm('سيتم تحديث جميع المستخدمين المكررين ونقلهم للوكالة الجديدة. متابعة؟')) return;

    for (let i = 0; i < window.pendingDuplicates.length; i++) {
        if (window.pendingDuplicates[i]) {
            await resolveDuplicate(i, 'approve');
        }
    }

    alert('تم معالجة جميع المكررين!');
    closeDuplicatesModal();

    // Refresh
    if (currentAgency === 'Main') showMainAgency();
    else openAgencyProfile(currentAgency);
}

async function syncAIUsers() {
    if (!confirm('سيتم سحب جميع المستخدمين المسجلين في قسم الذكاء الاصطناعي وإضافتهم للوكالة الرئيسية. هل تريد المتابعة؟')) return;

    // Find button to show loading
    const btn = document.querySelector('button[onclick="syncAIUsers()"]');
    const oldText = btn ? btn.textContent : '';
    if (btn) {
        btn.textContent = 'جاري المزامنة...';
        btn.disabled = true;
    }

    try {
        const res = await api.post('/users/sync-ai', {});
        alert(`تمت المزامنة بنجاح!\nجديد: ${res.added}\nتحديث: ${res.updated}`);
        showMainAgency(); // Refresh list
    } catch (e) {
        alert('خطأ في المزامنة: ' + e.message);
    } finally {
        if (btn) {
            btn.textContent = oldText;
            btn.disabled = false;
        }
    }
}

// Init
// ================= INIT & ROUTING =================
function handleHashChange() {
    const hash = window.location.hash;
    if (hash === '#main-agency') showMainAgency();
    else if (hash === '#sub-agencies') showSubAgencies();
    else if (hash === '#treasury') showTreasury();
    else if (hash === '#agency-wallets') showAgencyWallets();
    else if (hash.startsWith('#wallet-')) {
        const name = decodeURIComponent(hash.replace('#wallet-', ''));
        openWalletDetail(name);
    }
    else if (hash === '#unknown-users') showUnknownUsers();
    else if (hash.startsWith('#agency-')) {
        const name = decodeURIComponent(hash.replace('#agency-', ''));
        openAgencyProfile(name);
    }
    else showDashboard();
}

// Override openAgencyProfile to set hash (need to update the function above or here)
// Ideally we just set hash and let handler do it, but to match existing flow:
/* The openAgencyProfile function in lines 309-322 needs the hash update too. 
   I will inject it into init for now. 
*/

document.addEventListener('DOMContentLoaded', () => {
    updateSafeBalance(); // Always fetch safe balance

    // If we have a hash, respect it.
    if (window.location.hash) handleHashChange();
    else showDashboard(); // Use showDashboard instead of just refreshCycles to trigger full view logic

    // Listen
    window.addEventListener('hashchange', handleHashChange);
});

// ================= TREASURY PAGE =================
async function showTreasury() {
    hideAllPages();
    document.getElementById('page-treasury').style.display = 'block';
    window.location.hash = '#treasury';

    // Load Summary
    try {
        const summary = await api.get('/treasury/summary');
        document.getElementById('treasury-balance').textContent = `$${summary.safeBalance.toLocaleString()}`;
        document.getElementById('treasury-income').textContent = `$${summary.totalIncome.toLocaleString()}`;
        document.getElementById('treasury-expense').textContent = `$${summary.totalExpense.toLocaleString()}`;
        document.getElementById('treasury-profit').textContent = `$${summary.netProfit.toLocaleString()}`;
        document.getElementById('treasury-custody').textContent = `$${summary.totalCustody.toLocaleString()}`;

        // Populate profit breakdown
        document.getElementById('profit-commission').textContent = `$${(summary.totalSalaryCommission || 0).toLocaleString()}`;
        document.getElementById('profit-cycle-income').textContent = `$${(summary.totalCycleIncome || 0).toLocaleString()}`;
        document.getElementById('profit-sub-agency').textContent = `$${(summary.subAgencyProfitPaid || 0).toLocaleString()}`;
        document.getElementById('profit-net-total').textContent = `$${summary.netProfit.toLocaleString()}`;
    } catch (e) {
        console.error('Error loading treasury summary:', e);
    }

    // Load Transactions
    const tbody = document.getElementById('treasury-transactions');
    tbody.innerHTML = '<tr><td colspan="5">جاري التحميل...</td></tr>';

    try {
        const transactions = await api.get('/treasury/transactions');
        tbody.innerHTML = '';

        if (transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">لا توجد معاملات</td></tr>';
            return;
        }

        transactions.forEach(tx => {
            const tr = document.createElement('tr');
            const typeClass = tx.type === 'INCOME' ? 'text-green' : 'text-red';
            const typeLabel = tx.type === 'INCOME' ? 'دخل' : (tx.type === 'EXPENSE' ? 'مصروف' : tx.type);
            tr.innerHTML = `
                <td>${new Date(tx.date).toLocaleDateString('ar-EG')}</td>
                <td class="${typeClass}">${typeLabel}</td>
                <td>${tx.category || '-'}</td>
                <td class="${typeClass}">${tx.type === 'INCOME' ? '+' : '-'}$${tx.amount.toFixed(2)}</td>
                <td>${tx.description || '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5">${e.message}</td></tr>`;
    }
}


// ================= AGENCY WALLETS PAGE =================
let isLoadingWallets = false; // Prevent race condition

async function showAgencyWallets() {
    if (isLoadingWallets) {
        console.log('Already loading wallets, skipping duplicate call');
        return;
    }

    isLoadingWallets = true;
    hideAllPages();
    document.getElementById('page-agency-wallets').style.display = 'block';
    window.location.hash = '#agency-wallets';

    const grid = document.getElementById('agency-wallets-grid');
    grid.innerHTML = '<p>جاري التحميل...</p>';

    try {
        const wallets = await api.get('/agency-wallets');
        grid.innerHTML = '';

        if (wallets.length === 0) {
            grid.innerHTML = '<p class="text-center">لا توجد وكالات. أضف وكالة من "الوكالات الفرعية".</p>';
            return;
        }

        wallets.forEach(w => {
            const card = document.createElement('div');
            card.className = 'ai-card';
            card.style.cssText = 'padding: 20px; cursor: pointer; transition: transform 0.2s;';
            card.onmouseover = () => card.style.transform = 'scale(1.02)';
            card.onmouseout = () => card.style.transform = 'scale(1)';
            card.onclick = () => openWalletDetail(w.name);

            const statusBadge = w.isActive
                ? '<span style="background: #1a4a1a; color: #4caf50; padding: 2px 8px; border-radius: 10px; font-size: 11px;">مفعّلة</span>'
                : '<span style="background: #4a1a1a; color: #f44336; padding: 2px 8px; border-radius: 10px; font-size: 11px;">موقوفة</span>';

            const lastTxInfo = w.lastTransaction
                ? `آخر معاملة: ${new Date(w.lastTransaction.date).toLocaleDateString('ar-EG')}`
                : 'لا توجد معاملات';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h3 style="margin: 0;">📦 ${w.name}</h3>
                    ${statusBadge}
                </div>
                <div style="font-size: 28px; font-weight: bold; margin: 15px 0; color: ${w.balance > 0 ? '#4caf50' : '#888'};">
                    $${w.balance.toLocaleString()}
                </div>
                <div style="font-size: 12px; color: #888;">${lastTxInfo}</div>
                <div style="font-size: 11px; color: #666; margin-top: 5px;">نسبة الإدارة: ${w.managementRatio}%</div>
            `;
            grid.appendChild(card);
        });

        // المجهولين موجودين في مودال تفاصيل الأمانات، تم حذفهم من هنا

    } catch (e) {
        grid.innerHTML = `<p class="text-red">${e.message}</p>`;
    } finally {
        isLoadingWallets = false; // Reset flag to allow future calls
    }
}

// ================= WALLET DETAIL PAGE =================
let currentWalletAgency = null;

async function openWalletDetail(agencyName) {
    hideAllPages();
    document.getElementById('page-wallet-detail').style.display = 'block';
    window.location.hash = `#wallet-${encodeURIComponent(agencyName)}`;
    currentWalletAgency = agencyName;

    document.getElementById('wallet-detail-name').textContent = `📦 صندوق ${agencyName}`;

    try {
        const wallet = await api.get(`/agencies/${encodeURIComponent(agencyName)}/wallet`);

        document.getElementById('wallet-balance').textContent = `$${wallet.balance.toLocaleString()}`;
        document.getElementById('wallet-in').textContent = `$${wallet.totalIn.toLocaleString()}`;
        document.getElementById('wallet-out').textContent = `$${wallet.totalOut.toLocaleString()}`;

        // Transactions
        const tbody = document.getElementById('wallet-transactions');
        tbody.innerHTML = '';

        if (!wallet.transactions || wallet.transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">لا توجد معاملات</td></tr>';
            return;
        }

        wallet.transactions.forEach(tx => {
            const tr = document.createElement('tr');
            const isIn = tx.type === 'EXPENSE' && tx.category === 'Agency Profit';
            const typeClass = isIn ? 'text-green' : 'text-red';
            const typeLabel = isIn ? 'وارد (ربح)' : 'سحب';
            tr.innerHTML = `
                <td>${new Date(tx.date).toLocaleDateString('ar-EG')}</td>
                <td class="${typeClass}">${typeLabel}</td>
                <td class="${typeClass}">${isIn ? '+' : '-'}$${tx.amount.toFixed(2)}</td>
                <td>${tx.description || '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

// ================= WITHDRAW MODAL =================
function openWithdrawModal() {
    if (!currentWalletAgency) return;
    document.getElementById('inp-withdraw-amount').value = '';
    document.getElementById('inp-withdraw-note').value = '';
    document.getElementById('modal-withdraw').style.display = 'flex';
}

function closeWithdrawModal() {
    document.getElementById('modal-withdraw').style.display = 'none';
}

async function processWithdraw() {
    const amount = document.getElementById('inp-withdraw-amount').value;
    const note = document.getElementById('inp-withdraw-note').value;

    if (!amount || parseFloat(amount) <= 0) {
        return alert('يرجى إدخال مبلغ صالح');
    }

    try {
        const result = await api.post(`/agencies/${encodeURIComponent(currentWalletAgency)}/withdraw`, {
            amount: parseFloat(amount),
            description: note
        });

        alert(result.message);
        closeWithdrawModal();
        openWalletDetail(currentWalletAgency); // Refresh
    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

// ================= UNKNOWN USERS PAGE =================
async function showUnknownUsers() {
    hideAllPages();
    document.getElementById('page-unknown-users').style.display = 'block';
    window.location.hash = '#unknown-users';

    // Load periods into dropdown
    const select = document.getElementById('sel-unknown-period');
    select.innerHTML = '<option value="">جاري التحميل...</option>';

    try {
        const periods = await api.get('/periods');
        select.innerHTML = '<option value="">-- اختر دورة --</option>';

        periods.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} (${new Date(p.startDate).toLocaleDateString('ar-EG')})`;
            select.appendChild(opt);
        });

        // Auto-select first period
        if (periods.length > 0) {
            select.value = periods[0].id;
            loadUnknownUsers();
        }
    } catch (e) {
        select.innerHTML = '<option value="">خطأ في تحميل الدورات</option>';
    }
}

async function loadUnknownUsers() {
    const periodId = document.getElementById('sel-unknown-period').value;
    const tbody = document.getElementById('unknown-users-list');

    if (!periodId) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">اختر دورة أولاً</td></tr>';
        document.getElementById('unknown-count').textContent = '0';
        document.getElementById('unknown-custody').textContent = '$0';
        document.getElementById('unknown-commission').textContent = '$0';
        return;
    }

    tbody.innerHTML = '<tr><td colspan="6">جاري التحميل...</td></tr>';

    try {
        const data = await api.get(`/unknown-users/${periodId}`);

        document.getElementById('unknown-count').textContent = data.total.toLocaleString();
        document.getElementById('unknown-custody').textContent = `$${data.totalCustody.toLocaleString()}`;

        // Calculate total commission
        const totalCommission = data.users.reduce((sum, u) => sum + (u.commission || 0), 0);
        document.getElementById('unknown-commission').textContent = `$${totalCommission.toLocaleString()}`;

        tbody.innerHTML = '';

        if (data.users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">لا يوجد مستخدمين مجهولين في هذه الدورة ✅</td></tr>';
            return;
        }

        data.users.forEach((u, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${i + 1}</td>
                <td>${u.userId}</td>
                <td>${u.userName || '-'}</td>
                <td>$${(u.salary || 0).toFixed(2)}</td>
                <td class="text-green">$${(u.commission || 0).toFixed(2)}</td>
                <td class="text-yellow">$${(u.custody || 0).toFixed(2)}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-red">${e.message}</td></tr>`;
    }
}

// =====================================================
// CUSTODY DETAILS MODAL (Enhanced Design)
// =====================================================
async function showCustodyDetails() {
    try {
        const data = await api.get('/treasury/custody-details');

        // Calculate totals
        const totalUsers = data.byAgency?.reduce((sum, a) => sum + a.users.length, 0) || 0;
        const totalAgencies = data.byAgency?.length || 0;

        // Update summary stats
        document.getElementById('custody-total').textContent = `$${data.totalCustody.toFixed(2)}`;
        document.getElementById('custody-user-count').textContent = totalUsers.toLocaleString();
        document.getElementById('custody-agency-count').textContent = totalAgencies;
        document.getElementById('custody-period').innerHTML = data.periodName
            ? `📅 الدورة: <strong>${data.periodName}</strong>`
            : '';

        // ✅ Store data for search filtering
        custodyDataCache = data;
        document.getElementById('custody-search').value = ''; // Clear search on open
        document.getElementById('custody-search-count').textContent = ''; // Clear count

        const container = document.getElementById('custody-by-agency');
        container.innerHTML = '';

        if (!data.byAgency || data.byAgency.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; background: rgba(76, 175, 80, 0.1); border-radius: 12px; border: 1px dashed #4caf50;">
                    <div style="font-size: 48px; margin-bottom: 15px;">✅</div>
                    <p style="color: #4caf50; font-size: 16px; margin: 0;">لا توجد أمانات معلقة حالياً</p>
                </div>
            `;
        } else {
            // Sort agencies by total (highest first)
            const sortedAgencies = [...data.byAgency].sort((a, b) => b.total - a.total);

            // Agency color palette
            const colors = [
                { bg: 'linear-gradient(135deg, #1a472a 0%, #2e7d32 100%)', accent: '#4caf50', icon: '🏢' },
                { bg: 'linear-gradient(135deg, #1a3a4a 0%, #0277bd 100%)', accent: '#03a9f4', icon: '🏛️' },
                { bg: 'linear-gradient(135deg, #4a1a4a 0%, #7b1fa2 100%)', accent: '#ab47bc', icon: '🏠' },
                { bg: 'linear-gradient(135deg, #4a3a1a 0%, #f57c00 100%)', accent: '#ff9800', icon: '🏪' },
                { bg: 'linear-gradient(135deg, #4a1a1a 0%, #c62828 100%)', accent: '#ef5350', icon: '❓' }
            ];

            sortedAgencies.forEach((agency, index) => {
                const color = colors[index % colors.length];
                const percentage = ((agency.total / data.totalCustody) * 100).toFixed(1);
                const isUnknown = agency.agencyName === 'مجهول';

                const agencyCard = document.createElement('div');
                agencyCard.style.cssText = `
                    background: rgba(255,255,255,0.03);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 12px;
                    margin-bottom: 15px;
                    overflow: hidden;
                    transition: all 0.3s ease;
                `;
                agencyCard.onmouseenter = () => agencyCard.style.borderColor = color.accent;
                agencyCard.onmouseleave = () => agencyCard.style.borderColor = 'rgba(255,255,255,0.1)';

                // Build users list HTML
                let usersHtml = '';
                agency.users.forEach((u, i) => {
                    const initial = (u.userName || u.userId).charAt(0).toUpperCase();
                    usersHtml += `
                        <div data-user-id="${u.userId}" data-user-name="${u.userName || ''}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseenter="this.style.background='rgba(255,255,255,0.03)'" onmouseleave="this.style.background='transparent'">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <div style="width: 32px; height: 32px; border-radius: 50%; background: ${color.bg}; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; color: white;">${initial}</div>
                                <div>
                                    <div style="font-size: 13px; color: #fff;">${u.userName || u.userId}</div>
                                    <div style="font-size: 11px; color: #666;">ID: ${u.userId}</div>
                                </div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 14px; font-weight: bold; color: ${color.accent};">$${u.custody.toFixed(2)}</div>
                                <div style="font-size: 10px; color: #666;">⏳ معلق</div>
                            </div>
                        </div>
                    `;
                });

                agencyCard.innerHTML = `
                    <!-- Agency Header -->
                    <div style="background: ${color.bg}; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span style="font-size: 24px;">${isUnknown ? '❓' : color.icon}</span>
                            <div>
                                <h4 style="margin: 0; color: white; font-size: 16px;">${agency.agencyName}</h4>
                                <div style="font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 2px;">
                                    👤 ${agency.users.length} مستخدم
                                </div>
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 22px; font-weight: bold; color: white;">$${agency.total.toFixed(2)}</div>
                            <div style="font-size: 11px; color: rgba(255,255,255,0.7);">${percentage}% من الإجمالي</div>
                        </div>
                    </div>
                    
                    <!-- Progress Bar -->
                    <div style="height: 4px; background: rgba(255,255,255,0.1);">
                        <div style="height: 100%; width: ${percentage}%; background: ${color.accent}; transition: width 0.5s ease;"></div>
                    </div>
                    
                    <!-- Users List -->
                    <div style="max-height: 250px; overflow-y: auto;">
                        ${usersHtml}
                    </div>
                `;

                container.appendChild(agencyCard);
            });
        }

        document.getElementById('modal-custody-details').style.display = 'flex';
    } catch (e) {
        console.error('Error loading custody details:', e);
        alert('❌ خطأ في تحميل تفاصيل الأمانات: ' + e.message);
    }
}

function closeCustodyDetailsModal() {
    document.getElementById('modal-custody-details').style.display = 'none';
    document.getElementById('custody-search').value = ''; // مسح البحث عند الإغلاق
}

// Store custody data globally for filtering
let custodyDataCache = null;

// Filter custody users by ID or name
function filterCustodyUsers(searchQuery) {
    if (!custodyDataCache) return;

    const query = searchQuery.toLowerCase().trim();
    const container = document.getElementById('custody-by-agency');
    const userRows = container.querySelectorAll('[data-user-id]');

    let visibleCount = 0;
    let totalCount = userRows.length;

    userRows.forEach(row => {
        const userId = row.getAttribute('data-user-id')?.toLowerCase() || '';
        const userName = row.getAttribute('data-user-name')?.toLowerCase() || '';

        if (!query || userId.includes(query) || userName.includes(query)) {
            row.style.display = 'flex';
            visibleCount++;
            // تمييز النتائج المطابقة
            if (query) {
                row.style.background = 'rgba(102, 126, 234, 0.15)';
                row.style.borderLeft = '3px solid #667eea';
            } else {
                row.style.background = 'transparent';
                row.style.borderLeft = 'none';
            }
        } else {
            row.style.display = 'none';
        }
    });

    // Update search count
    const countEl = document.getElementById('custody-search-count');
    if (query) {
        countEl.textContent = `${visibleCount} / ${totalCount}`;
    } else {
        countEl.textContent = '';
    }
}

// =====================================================
// SUSPENDED USERS - المستخدمين المعلقين
// =====================================================

async function showSuspendedUsers() {
    // Create modal if not exists
    let modal = document.getElementById('modal-suspended');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-suspended';
        modal.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 9999; overflow-y: auto;';
        modal.innerHTML = `
            <div style="max-width: 900px; margin: 30px auto; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 20px; padding: 30px; border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
                    <h2 style="margin: 0; font-size: 24px; color: #f44336;">⏸️ المستخدمين المعلقين</h2>
                    <button onclick="closeSuspendedModal()" style="background: none; border: none; color: #888; font-size: 28px; cursor: pointer;">&times;</button>
                </div>
                <div style="background: linear-gradient(135deg, #4a1a1a 0%, #8b0000 100%); padding: 20px; border-radius: 12px; text-align: center; margin-bottom: 20px;">
                    <div style="font-size: 11px; color: #ccc;">إجمالي المعلقين</div>
                    <div id="suspended-count" style="font-size: 32px; font-weight: bold; color: #fff;">0</div>
                </div>
                <div id="suspended-list" style="background: rgba(255,255,255,0.03); border-radius: 12px; padding: 20px; max-height: 500px; overflow-y: auto;">
                    <div style="text-align: center; padding: 30px; color: #888;">⏳ جاري التحميل...</div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    modal.style.display = 'block';
    const list = document.getElementById('suspended-list');
    list.innerHTML = '<div style="text-align: center; padding: 30px; color: #888;">⏳ جاري التحميل...</div>';

    try {
        const [suspended, agencies] = await Promise.all([
            api.get('/suspended-users'),
            api.get('/agencies')
        ]);

        document.getElementById('suspended-count').textContent = suspended.count || 0;

        if (!suspended.users || suspended.users.length === 0) {
            list.innerHTML = `
                <div style="text-align: center; padding: 50px; background: rgba(76, 175, 80, 0.1); border-radius: 12px; border: 1px dashed #4caf50;">
                    <div style="font-size: 48px; margin-bottom: 15px;">✅</div>
                    <div style="color: #4caf50; font-size: 16px; font-weight: bold;">لا يوجد مستخدمين معلقين</div>
                </div>
            `;
            return;
        }

        const agencyOptions = agencies.map(a => `<option value="${a.name}">${a.name}</option>`).join('');

        // Global ref for bulk action
        window.currentSuspendedUsers = suspended.users;

        let html = `
            <div style="background: rgba(33, 150, 243, 0.1); padding: 15px; border-radius: 12px; margin-bottom: 20px; border: 1px dashed #2196F3; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                <div style="font-weight: bold; color: #fff;">⚡ تسوية جماعية (${suspended.users.length} مستخدم)</div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span style="color:#aaa; font-size:12px;">نقل الكل إلى:</span>
                    <select id="bulk-agency-select" style="padding: 8px; border-radius: 8px; background: #0b1021; color: #fff; border: 1px solid #444;">
                         <option value="">-- اختر الوكالة --</option>
                         ${agencyOptions}
                    </select>
                    <button onclick="resolveBulkSuspended()" style="background: #2196F3; color: white; border: none; padding: 8px 15px; border-radius: 8px; cursor: pointer;">تطبيق</button>
                </div>
            </div>
        `;
        for (const user of suspended.users) {
            const conflictBadges = (user.conflictAgencies || []).map(a =>
                `<span style="background: rgba(244,67,54,0.2); color: #f44336; padding: 2px 8px; border-radius: 5px; font-size: 12px; margin-left: 5px;">${a}</span>`
            ).join('');

            html += `
                <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                        <div>
                            <div style="font-size: 15px; font-weight: bold; color: #fff;">${user.name || user.id}</div>
                            <div style="font-size: 12px; color: #888; display: flex; align-items: center; gap: 5px; margin-bottom: 5px;">
                                ID: ${user.id}
                                <span onclick="navigator.clipboard.writeText('${user.id}').then(() => alert('تم النسخ: ${user.id}'))" 
                                      style="cursor: pointer; font-size: 14px; opacity: 0.7;" 
                                      title="نسخ ID">📋</span>
                            </div>
                            <div style="font-size: 13px; color: #ddd;">
                                الوكالة الحالية: <strong style="color: #4caf50;">${user.currentAgency || 'غير محدد'}</strong>
                            </div>
                        </div>
                        <div style="text-align: left;">
                            <div style="font-size: 12px; color: #aaa; margin-bottom: 4px;">الوكالات المتنازعة:</div>
                            <div style="display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end;">
                                ${conflictBadges || '<span style="color:#666;">لا يوجد</span>'}
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <select id="agency-select-${user.id}" style="flex: 1; padding: 8px; border-radius: 8px; background: #1a1a2e; color: #fff; border: 1px solid #444;">
                            <option value="">اختر الوكالة...</option>
                            ${agencyOptions}
                        </select>
                        <button onclick="confirmUserAgency('${user.id}')" style="background: #4caf50; color: white; border: none; padding: 8px 20px; border-radius: 8px; cursor: pointer;">✓ تأكيد</button>
                    </div>
                </div>
            `;
        }

        list.innerHTML = html;

    } catch (e) {
        console.error('Error loading suspended users:', e);
        list.innerHTML = `<div style="text-align: center; padding: 30px; color: #f44336;">❌ ${e.message}</div>`;
    }
}

function closeSuspendedModal() {
    const modal = document.getElementById('modal-suspended');
    if (modal) modal.style.display = 'none';
}

async function confirmUserAgency(userId) {
    const select = document.getElementById(`agency-select-${userId}`);
    const targetAgency = select?.value;

    if (!targetAgency) {
        alert('الرجاء اختيار الوكالة أولاً');
        return;
    }

    if (!confirm(`هل تريد تأكيد المستخدم ${userId} في وكالة "${targetAgency}"؟`)) {
        return;
    }

    try {
        const res = await api.post('/users/confirm-agency', { userId, targetAgency });
        alert(res.message);
        showSuspendedUsers(); // Refresh list
        refreshCurrentView(); // Refresh background
    } catch (e) {
        alert('خطأ: ' + e.message);
    }
}

async function resolveBulkSuspended() {
    const targetAgency = document.getElementById('bulk-agency-select').value;
    if (!targetAgency) return alert('يرجى اختيار وكالة للتطبيق على الجميع');

    const users = window.currentSuspendedUsers || [];
    if (users.length === 0) return alert('لا يوجد مستخدمين');

    if (!confirm(`⚠️ تحذير: هل أنت متأكد من نقل ${users.length} مستخدم معلق دفعة واحدة إلى وكالة "${targetAgency}"؟\n\nتأكد من اختيار الوكالة الصحيحة!`)) return;

    // Show Loading
    const btn = document.querySelector('button[onclick="resolveBulkSuspended()"]');
    const oldText = btn.textContent;
    btn.textContent = 'جاري...';
    btn.disabled = true;

    try {
        const userIds = users.map(u => u.id);
        const res = await api.post('/users/confirm-agency-bulk', { userIds, targetAgency });

        alert(res.message);
        showSuspendedUsers(); // Refresh
        refreshCurrentView();
    } catch (e) {
        alert('خطأ: ' + e.message);
    } finally {
        btn.textContent = oldText;
        btn.disabled = false;
    }
}



