// =====================================================
// NAVIGATION
// =====================================================
window.switchTab = function(tabId) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.menu-drawer-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  
  document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(el => el.classList.add('active'));
  document.getElementById(tabId)?.classList.add('active');
  
  closeMenuDrawer();
};

document.querySelectorAll('.nav-item, .bottom-nav-item, .menu-drawer-item').forEach(item => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    if (tab) switchTab(tab);
  });
});

function openMenuDrawer() {
  document.getElementById('menuDrawer').classList.add('active');
}

function closeMenuDrawer() {
  document.getElementById('menuDrawer').classList.remove('active');
}

// =====================================================
// UTILITIES
// =====================================================
function showAlert(message, type = 'success') {
  const container = document.getElementById('alertContainer');
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  setTimeout(() => container.innerHTML = '', 4000);
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

async function aiApi(method, url, data = null) {
  const options = { method, credentials: 'include' };
  if (data && !(data instanceof FormData)) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(data);
  } else if (data) {
    options.body = data;
  }
  const res = await fetch(url, options);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Unknown error');
  return json;
}

// =====================================================
// SETTINGS
// =====================================================
async function loadAiSettings() {
      try {
        const settings = await aiApi('GET', '/api/ai/settings');
    document.getElementById('aiEnabled').checked = settings.enabled;
    document.getElementById('openaiKey').value = settings.openaiKey || '';
    document.getElementById('modelChat').value = settings.modelChat || 'gpt-4o-mini';
    document.getElementById('modelStt').value = settings.modelStt || 'whisper-1';
    document.getElementById('modelTts').value = settings.modelTts || 'tts-1';
    document.getElementById('voiceTts').value = settings.voiceTts || 'alloy';
    document.getElementById('trustedSessionMinutes').value = settings.trustedSessionMinutes || 15;
    document.getElementById('agencyPercent').value = settings.agencyPercent || 0;
    document.getElementById('botName').value = settings.botName || 'مساعد أبو سلطان';
    document.getElementById('ownerName').value = settings.ownerName || 'أبو سلطان';
    document.getElementById('dialect').value = settings.dialect || 'سورية';
    document.getElementById('clientGender').value = settings.clientGender || 'مؤنث';
    document.getElementById('friendliness').value = settings.friendliness || 'عالي';
    document.getElementById('salaryCurrency').value = settings.salaryCurrency || 'ر.س';
    document.getElementById('adminContact').value = settings.adminContact || 'تواصلي مع الإدارة';
    document.getElementById('enableVoiceReplies').checked = settings.enableVoiceReplies || false;
    
    // Google Sheet Sync settings
    document.getElementById('googleSheetAutoSync').checked = settings.googleSheetAutoSync || false;
    document.getElementById('googleSheetUrlAuto').value = settings.googleSheetUrlAuto || '';
    document.getElementById('googleSheetNameAuto').value = settings.googleSheetNameAuto || '';
    document.getElementById('googleSheetSyncInterval').value = settings.googleSheetSyncInterval || '5';
    
    // Update sync status text
    if (settings.googleSheetAutoSync && settings.googleSheetUrlAuto) {
      document.getElementById('syncStatusText').textContent = '🟢 مفعّلة';
      document.getElementById('syncStatusText').style.color = 'var(--primary)';
    } else {
      document.getElementById('syncStatusText').textContent = 'غير مفعّلة';
      document.getElementById('syncStatusText').style.color = 'var(--text-muted)';
    }
    
    // Toggle visibility
    if (settings.googleSheetAutoSync) {
      document.getElementById('autoSyncSettings').style.display = 'block';
    } else {
      document.getElementById('autoSyncSettings').style.display = 'none';
    }
    
    // AI Provider
    const provider = settings.aiProvider || 'openai';
    document.getElementById('aiProvider').value = provider;
    toggleAIProvider(provider);
    
    if (settings.openrouterKey) {
      document.getElementById('openrouterKey').value = settings.openrouterKey;
    }
    if (settings.openrouterModel) {
      document.getElementById('openrouterModel').value = settings.openrouterModel;
    }
  } catch (err) {
    showAlert('فشل تحميل الإعدادات: ' + err.message, 'error');
  }
}

function toggleAIProvider(provider) {
  document.getElementById('openaiSettings').classList.toggle('hidden', provider !== 'openai');
  document.getElementById('openrouterSettings').classList.toggle('hidden', provider !== 'openrouter');
}

document.getElementById('aiProvider').addEventListener('change', (e) => {
  toggleAIProvider(e.target.value);
});

// Toggle Auto Sync Settings
window.toggleAutoSyncSettings = function() {
  const enabled = document.getElementById('googleSheetAutoSync').checked;
  const settingsDiv = document.getElementById('autoSyncSettings');
  const statusText = document.getElementById('syncStatusText');
  
  if (enabled) {
    settingsDiv.style.display = 'block';
  } else {
    settingsDiv.style.display = 'none';
    statusText.textContent = 'غير مفعّلة';
    statusText.style.color = 'var(--text-muted)';
  }
};

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  try {
    const provider = document.getElementById('aiProvider').value;
    const data = {
      enabled: document.getElementById('aiEnabled').checked,
      aiProvider: provider,
      modelChat: document.getElementById('modelChat').value,
      modelStt: document.getElementById('modelStt').value,
      modelTts: document.getElementById('modelTts').value,
      voiceTts: document.getElementById('voiceTts').value,
      trustedSessionMinutes: parseInt(document.getElementById('trustedSessionMinutes').value) || 15,
      agencyPercent: parseFloat(document.getElementById('agencyPercent').value) || 0,
      botName: document.getElementById('botName').value,
      ownerName: document.getElementById('ownerName').value,
      dialect: document.getElementById('dialect').value,
      clientGender: document.getElementById('clientGender').value,
      friendliness: document.getElementById('friendliness').value,
      salaryCurrency: document.getElementById('salaryCurrency').value,
      adminContact: document.getElementById('adminContact').value,
      enableVoiceReplies: document.getElementById('enableVoiceReplies').checked,
      googleSheetAutoSync: document.getElementById('googleSheetAutoSync').checked,
      googleSheetUrlAuto: document.getElementById('googleSheetUrlAuto').value,
      googleSheetNameAuto: document.getElementById('googleSheetNameAuto').value,
      googleSheetSyncInterval: parseInt(document.getElementById('googleSheetSyncInterval').value) || 5
    };

    const openaiKey = document.getElementById('openaiKey').value;
    if (openaiKey && !openaiKey.includes('•')) {
      data.openaiKey = openaiKey;
    }

    const openrouterKey = document.getElementById('openrouterKey').value;
    if (openrouterKey && !openrouterKey.includes('•')) {
      data.openrouterKey = openrouterKey;
    }
    
    data.openrouterModel = document.getElementById('openrouterModel').value;

    await aiApi('POST', '/api/ai/settings', data);
    
    // Update sync status display after save
    const syncStatusText = document.getElementById('syncStatusText');
    if (data.googleSheetAutoSync && data.googleSheetUrlAuto) {
      syncStatusText.textContent = '🟢 مفعّلة';
      syncStatusText.style.color = 'var(--primary)';
    } else {
      syncStatusText.textContent = 'غير مفعّلة';
      syncStatusText.style.color = 'var(--text-muted)';
    }
    
    showAlert('تم حفظ الإعدادات بنجاح ✅');
  } catch (err) {
    showAlert('فشل حفظ الإعدادات: ' + err.message, 'error');
  }
});

