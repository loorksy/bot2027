
// Minimal Accounting JS

let currentPeriodId = null;

// ================= API HELPERS =================
const api = {
    async get(endpoint) {
        const res = await fetch(`/api/accounting${endpoint}`);
        if (!res.ok) throw new Error(await res.text());
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
    async upload(endpoint, formData) {
        const res = await fetch(`/api/accounting${endpoint}`, {
            method: 'POST',
            body: formData
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }
};

// ================= NAVIGATION =================
function showDashboard() {
    document.getElementById('page-dashboard').style.display = 'block';
    document.getElementById('page-details').style.display = 'none';
    refreshCycles();
}

function openCreateModal() {
    document.getElementById('modal-create').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-create').style.display = 'none';
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

        // 2. Upload Soulchill
        if (fileSoulchill) {
            try {
                const fd = new FormData();
                fd.append('file', fileSoulchill);
                fd.append('periodId', id);
                await api.upload('/reports/import-soulchill', fd);
                msg += '\n✅ تم استيراد بيانات الإدارة';
            } catch (e) {
                msg += '\n❌ فشل استيراد الإدارة: ' + e.message;
            }
        }

        // 3. Upload Agent
        if (fileAgent) {
            try {
                const fd = new FormData();
                fd.append('file', fileAgent);
                fd.append('periodId', id);
                await api.upload('/reports/import-agent', fd);
                msg += '\n✅ تم استيراد بيانات الوكيل';
            } catch (e) {
                msg += '\n❌ فشل استيراد الوكيل: ' + e.message;
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
        allUsersCache = await api.get('/users');
        const users = allUsersCache.filter(u => getAgencyName(u) === 'Main');
        renderUsersTable(tbody, users);
    } catch (e) { tbody.innerHTML = `<tr><td colspan="5">${e.message}</td></tr>`; }
}

async function showSubAgencies() {
    hideAllPages();
    document.getElementById('page-sub-agencies').style.display = 'block';
    window.location.hash = '#sub-agencies';

    const grid = document.getElementById('agencies-grid');
    grid.innerHTML = '<p>جاري التحميل...</p>';

    try {
        allUsersCache = await api.get('/users');

        const agencies = new Set();
        allUsersCache.forEach(u => {
            const name = getAgencyName(u);
            if (name !== 'Main') agencies.add(name);
        });

        grid.innerHTML = '';
        if (agencies.size === 0) {
            grid.innerHTML = '<p class="text-center">لا توجد وكالات فرعية. قم بإنشاء واحدة.</p>';
        }

        agencies.forEach(ag => {
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

function openAgencyProfile(agencyName) {
    hideAllPages();
    document.getElementById('page-agency-profile').style.display = 'block';

    currentAgency = agencyName;
    document.getElementById('profile-agency-name').innerText = agencyName;

    const users = allUsersCache.filter(u => getAgencyName(u) === agencyName);
    document.getElementById('profile-user-count').innerText = users.length;

    const tbody = document.getElementById('profile-users-list');
    renderUsersTable(tbody, users);
}

function renderUsersTable(tbody, users) {
    tbody.innerHTML = '';
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">لا يوجد مستخدمين.</td></tr>';
        return;
    }

    users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${u.id}</td>
            <td>${u.name}</td>
            <td>${u.country || '-'}</td>
            <td>${u.phone || '-'}</td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="editUser('${u.id}')">✏</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function getAgencyName(u) {
    if (!u.agencyName || ['Soulchill', 'WhiteAgency', 'Main'].includes(u.agencyName)) return 'Main';
    return u.agencyName;
}

function openAddAgencyModal() {
    document.getElementById('modal-add-agency').style.display = 'flex';
}

function addAgency() {
    const name = document.getElementById('inp-agency-name').value;
    if (!name) return alert('أدخل الاسم');

    openAgencyProfile(name);
    closeModal('modal-add-agency');
}

function openAddUserModal(agency = null) {
    document.getElementById('inp-user-agency').value = agency || currentAgency;
    document.getElementById('modal-add-user').style.display = 'flex';
}

async function addUser() {
    const id = document.getElementById('inp-user-id').value;
    const name = document.getElementById('inp-user-name').value;
    const country = document.getElementById('inp-user-country').value;
    const agency = document.getElementById('inp-user-agency').value;

    if (!id || !name) return alert('البيانات ناقصة');

    try {
        await api.post('/users', {
            id, name, country, agencyName: agency, type: 'Host'
        });
        alert('تمت الإضافة');
        closeModal('modal-add-user');

        if (currentAgency === 'Main') showMainAgency();
        else openAgencyProfile(currentAgency);

    } catch (e) { alert(e.message); }
}

function deleteAgency() {
    if (!confirm('هل أنت متأكد؟ (Visual Only)')) return;
    showSubAgencies();
}

// ================= IMPORT USERS =================
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
        alert(`تم التحديث بنجاح!\nجديد: ${res.newUsers}\nتحديث: ${res.updatedUsers}`);
        closeModalUsers();

        // Refresh Lists if we are on Agencies page
        if (document.getElementById('page-sub-agencies').style.display === 'block') {
            showSubAgencies();
        } else if (document.getElementById('page-main-agency').style.display === 'block') {
            showMainAgency();
        } else if (document.getElementById('page-agency-profile').style.display === 'block') {
            openAgencyProfile(currentAgency);
        }

    } catch (err) {
        alert('خطأ: ' + err.message);
    } finally {
        btn.textContent = oldText;
        btn.disabled = false;
    }
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
    // If we have a hash, respect it.
    if (window.location.hash) handleHashChange();
    else refreshCycles();

    // Listen
    window.addEventListener('hashchange', handleHashChange);
});
