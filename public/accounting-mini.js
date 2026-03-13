// Accounting Mini Module - Simplified view for unified dashboard
(function() {
  const acctApi = {
    async get(endpoint) {
      const res = await fetch(`/api/accounting${endpoint}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
  };

  async function loadAccountingOverview() {
    const cyclesContainer = document.getElementById('acct-cycles-list');
    const statsContainer = document.getElementById('acct-stats');
    if (!cyclesContainer) return;

    cyclesContainer.innerHTML = '<div class="empty-state"><p>جاري التحميل...</p></div>';

    try {
      const periods = await acctApi.get('/periods');

      if (!periods.length) {
        cyclesContainer.innerHTML = '<div class="empty-state"><p>لا توجد دورات محاسبية</p></div>';
        return;
      }

      const openCount = periods.filter(p => p.status === 'OPEN').length;
      const closedCount = periods.filter(p => p.status !== 'OPEN').length;

      if (statsContainer) {
        statsContainer.innerHTML = `
          <div class="stat-card">
            <div class="stat-value">${periods.length}</div>
            <div class="stat-label">إجمالي الدورات</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color: var(--success);">${openCount}</div>
            <div class="stat-label">دورات مفتوحة</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color: var(--text-muted);">${closedCount}</div>
            <div class="stat-label">دورات مغلقة</div>
          </div>
        `;
      }

      cyclesContainer.innerHTML = periods.map(p => `
        <div class="acct-cycle-card">
          <div>
            <div style="font-weight: 600; margin-bottom: 4px;">${p.name}</div>
            <div style="font-size: 10px; color: var(--text-muted);">${p.createdAt ? new Date(p.createdAt).toLocaleDateString('ar') : '-'}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge ${p.status === 'OPEN' ? 'badge-success' : 'badge-danger'}">${p.status}</span>
            <a href="/accounting.html" class="btn btn-sm btn-secondary" target="_blank">فتح</a>
          </div>
        </div>
      `).join('');
    } catch (err) {
      cyclesContainer.innerHTML = `<div class="empty-state"><p style="color: var(--danger);">${err.message}</p></div>`;
    }
  }

  // Try to load safe balance
  async function loadSafeBalance() {
    try {
      const stats = await acctApi.get('/reports/general-stats');
      const statsContainer = document.getElementById('acct-stats');
      if (statsContainer && stats.totalWalletBalance !== undefined) {
        const existingStats = statsContainer.innerHTML;
        statsContainer.innerHTML += `
          <div class="stat-card">
            <div class="stat-value" style="color: var(--warning);">$${(stats.totalWalletBalance || 0).toLocaleString()}</div>
            <div class="stat-label">رصيد الخزينة</div>
          </div>
        `;
      }
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadAccountingOverview();
    loadSafeBalance();
  });
})();