// =====================================================
// SALARY UPLOAD
// =====================================================
const fileUploadArea = document.getElementById('fileUploadArea');
const salaryFileInput = document.getElementById('salaryFile');
let uploadedFileData = null;

fileUploadArea.addEventListener('click', () => salaryFileInput.click());
fileUploadArea.addEventListener('dragover', e => { e.preventDefault(); fileUploadArea.classList.add('dragover'); });
fileUploadArea.addEventListener('dragleave', () => fileUploadArea.classList.remove('dragover'));
fileUploadArea.addEventListener('drop', e => {
  e.preventDefault();
  fileUploadArea.classList.remove('dragover');
  if (e.dataTransfer.files.length) {
    salaryFileInput.files = e.dataTransfer.files;
    handleFileSelect(e.dataTransfer.files[0]);
  }
});

salaryFileInput.addEventListener('change', e => {
  if (e.target.files.length) handleFileSelect(e.target.files[0]);
});

async function handleFileSelect(file) {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const preview = await aiApi('POST', '/api/ai/salary/upload/preview', formData);
    uploadedFileData = { file, preview };

    const idCol = document.getElementById('idColumn');
    const salaryCol = document.getElementById('salaryColumn');
    idCol.innerHTML = '';
    salaryCol.innerHTML = '';

    preview.columns.forEach(col => {
      idCol.innerHTML += `<option value="${col}">${col}</option>`;
      salaryCol.innerHTML += `<option value="${col}">${col}</option>`;
    });

    // Show preview table
    let tableHtml = '<table class="data-table"><thead><tr>';
    preview.columns.forEach(col => tableHtml += `<th>${col}</th>`);
    tableHtml += '</tr></thead><tbody>';
    preview.preview.slice(0, 5).forEach(row => {
      tableHtml += '<tr>';
      preview.columns.forEach(col => tableHtml += `<td>${row[col] || ''}</td>`);
      tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';
    document.getElementById('previewTable').innerHTML = tableHtml;

    document.getElementById('uploadPreview').classList.remove('hidden');
    fileUploadArea.classList.add('hidden');
  } catch (err) {
    showAlert('فشل معاينة الملف: ' + err.message, 'error');
  }
}

document.getElementById('cancelUploadBtn').addEventListener('click', () => {
  uploadedFileData = null;
  document.getElementById('uploadPreview').classList.add('hidden');
  fileUploadArea.classList.remove('hidden');
  salaryFileInput.value = '';
});

document.getElementById('uploadBtn').addEventListener('click', async () => {
  if (!uploadedFileData) return;

  try {
    const formData = new FormData();
    formData.append('file', uploadedFileData.file);
    formData.append('name', document.getElementById('periodName').value);
    formData.append('idColumn', document.getElementById('idColumn').value);
    formData.append('salaryColumn', document.getElementById('salaryColumn').value);
    formData.append('agencyPercent', document.getElementById('uploadAgencyPercent').value);

    const result = await aiApi('POST', '/api/ai/salary/upload', formData);
    showAlert(`تم رفع الملف بنجاح! (${result.period.recordCount} سجل)${result.notifiedClients ? ` - تم إشعار ${result.notifiedClients} عميل` : ''}`);
    
    uploadedFileData = null;
    document.getElementById('uploadPreview').classList.add('hidden');
    fileUploadArea.classList.remove('hidden');
    salaryFileInput.value = '';
    loadPeriods();
  } catch (err) {
    showAlert('فشل رفع الملف: ' + err.message, 'error');
  }
});

async function loadPeriods() {
  try {
    const periods = await aiApi('GET', '/api/ai/salary/periods');
    const container = document.getElementById('periodsList');
    
    if (!periods.length) {
      container.innerHTML = '<div class="empty-state"><p>لا توجد فترات رواتب</p></div>';
      return;
    }

    container.innerHTML = periods.map(p => `
      <div class="period-card ${p.isCurrent ? 'current' : ''}">
        <div class="period-info">
          <h4>${p.name} ${p.isCurrent ? '<span class="badge badge-success">الحالية</span>' : ''}</h4>
          <div class="period-meta">${p.recordCount} سجل • خصم ${p.agencyPercent}%</div>
        </div>
        <div style="display: flex; gap: 6px;">
          ${!p.isCurrent ? `<button class="btn btn-sm btn-secondary" onclick="setCurrentPeriod('${p.id}')">تعيين كحالية</button>` : ''}
          <button class="btn btn-sm btn-danger" onclick="deletePeriod('${p.id}')">حذف</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    showAlert('فشل تحميل الفترات: ' + err.message, 'error');
  }
}

window.setCurrentPeriod = async function(id) {
  try {
    await aiApi('POST', `/api/ai/salary/period/${id}/current`);
    showAlert('تم تعيين الفترة الحالية');
    loadPeriods();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

window.deletePeriod = async function(id) {
  if (!confirm('هل أنت متأكد من حذف هذه الفترة؟')) return;
  try {
    await aiApi('DELETE', `/api/ai/salary/period/${id}`);
    showAlert('تم حذف الفترة');
    loadPeriods();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

// =====================================================
// REGISTERED CLIENTS
// =====================================================
let allClientsData = [];

async function loadRegisteredClients() {
  try {
    const clients = await aiApi('GET', '/api/ai/registered-clients');
    allClientsData = Object.entries(clients).map(([key, c]) => ({ key, ...c }));
    renderClientsTable(allClientsData);
    
    // Stats
    document.getElementById('clientsStats').innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${allClientsData.length}</div>
        <div class="stat-label">إجمالي العملاء</div>
      </div>
    `;
  } catch (err) {
    showAlert('فشل تحميل العملاء: ' + err.message, 'error');
  }
}

function renderClientsTable(clients) {
  // Desktop table
  const tbody = document.querySelector('#registeredClientsTable tbody');
  tbody.innerHTML = clients.map(c => `
    <tr>
      <td>${c.fullName || '-'}</td>
      <td>${(c.ids || []).join(', ')}</td>
      <td>${c.phone || '-'}</td>
      <td>${c.agencyName || '-'}</td>
      <td>
        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
          <button class="btn btn-sm btn-secondary" onclick="editClient('${c.key}')">تعديل</button>
          <button class="btn btn-sm btn-secondary" onclick="openReceiptsModal('${c.key}', '${c.fullName}')">إيصالات</button>
          <button class="btn btn-sm btn-secondary" onclick="promptNotify('${c.key}', '${c.fullName}', '${c.phone}')">إشعار</button>
          <button class="btn btn-sm btn-danger" onclick="deleteClient('${c.key}')">حذف</button>
        </div>
      </td>
    </tr>
  `).join('');

  // Mobile cards
  document.getElementById('registeredClientsMobile').innerHTML = clients.map(c => `
    <div class="mobile-card">
      <div class="mobile-card-header">
        <div class="mobile-card-title">${c.fullName || '-'}</div>
        <span class="badge badge-info">${c.agencyName || '-'}</span>
      </div>
      <div class="mobile-card-row">
        <span class="mobile-card-label">IDs</span>
        <span class="mobile-card-value">${(c.ids || []).join(', ')}</span>
      </div>
      <div class="mobile-card-row">
        <span class="mobile-card-label">الهاتف</span>
        <span class="mobile-card-value">${c.phone || '-'}</span>
      </div>
      <div class="mobile-card-actions">
        <button class="btn btn-sm btn-secondary" onclick="editClient('${c.key}')" style="flex: 1;">تعديل</button>
        <button class="btn btn-sm btn-secondary" onclick="openReceiptsModal('${c.key}', '${c.fullName}')" style="flex: 1;">إيصالات</button>
        <button class="btn btn-sm btn-secondary" onclick="promptNotify('${c.key}', '${c.fullName}', '${c.phone}')" style="flex: 1;">إشعار</button>
        <button class="btn btn-sm btn-danger" onclick="deleteClient('${c.key}')">حذف</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('searchRegClientInput').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) {
    renderClientsTable(allClientsData);
    return;
  }
  
  const filtered = allClientsData.filter(c => 
    (c.fullName || '').toLowerCase().includes(q) ||
    (c.ids || []).some(id => id.toString().includes(q)) ||
    (c.phone || '').includes(q)
  );
  renderClientsTable(filtered);
  
  // Smart search: If only one result found, auto-open receipts modal
  if (filtered.length === 1) {
    const client = filtered[0];
    openReceiptsModal(client.key, client.fullName || 'عميل');
  }
});

document.getElementById('refreshRegClientsBtn').addEventListener('click', loadRegisteredClients);

// Client Modal
let editingClientKey = null;

document.getElementById('addRegClientBtn').addEventListener('click', () => {
  editingClientKey = null;
  document.getElementById('clientModalTitle').textContent = 'إضافة عميل جديد';
  clearClientForm();
  document.getElementById('clientModal').classList.add('active');
  renderCustomFieldsInForm();
});

function closeClientModal() {
  document.getElementById('clientModal').classList.remove('active');
}

function clearClientForm() {
  document.getElementById('editingClientKey').value = '';
  document.getElementById('regFullName').value = '';
  document.getElementById('regIds').value = '';
  document.getElementById('regPhone').value = '';
  document.getElementById('regWhatsapp').value = '';
  document.getElementById('regAddress').value = '';
}

document.getElementById('clearRegFormBtn').addEventListener('click', clearClientForm);

window.editClient = async function(key) {
  const client = allClientsData.find(c => c.key === key);
  if (!client) return;
  
  editingClientKey = key;
  document.getElementById('clientModalTitle').textContent = 'تعديل بيانات العميل';
  document.getElementById('editingClientKey').value = key;
  document.getElementById('regFullName').value = client.fullName || '';
  document.getElementById('regIds').value = (client.ids || []).join(', ');
  document.getElementById('regPhone').value = client.phone || '';
  document.getElementById('regWhatsapp').value = client.whatsappPhone || '';
  document.getElementById('regCountry').value = client.country || '';
  document.getElementById('regCity').value = client.city || '';
  document.getElementById('regAddress').value = client.address || '';
  document.getElementById('regAgency').value = client.agencyName || '';
  
  await renderCustomFieldsInForm();
  
  // Fill custom fields
  const customFields = client.customFields || {};
  Object.entries(customFields).forEach(([key, value]) => {
    const input = document.getElementById(`custom_${key}`);
    if (input) input.value = value || '';
  });
  
  document.getElementById('clientModal').classList.add('active');
};

document.getElementById('saveClientBtn').addEventListener('click', async () => {
  try {
    const ids = document.getElementById('regIds').value.split(',').map(id => id.trim()).filter(Boolean);
    if (!ids.length) {
      showAlert('يرجى إدخال رقم ID واحد على الأقل', 'error');
      return;
    }

    const data = {
      fullName: document.getElementById('regFullName').value,
      ids,
      phone: document.getElementById('regPhone').value,
      whatsappPhone: document.getElementById('regWhatsapp').value,
      country: document.getElementById('regCountry').value,
      city: document.getElementById('regCity').value,
      address: document.getElementById('regAddress').value,
      agencyName: document.getElementById('regAgency').value,
      customFields: {}
    };

    // Get custom fields
    document.querySelectorAll('[id^="custom_"]').forEach(input => {
      const key = input.id.replace('custom_', '');
      data.customFields[key] = input.value;
    });

    if (editingClientKey) {
      await aiApi('PUT', `/api/ai/registered-clients/${editingClientKey}`, data);
      showAlert('تم تحديث بيانات العميل');
    } else {
      await aiApi('POST', '/api/ai/registered-clients', data);
      showAlert('تم إضافة العميل بنجاح');
    }

    closeClientModal();
    loadRegisteredClients();
  } catch (err) {
    showAlert(err.message, 'error');
  }
});

window.deleteClient = async function(key) {
  if (!confirm('هل أنت متأكد من حذف هذا العميل؟')) return;
  try {
    await aiApi('DELETE', `/api/ai/registered-clients/${key}`);
    showAlert('تم حذف العميل');
    loadRegisteredClients();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

// =====================================================
// LINKED CLIENTS
// =====================================================
async function loadLinkedClients() {
  try {
    const result = await aiApi('GET', '/api/ai/clients');
    const tbody = document.querySelector('#linkedClientsTable tbody');
    const mobile = document.getElementById('linkedClientsMobile');
    
    // Convert object to array if needed
    let clients = Array.isArray(result) ? result : Object.entries(result).map(([id, data]) => ({
      whatsappId: id,
      phone: data.profile?.phone || id.replace('@lid', ''),
      name: data.profile?.fullName || data.name || 'عميل',
      status: data.status,
      lastSeen: data.lastActivity
    }));
    
    if (!clients.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">لا يوجد عملاء مربوطين</td></tr>';
      mobile.innerHTML = '<div class="empty-state"><p>لا يوجد عملاء مربوطين</p></div>';
      return;
    }

    tbody.innerHTML = clients.map(c => `
      <tr>
        <td>${c.phone || c.whatsappId || '-'}</td>
        <td>${c.name || '-'}</td>
        <td><span class="badge badge-${c.status === 'complete' ? 'success' : 'warning'}">${c.status === 'complete' ? 'مكتمل' : 'قيد التسجيل'}</span></td>
        <td>${c.lastSeen ? new Date(c.lastSeen).toLocaleString('ar') : '-'}</td>
      </tr>
    `).join('');

    mobile.innerHTML = clients.map(c => `
      <div class="mobile-card">
        <div class="mobile-card-header">
          <div class="mobile-card-title">${c.name || c.phone || 'عميل'}</div>
          <span class="badge badge-${c.status === 'complete' ? 'success' : 'warning'}">${c.status === 'complete' ? 'مكتمل' : 'قيد التسجيل'}</span>
        </div>
        <div class="mobile-card-row">
          <span class="mobile-card-label">واتساب</span>
          <span class="mobile-card-value">${c.phone || c.whatsappId || '-'}</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load linked clients:', err);
  }
}

document.getElementById('refreshLinkedClientsBtn').addEventListener('click', loadLinkedClients);

// =====================================================
// CHATS
// =====================================================
let currentChatClientKey = null;
let chatRefreshInterval = null;

async function loadChats() {
  try {
    const result = await aiApi('GET', '/api/ai/chats');
    const container = document.getElementById('chatsList');
    
    // Handle both formats: {chats: [...]} or direct object
    let chatsData = result.chats || result;
    if (Array.isArray(chatsData)) {
      // Convert array to object format
      const chatsObj = {};
      chatsData.forEach(chat => {
        chatsObj[chat.clientKey] = chat;
      });
      chatsData = chatsObj;
    }
    
    let unreadTotal = 0;
    const chatEntries = Object.entries(chatsData);
    
    if (!chatEntries.length) {
      container.innerHTML = '<div class="empty-state"><p>لا توجد محادثات</p></div>';
      updateChatBadge(0);
      return;
    }

    container.innerHTML = chatEntries.map(([clientKey, chat]) => {
      const lastMsg = chat.messages?.[chat.messages.length - 1];
      const isUnread = chat.unread;
      if (isUnread) unreadTotal++;
      
      return `
        <div class="chat-item ${isUnread ? 'unread' : ''}" onclick="openChat('${clientKey}', '${chat.clientName || 'عميل'}')">
          <div class="chat-avatar">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div class="chat-info">
            <div class="chat-name">${chat.clientName || 'عميل'}</div>
            <div class="chat-preview">${lastMsg?.message || ''}</div>
          </div>
          ${isUnread ? '<div class="badge badge-danger" style="width: 8px; height: 8px; padding: 0; border-radius: 50%;"></div>' : ''}
        </div>
      `;
    }).join('');

    updateChatBadge(unreadTotal);
  } catch (err) {
    console.error('Failed to load chats:', err);
  }
}

function updateChatBadge(count) {
  const desktopBadge = document.getElementById('chatsBadge');
  const mobileBadge = document.getElementById('mobileChatsBadge');
  
  if (count > 0) {
    desktopBadge.textContent = count;
    desktopBadge.classList.remove('hidden');
    mobileBadge.textContent = count;
    mobileBadge.classList.remove('hidden');
  } else {
    desktopBadge.classList.add('hidden');
    mobileBadge.classList.add('hidden');
  }
}

window.openChat = async function(clientKey, clientName) {
  currentChatClientKey = clientKey;
  document.getElementById('currentChatTitle').textContent = clientName;
  await loadChatMessages(clientKey);
  
  // Mark as read
  try {
    await aiApi('POST', `/api/ai/chats/${clientKey}/read`);
    loadChats();
  } catch {}
};

async function loadChatMessages(clientKey) {
  try {
    const result = await aiApi('GET', `/api/ai/chats/${clientKey}/messages`);
    const container = document.getElementById('chatMessagesContainer');
    
    if (!result.messages?.length) {
      container.innerHTML = '<div class="empty-state"><p>لا توجد رسائل</p></div>';
      return;
    }

    container.innerHTML = result.messages.map(m => {
      const time = new Date(m.timestamp).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="chat-bubble ${m.sender}">
          ${m.message}
          <div class="chat-bubble-time">${time}</div>
        </div>
      `;
    }).join('');

    container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

window.sendAdminChatMessage = async function() {
  const input = document.getElementById('adminChatInput');
  const message = input.value.trim();
  if (!message || !currentChatClientKey) return;

  try {
    input.disabled = true;
    await aiApi('POST', `/api/ai/chats/${currentChatClientKey}/messages`, { message });
    input.value = '';
    await loadChatMessages(currentChatClientKey);
  } catch (err) {
    showAlert('فشل إرسال الرسالة', 'error');
  } finally {
    input.disabled = false;
    input.focus();
  }
};

document.getElementById('adminChatInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendAdminChatMessage();
});

// =====================================================
// NOTIFICATIONS
// =====================================================
async function loadNotifications() {
  try {
    const notifications = await aiApi('GET', '/api/ai/notifications');
    const container = document.getElementById('notificationsList');
    
    if (!notifications.length) {
      container.innerHTML = '<div class="empty-state"><p>لا توجد إشعارات</p></div>';
      return;
    }

    container.innerHTML = notifications.slice(0, 20).map(n => `
      <div class="ticket-item">
        <div class="ticket-header">
          <span class="ticket-subject">${n.title}</span>
          <span class="badge badge-${n.type === 'success' ? 'success' : n.type === 'warning' ? 'warning' : 'info'}">${n.type}</span>
        </div>
        <div class="ticket-message">${n.message}</div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 10px; color: var(--text-dim);">${new Date(n.createdAt).toLocaleString('ar')}</span>
          <button class="btn btn-sm btn-danger" onclick="deleteNotification('${n.id}')">حذف</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    showAlert('فشل تحميل الإشعارات', 'error');
  }
}

window.deleteNotification = async function(id) {
  try {
    await aiApi('DELETE', `/api/ai/notifications/${id}`);
    loadNotifications();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

document.getElementById('notificationForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await aiApi('POST', '/api/ai/notifications', {
      title: document.getElementById('notifTitle').value,
      message: document.getElementById('notifMessage').value,
      type: document.getElementById('notifType').value,
      targetClients: [document.getElementById('notifTarget').value]
    });
    showAlert('تم إرسال الإشعار');
    e.target.reset();
    loadNotifications();
  } catch (err) {
    showAlert(err.message, 'error');
  }
});

async function loadNotificationTargets() {
  try {
    const clients = await aiApi('GET', '/api/ai/registered-clients');
    const select = document.getElementById('notifTarget');
    select.innerHTML = '<option value="all">جميع العملاء</option>';
    Object.entries(clients).forEach(([key, c]) => {
      select.innerHTML += `<option value="${key}">${c.fullName}</option>`;
    });
  } catch {}
}

// =====================================================
// TICKETS
// =====================================================
async function loadTickets() {
  try {
    const result = await aiApi('GET', '/api/ai/tickets');
    const tickets = result.tickets || [];
    const container = document.getElementById('ticketsList');
    
    const openCount = tickets.filter(t => t.status === 'open').length;
    document.getElementById('ticketsStats').innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${tickets.length}</div>
        <div class="stat-label">إجمالي التذاكر</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: var(--warning);">${openCount}</div>
        <div class="stat-label">مفتوحة</div>
      </div>
    `;
    
    // Update badge
    const badge = document.getElementById('ticketsBadge');
    if (openCount > 0) {
      badge.textContent = openCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    if (!tickets.length) {
      container.innerHTML = '<div class="empty-state"><p>لا توجد تذاكر</p></div>';
      return;
    }

    container.innerHTML = tickets.map(t => {
      const clientInfoHtml = t.clientInfo ? `
        <div style="background: var(--bg); padding: 8px; border-radius: 6px; margin: 8px 0; font-size: 11px;">
          <div style="color: var(--text-muted); margin-bottom: 4px;">📋 معلومات العميل:</div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;">
            ${t.clientInfo.fullName ? `<div><span style="color: var(--text-dim);">الاسم:</span> ${t.clientInfo.fullName}</div>` : ''}
            ${t.clientInfo.phone ? `<div><span style="color: var(--text-dim);">الهاتف:</span> ${t.clientInfo.phone}</div>` : ''}
            ${t.clientInfo.ids?.length ? `<div><span style="color: var(--text-dim);">IDs:</span> ${t.clientInfo.ids.join(', ')}</div>` : ''}
            ${t.clientInfo.agencyName ? `<div><span style="color: var(--text-dim);">الوكالة:</span> ${t.clientInfo.agencyName}</div>` : ''}
          </div>
        </div>
      ` : '';
      
      const messagesHtml = t.recentMessages?.length ? `
        <details style="margin-top: 8px;">
          <summary style="cursor: pointer; color: var(--primary); font-size: 11px; margin-bottom: 4px;">
            💬 آخر ${t.recentMessages.length} رسالة
          </summary>
          <div style="background: var(--bg); padding: 8px; border-radius: 6px; max-height: 200px; overflow-y: auto; font-size: 10px;">
            ${t.recentMessages.map(m => `
              <div style="margin-bottom: 6px; padding: 6px; background: var(--surface-2); border-radius: 4px;">
                <div style="color: ${m.sender === 'client' ? 'var(--primary)' : 'var(--warning)'}; font-weight: 600;">
                  ${m.sender === 'client' ? 'عميل' : 'إدارة'}
                </div>
                <div style="color: var(--text);">${m.message}</div>
                <div style="color: var(--text-dim); font-size: 9px; margin-top: 2px;">
                  ${new Date(m.timestamp).toLocaleString('ar', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            `).join('')}
          </div>
        </details>
      ` : '';
      
      return `
        <div class="ticket-item">
          <div class="ticket-header">
            <span class="ticket-subject">${t.subject}</span>
            <span class="badge badge-${t.status === 'open' ? 'warning' : t.status === 'resolved' ? 'success' : 'info'}">${t.status === 'open' ? 'مفتوحة' : t.status === 'resolved' ? 'محلولة' : 'مغلقة'}</span>
          </div>
          <div class="ticket-message">${t.message}</div>
          ${clientInfoHtml}
          ${messagesHtml}
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <span style="font-size: 10px; color: var(--text-dim);">${new Date(t.createdAt).toLocaleString('ar')}</span>
            <div style="display: flex; gap: 4px;">
              ${t.status === 'open' ? `<button class="btn btn-sm btn-primary" onclick="updateTicketStatus('${t.id}', 'resolved')">حل</button>` : ''}
              <button class="btn btn-sm btn-danger" onclick="deleteTicket('${t.id}')">حذف</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    showAlert('فشل تحميل التذاكر', 'error');
  }
}

window.updateTicketStatus = async function(id, status) {
  try {
    await aiApi('PUT', `/api/ai/tickets/${id}/status`, { status });
    showAlert('تم تحديث حالة التذكرة');
    loadTickets();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

window.deleteTicket = async function(id) {
  if (!confirm('حذف هذه التذكرة؟')) return;
  try {
    await aiApi('DELETE', `/api/ai/tickets/${id}`);
    loadTickets();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

// =====================================================
// KNOWLEDGE BASE
// =====================================================
async function loadKnowledge() {
  try {
    const result = await aiApi('GET', '/api/ai/knowledge');
    const items = result.knowledge || result || [];
    const container = document.getElementById('knowledgeList');
    
    if (!items.length) {
      container.innerHTML = '<div class="empty-state"><p>لا توجد أسئلة في قاعدة المعرفة</p></div>';
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="knowledge-item ${!item.active ? 'inactive' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
          <div class="knowledge-question">${item.question}</div>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-sm btn-secondary" onclick="toggleKnowledge('${item.id}', ${!item.active})">${item.active !== false ? 'تعطيل' : 'تفعيل'}</button>
            <button class="btn btn-sm btn-danger" onclick="deleteKnowledge('${item.id}')">حذف</button>
          </div>
        </div>
        <div class="knowledge-answer">${item.answer}</div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load knowledge:', err);
  }
}

window.toggleKnowledge = async function(id, active) {
  try {
    await aiApi('PUT', `/api/ai/knowledge/${id}`, { active });
    loadKnowledge();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

window.deleteKnowledge = async function(id) {
  if (!confirm('حذف هذا السؤال؟')) return;
  try {
    await aiApi('DELETE', `/api/ai/knowledge/${id}`);
    loadKnowledge();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

window.resetKnowledge = async function() {
  if (!confirm('إعادة تعيين قاعدة المعرفة للأسئلة الافتراضية؟')) return;
  try {
    await aiApi('POST', '/api/ai/knowledge/reset');
    showAlert('تم إعادة التعيين');
    loadKnowledge();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

document.getElementById('knowledgeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await aiApi('POST', '/api/ai/knowledge', {
      question: document.getElementById('kbQuestion').value,
      answer: document.getElementById('kbAnswer').value,
      keywords: document.getElementById('kbKeywords').value.split(',').map(k => k.trim()).filter(Boolean)
    });
    showAlert('تم إضافة السؤال');
    e.target.reset();
    loadKnowledge();
  } catch (err) {
    showAlert(err.message, 'error');
  }
});

// =====================================================
// USAGE
// =====================================================
async function loadUsage() {
  try {
    const usage = await aiApi('GET', '/api/ai/usage');
    
    // Handle different response formats
    const totalTokens = (usage.totalInputTokens || 0) + (usage.totalOutputTokens || 0) || usage.totalTokens || 0;
    const totalCost = usage.estimatedCost || usage.totalCost || 0;
    const requestCount = (usage.totalChatCalls || 0) + (usage.totalSttCalls || 0) + (usage.totalTtsCalls || 0) || usage.requestCount || 0;
    
    document.getElementById('usageStats').innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${totalTokens.toLocaleString()}</div>
        <div class="stat-label">إجمالي التوكنات</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">$${totalCost.toFixed(4)}</div>
        <div class="stat-label">التكلفة الإجمالية</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${requestCount}</div>
        <div class="stat-label">عدد الطلبات</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${usage.totalChatCalls || 0}</div>
        <div class="stat-label">محادثات AI</div>
      </div>
    `;

    const tbody = document.querySelector('#usageTable tbody');
    const logs = usage.logs || [];
    if (!logs.length) {
      tbody.innerHTML = `
        <tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">
          <strong>ملخص الاستهلاك:</strong><br>
          محادثات: ${usage.totalChatCalls || 0}<br>
          توكنات الإدخال: ${(usage.totalInputTokens || 0).toLocaleString()}<br>
          توكنات الإخراج: ${(usage.totalOutputTokens || 0).toLocaleString()}
        </td></tr>
      `;
      return;
    }

    tbody.innerHTML = logs.slice(0, 50).map(log => `
      <tr>
        <td>${new Date(log.timestamp).toLocaleString('ar')}</td>
        <td>${log.type || 'chat'}</td>
        <td>${log.tokens || 0}</td>
        <td>$${(log.cost || 0).toFixed(6)}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load usage:', err);
  }
}

document.getElementById('refreshUsageBtn').addEventListener('click', loadUsage);
document.getElementById('resetUsageBtn').addEventListener('click', async () => {
  if (!confirm('إعادة تعيين سجل الاستهلاك؟')) return;
  try {
    await aiApi('POST', '/api/ai/usage/reset');
    showAlert('تم إعادة التعيين');
    loadUsage();
  } catch (err) {
    showAlert(err.message, 'error');
  }
});

// =====================================================
// CUSTOM FIELDS
// =====================================================
let editingFieldId = null;

async function loadCustomFields() {
  try {
    const fields = await aiApi('GET', '/api/ai/custom-fields');
    const container = document.getElementById('fieldsList');
    
    if (!fields.length) {
      container.innerHTML = '<div class="empty-state"><p>لا توجد حقول مخصصة</p></div>';
      return;
    }

    container.innerHTML = fields.map(f => `
      <div class="period-card">
        <div class="period-info">
          <h4>${f.name}</h4>
          <div class="period-meta">${f.type === 'dropdown' ? 'قائمة منسدلة' : f.type === 'number' ? 'رقم' : 'نص'}</div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-sm btn-secondary" onclick="editField('${f.id}')">تعديل</button>
          <button class="btn btn-sm btn-danger" onclick="deleteField('${f.id}')">حذف</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    showAlert('فشل تحميل الحقول', 'error');
  }
}

document.getElementById('refreshFieldsBtn').addEventListener('click', loadCustomFields);

document.getElementById('fieldType').addEventListener('change', function() {
  document.getElementById('dropdownOptionsContainer').classList.toggle('hidden', this.value !== 'dropdown');
});

window.addDropdownOptionInputWithSubField = function(value = '', subType = '', subLabel = '') {
  const container = document.getElementById('dropdownOptions');
  const div = document.createElement('div');
  div.className = 'dropdown-option';
  div.innerHTML = `
    <input type="text" class="form-input" placeholder="قيمة الخيار" value="${value}" style="flex: 1;">
    <select class="form-select" style="width: 100px;">
      <option value="">بدون حقل فرعي</option>
      <option value="text" ${subType === 'text' ? 'selected' : ''}>نص</option>
      <option value="number" ${subType === 'number' ? 'selected' : ''}>رقم</option>
    </select>
    <input type="text" class="form-input" placeholder="اسم الحقل الفرعي" value="${subLabel}" style="width: 120px;">
    <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(div);
};

function cancelEdit() {
  editingFieldId = null;
  document.getElementById('fieldName').value = '';
  document.getElementById('fieldType').value = 'text';
  document.getElementById('dropdownOptions').innerHTML = '';
  document.getElementById('dropdownOptionsContainer').classList.add('hidden');
  document.getElementById('cancelEditFieldBtn').classList.add('hidden');
}

window.editField = async function(id) {
  try {
    const fields = await aiApi('GET', '/api/ai/custom-fields');
    const field = fields.find(f => f.id === id);
    if (!field) return;

    editingFieldId = id;
    document.getElementById('fieldName').value = field.name;
    document.getElementById('fieldType').value = field.type;
    document.getElementById('cancelEditFieldBtn').classList.remove('hidden');

    if (field.type === 'dropdown') {
      document.getElementById('dropdownOptionsContainer').classList.remove('hidden');
      document.getElementById('dropdownOptions').innerHTML = '';
      (field.options || []).forEach(opt => {
        if (typeof opt === 'object') {
          addDropdownOptionInputWithSubField(opt.value, opt.subType, opt.subLabel);
        } else {
          addDropdownOptionInputWithSubField(opt);
        }
      });
    }
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

window.deleteField = async function(id) {
  if (!confirm('حذف هذا الحقل؟')) return;
  try {
    await aiApi('DELETE', `/api/ai/custom-fields/${id}`);
    showAlert('تم حذف الحقل');
    loadCustomFields();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

document.getElementById('addFieldBtn').addEventListener('click', async () => {
  try {
    const name = document.getElementById('fieldName').value.trim();
    const type = document.getElementById('fieldType').value;

    if (!name) {
      showAlert('يرجى إدخال اسم الحقل', 'error');
      return;
    }

    let options = [];
    if (type === 'dropdown') {
      document.querySelectorAll('#dropdownOptions .dropdown-option').forEach(row => {
        const inputs = row.querySelectorAll('input');
        const select = row.querySelector('select');
        const value = inputs[0].value.trim();
        const subType = select.value;
        const subLabel = inputs[1].value.trim();
        
        if (value) {
          if (subType) {
            options.push({ value, subType, subLabel });
          } else {
            options.push(value);
          }
        }
      });
    }

    const data = { name, type, options };

    if (editingFieldId) {
      await aiApi('PUT', `/api/ai/custom-fields/${editingFieldId}`, data);
      showAlert('تم تحديث الحقل');
    } else {
      await aiApi('POST', '/api/ai/custom-fields', data);
      showAlert('تم إضافة الحقل');
    }

    cancelEdit();
    loadCustomFields();
  } catch (err) {
    showAlert(err.message, 'error');
  }
});

async function renderCustomFieldsInForm() {
  try {
    const fields = await aiApi('GET', '/api/ai/custom-fields');
    const container = document.getElementById('customFieldsContainer');
    
    container.innerHTML = fields.map(f => {
      if (f.type === 'dropdown') {
        return `
          <div class="form-group">
            <label class="form-label">${f.name}</label>
            <select class="form-select" id="custom_${f.id}" onchange="handleDropdownSubField(this, '${f.id}')">
              <option value="">اختر...</option>
              ${(f.options || []).map(opt => {
                const val = typeof opt === 'object' ? opt.value : opt;
                return `<option value="${val}" data-sub-type="${opt.subType || ''}" data-sub-label="${opt.subLabel || ''}">${val}</option>`;
              }).join('')}
            </select>
            <div id="subField_${f.id}"></div>
          </div>
        `;
      } else {
        return `
          <div class="form-group">
            <label class="form-label">${f.name}</label>
            <input type="${f.type === 'number' ? 'number' : 'text'}" class="form-input" id="custom_${f.id}">
          </div>
        `;
      }
    }).join('');
  } catch {}
}

window.handleDropdownSubField = function(selectEl, fieldKey) {
  const selected = selectEl.options[selectEl.selectedIndex];
  const subType = selected.dataset.subType;
  const subLabel = selected.dataset.subLabel;
  const container = document.getElementById(`subField_${fieldKey}`);
  
  if (subType) {
    container.innerHTML = `
      <div class="form-group" style="margin-top: 8px;">
        <label class="form-label">${subLabel || 'تفاصيل إضافية'}</label>
        <input type="${subType === 'number' ? 'number' : 'text'}" class="form-input" id="custom_${fieldKey}__sub">
      </div>
    `;
  } else {
    container.innerHTML = '';
  }
};

// =====================================================
// LOOKUPS
// =====================================================
let globalLookups = { agencies: [], countries: [] };

async function loadLookups() {
  try {
    globalLookups = await aiApi('GET', '/api/ai/lookups');
    renderLookupSelects();
  } catch {}
}

function renderLookupSelects() {
  const agencySelect = document.getElementById('regAgency');
  const countrySelect = document.getElementById('regCountry');
  
  agencySelect.innerHTML = '<option value="">اختر الوكالة</option>';
  (globalLookups.agencies || []).forEach(a => {
    agencySelect.innerHTML += `<option value="${a}">${a}</option>`;
  });

  countrySelect.innerHTML = '<option value="">اختر الدولة</option>';
  (globalLookups.countries || []).forEach(c => {
    const name = typeof c === 'object' ? c.name : c;
    countrySelect.innerHTML += `<option value="${name}">${name}</option>`;
  });
}

document.getElementById('regCountry')?.addEventListener('change', function() {
  const citySelect = document.getElementById('regCity');
  const country = globalLookups.countries?.find(c => (typeof c === 'object' ? c.name : c) === this.value);
  
  citySelect.innerHTML = '<option value="">اختر المدينة</option>';
  if (country && country.cities) {
    country.cities.forEach(city => {
      citySelect.innerHTML += `<option value="${city}">${city}</option>`;
    });
  }
});

// =====================================================
// NOTIFY CLIENT
// =====================================================
let currentNotifyClientKey = null;
let currentNotifyPhone = null;
let notifyType = 'salary';

window.promptNotify = function(key, name, phone) {
  currentNotifyClientKey = key;
  currentNotifyPhone = phone;
  document.getElementById('notifyClientInfo').textContent = `إرسال إشعار لـ: ${name}`;
  document.getElementById('notifyModal').classList.add('active');
};

function closeNotifyModal() {
  document.getElementById('notifyModal').classList.remove('active');
  currentNotifyClientKey = null;
}

window.toggleNotifyType = function(type) {
  notifyType = type;
  document.querySelectorAll('.inner-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('notifyCustomContainer').classList.toggle('hidden', type !== 'custom');
};

window.sendNotification = async function() {
  try {
    if (notifyType === 'salary') {
      await aiApi('POST', '/api/ai/notify/salary', { clientKey: currentNotifyClientKey });
      showAlert('تم إرسال إشعار الراتب');
    } else {
      const message = document.getElementById('notifyCustomMessage').value;
      if (!message) {
        showAlert('يرجى كتابة الرسالة', 'error');
        return;
      }
      await aiApi('POST', '/api/ai/notify/custom', { phone: currentNotifyPhone, message });
      showAlert('تم إرسال الرسالة');
    }
    closeNotifyModal();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

// =====================================================
// OPENROUTER MODELS
// =====================================================
window.loadOpenRouterModels = async function() {
  try {
    showAlert('جاري تحميل الموديلات...');
    const res = await fetch('https://openrouter.ai/api/v1/models');
    const data = await res.json();
    
    const select = document.getElementById('openrouterModel');
    select.innerHTML = '';
    
    data.data.sort((a, b) => a.id.localeCompare(b.id)).forEach(model => {
      select.innerHTML += `<option value="${model.id}">${model.id}</option>`;
    });
    
    showAlert(`تم تحميل ${data.data.length} موديل`);
  } catch (err) {
    showAlert('فشل تحميل الموديلات', 'error');
  }
};

// =====================================================
// RECEIPTS
// =====================================================
let currentReceiptsClientKey = null;
let selectedReceiptFile = null;

window.openReceiptsModal = async function(clientKey, clientName) {
  currentReceiptsClientKey = clientKey;
  document.getElementById('receiptsModalTitle').textContent = `إيصالات: ${clientName}`;
  document.getElementById('receiptsModal').classList.add('active');
  clearSelectedFile();
  await loadClientReceipts();
};

function closeReceiptsModal() {
  document.getElementById('receiptsModal').classList.remove('active');
  currentReceiptsClientKey = null;
  selectedReceiptFile = null;
}

// Toggle between file and text receipt types
window.toggleReceiptType = function(type) {
  const fileSection = document.getElementById('receiptDropZone');
  const textSection = document.getElementById('receiptTextSection');
  const fileTab = document.getElementById('receiptTabFile');
  const textTab = document.getElementById('receiptTabText');
  const descLabel = document.getElementById('receiptDescLabel');
  const descInput = document.getElementById('receiptDescription');
  
  if (type === 'file') {
    fileSection.style.display = 'block';
    textSection?.classList.add('hidden');
    fileTab.classList.add('active');
    textTab.classList.remove('active');
    descLabel.textContent = 'وصف الإيصال (اختياري)';
    descInput.placeholder = 'مثال: حوالة بنكية - مبلغ 1000 ر.س';
    descInput.required = false;
  } else {
    fileSection.style.display = 'none';
    textSection?.classList.remove('hidden');
    fileTab.classList.remove('active');
    textTab.classList.add('active');
    descLabel.textContent = 'معلومات الإيصال (مطلوب) *';
    descInput.placeholder = 'مثال: حوالة بنكية - بنك الراجحي\nالمبلغ: 1000 ر.س\nالتاريخ: 2026/01/17\nرقم العملية: 12345';
    descInput.required = true;
  }
};

// Receipt file handling
const receiptDropZone = document.getElementById('receiptDropZone');
const receiptFileInput = document.getElementById('receiptFile');

if (receiptDropZone) {
  receiptDropZone.addEventListener('click', () => receiptFileInput.click());
  receiptDropZone.addEventListener('dragover', e => { e.preventDefault(); receiptDropZone.classList.add('dragover'); });
  receiptDropZone.addEventListener('dragleave', () => receiptDropZone.classList.remove('dragover'));
  receiptDropZone.addEventListener('drop', e => {
    e.preventDefault();
    receiptDropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleReceiptFile(e.dataTransfer.files[0]);
  });
}

if (receiptFileInput) {
  receiptFileInput.addEventListener('change', e => {
    if (e.target.files.length) handleReceiptFile(e.target.files[0]);
  });
}

function handleReceiptFile(file) {
  selectedReceiptFile = file;
  document.getElementById('selectedFileName').textContent = file.name;
  document.getElementById('selectedFileInfo').classList.remove('hidden');
}

window.clearSelectedFile = function() {
  selectedReceiptFile = null;
  document.getElementById('selectedFileInfo').classList.add('hidden');
  if (receiptFileInput) receiptFileInput.value = '';
};

window.uploadReceipt = async function() {
  if (!currentReceiptsClientKey) {
    showAlert('خطأ: لم يتم تحديد العميل', 'error');
    return;
  }
  
  // Check receipt type
  const fileSection = document.getElementById('receiptDropZone');
  const isTextOnly = fileSection.style.display === 'none';
  const description = document.getElementById('receiptDescription').value.trim();
  
  // Validation
  if (isTextOnly) {
    if (!description) {
      showAlert('يرجى إدخال معلومات الإيصال', 'error');
      return;
    }
  } else {
    if (!selectedReceiptFile) {
      showAlert('يرجى اختيار ملف', 'error');
      return;
    }
  }

  try {
    const formData = new FormData();
    
    if (!isTextOnly) {
      formData.append('file', selectedReceiptFile);
    }
    
    formData.append('description', description);
    formData.append('isTextOnly', isTextOnly);

    await aiApi('POST', `/api/ai/clients/${currentReceiptsClientKey}/receipts`, formData);
    showAlert(isTextOnly ? 'تم حفظ الإيصال النصي بنجاح ✅' : 'تم رفع الإيصال بنجاح ✅');
    clearSelectedFile();
    document.getElementById('receiptDescription').value = '';
    await loadClientReceipts();
  } catch (err) {
    showAlert('فشل رفع الإيصال: ' + err.message, 'error');
  }
};

async function loadClientReceipts() {
  if (!currentReceiptsClientKey) return;
  
  try {
    const receipts = await aiApi('GET', `/api/ai/clients/${currentReceiptsClientKey}/receipts`);
    const container = document.getElementById('receiptsList');
    
    if (!receipts.length) {
      container.innerHTML = '<div class="empty-state"><p>لا توجد إيصالات</p></div>';
      return;
    }

    container.innerHTML = receipts.map(r => {
      const date = new Date(r.uploadedAt).toLocaleDateString('ar');
      const isText = r.isTextOnly || !r.filename;
      return `
        <div class="receipt-item" style="background: var(--bg); padding: 12px; border-radius: 8px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
          <div style="flex: 1;">
            <div style="font-weight: 500; font-size: 12px;">
              ${isText ? '📝 إيصال نصي' : '📁 ' + r.originalName}
            </div>
            <div style="font-size: 10px; color: var(--text-muted);">${date}</div>
            ${r.description ? `<div style="font-size: 11px; color: var(--text); margin-top: 4px; padding: 8px; background: var(--surface); border-radius: 4px; white-space: pre-wrap;">${r.description}</div>` : ''}
          </div>
          <div style="display: flex; gap: 4px;">
            ${!isText ? `<a href="/api/receipts/file/${r.filename}" target="_blank" class="btn btn-sm btn-secondary">عرض</a>` : ''}
            <button class="btn btn-sm btn-danger" onclick="deleteReceipt('${r.id}')">حذف</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    document.getElementById('receiptsList').innerHTML = '<div class="empty-state"><p>لا توجد إيصالات</p></div>';
  }
}

window.deleteReceipt = async function(id) {
  if (!confirm('حذف هذا الإيصال؟')) return;
  try {
    await aiApi('DELETE', `/api/receipts/${id}`);
    showAlert('تم حذف الإيصال');
    await loadClientReceipts();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

// =====================================================
// BROADCAST
// =====================================================
window.promptBroadcast = function() {
  document.getElementById('broadcastModal').classList.add('active');
  loadBroadcastAgencies();
};

function closeBroadcastModal() {
  document.getElementById('broadcastModal').classList.remove('active');
}

function loadBroadcastAgencies() {
  const select = document.getElementById('broadcastAgency');
  select.innerHTML = '';
  (globalLookups.agencies || []).forEach(a => {
    select.innerHTML += `<option value="${a}">${a}</option>`;
  });
}

document.getElementById('broadcastTarget')?.addEventListener('change', function() {
  document.getElementById('broadcastAgencyGroup').classList.toggle('hidden', this.value !== 'agency');
});

window.sendBroadcast = async function() {
  const message = document.getElementById('broadcastMessage').value.trim();
  if (!message) {
    showAlert('يرجى كتابة الرسالة', 'error');
    return;
  }

  const target = document.getElementById('broadcastTarget').value;
  const selectedAgency = target === 'agency' ? document.getElementById('broadcastAgency').value : null;

  try {
    // Get clients to send to
    let clients = [];
    
    if (target === 'all') {
      clients = allClientsData.filter(c => c.phone || c.whatsappPhone).map(c => ({
        key: c.key,
        phone: c.whatsappPhone || c.phone,
        name: c.fullName
      }));
    } else if (target === 'agency' && selectedAgency) {
      clients = allClientsData.filter(c => c.agencyName === selectedAgency && (c.phone || c.whatsappPhone)).map(c => ({
        key: c.key,
        phone: c.whatsappPhone || c.phone,
        name: c.fullName
      }));
    }

    if (!clients.length) {
      showAlert('لا يوجد عملاء للإرسال', 'error');
      return;
    }

    await aiApi('POST', '/api/ai/notify/broadcast', { clients, message });
    showAlert(`تم إرسال الرسالة لـ ${clients.length} عميل`);
    closeBroadcastModal();
    document.getElementById('broadcastMessage').value = '';
  } catch (err) {
    showAlert('فشل الإرسال: ' + err.message, 'error');
  }
};

// =====================================================
// LOOKUPS MANAGEMENT
// =====================================================
window.openLookupsModal = function() {
  document.getElementById('lookupsModal').classList.add('active');
  renderLookupLists();
};

function closeLookupsModal() {
  document.getElementById('lookupsModal').classList.remove('active');
}

window.switchLookupTab = function(tab) {
  document.querySelectorAll('#lookupsModal .inner-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('agenciesLookup').classList.toggle('hidden', tab !== 'agencies');
  document.getElementById('countriesLookup').classList.toggle('hidden', tab !== 'countries');
};

function renderLookupLists() {
  // Agencies
  const agenciesList = document.getElementById('agenciesList');
  agenciesList.innerHTML = (globalLookups.agencies || []).map(a => `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: var(--bg); border-radius: 6px; margin-bottom: 6px;">
      <span style="font-size: 12px;">${a}</span>
      <button class="btn btn-sm btn-danger" onclick="deleteAgency('${a}')">حذف</button>
    </div>
  `).join('') || '<p style="color: var(--text-muted); text-align: center;">لا توجد وكالات</p>';

  // Countries
  const countriesList = document.getElementById('countriesList');
  const countries = globalLookups.countries || [];
  countriesList.innerHTML = countries.map(c => {
    const name = typeof c === 'object' ? c.name : c;
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: var(--bg); border-radius: 6px; margin-bottom: 6px;">
        <span style="font-size: 12px;">${name}</span>
        <button class="btn btn-sm btn-danger" onclick="deleteCountry('${name}')">حذف</button>
      </div>
    `;
  }).join('') || '<p style="color: var(--text-muted); text-align: center;">لا توجد دول</p>';
}

window.addAgency = async function() {
  const name = document.getElementById('newAgencyName').value.trim();
  if (!name) return;

  try {
    await aiApi('POST', '/api/ai/lookups/agency', { name });
    showAlert('تم إضافة الوكالة');
    document.getElementById('newAgencyName').value = '';
    await loadLookups();
    renderLookupLists();
    renderLookupSelects();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

window.deleteAgency = async function(name) {
  if (!confirm(`حذف الوكالة "${name}"؟`)) return;
  try {
    await aiApi('DELETE', `/api/ai/lookups/agency/${encodeURIComponent(name)}`);
    showAlert('تم حذف الوكالة');
    await loadLookups();
    renderLookupLists();
    renderLookupSelects();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

window.addCountry = async function() {
  const name = document.getElementById('newCountryName').value.trim();
  if (!name) return;

  try {
    await aiApi('POST', '/api/ai/lookups/country', { name });
    showAlert('تم إضافة الدولة');
    document.getElementById('newCountryName').value = '';
    await loadLookups();
    renderLookupLists();
    renderLookupSelects();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

window.deleteCountry = async function(name) {
  if (!confirm(`حذف الدولة "${name}"؟`)) return;
  try {
    await aiApi('DELETE', `/api/ai/lookups/country/${encodeURIComponent(name)}`);
    showAlert('تم حذف الدولة');
    await loadLookups();
    renderLookupLists();
    renderLookupSelects();
  } catch (err) {
    showAlert(err.message, 'error');
  }
};

// =====================================================
// INITIALIZATION
// =====================================================
// Socket.IO setup for real-time chat
let aiSocket;
    
function initAiSocket() {
      aiSocket = io();
  
  // Listen for new chat messages
  aiSocket.on('newMessage', (data) => {
    console.log('New message received:', data);
    loadChats();
  });
  
  aiSocket.on('connect_error', (err) => {
    console.error('Socket connection error:', err);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initAiSocket();
  loadAiSettings();
  loadPeriods();
  loadRegisteredClients();
  loadLinkedClients();
  loadChats();
  loadNotifications();
  loadNotificationTargets();
  loadTickets();
  loadKnowledge();
  loadUsage();
  loadCustomFields();
  loadLookups();

  // Auto-refresh chats
  setInterval(loadChats, 10000);
});
