/* =========================================================
   家計簿アプリ  (旧: 我慢チェッカー)
   localStorage のみで動作する PWA
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {

/* ---------------------------------------------------------
   0. 定数・ユーティリティ
--------------------------------------------------------- */
const KEYS = {
  gaman: 'gamanData',
  use: 'useData',
  useLimits: 'useLimits',
  methods: 'paymentMethods',
  income: 'kakeiboIncome',
  expense: 'kakeiboExpense',
  fixed: 'kakeiboFixedCosts',
  invest: 'investData',
  investFixed: 'investFixed',
  metricsConfig: 'metricsConfig',
  appTitle: 'appTitle',
  fixedLog: 'generatedFixedLog'
};

const CATEGORY_LABEL = { tsumitate: 'NISA（積立）', seicho: 'NISA（成長）', ideco: 'iDeCo' };

const currencyFormatter = new Intl.NumberFormat('ja-JP');
const fmt = n => currencyFormatter.format(Math.round(n || 0));
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad2 = n => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const monthKeyOf = dateStr => dateStr.slice(0, 7);
const currentMonthKey = () => todayStr().slice(0, 7);
const daysInMonth = (year, month1to12) => new Date(year, month1to12, 0).getDate();
const escapeHTML = str => String(str).replace(/[&<>'"]/g, t => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[t]));
const formatMonthLabel = ym => {
  const [y, m] = ym.split('-');
  return `${y}年${parseInt(m, 10)}月`;
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('load failed', key, e);
    return fallback;
  }
}
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------------------------------------------------------
   1. 状態の読み込み
--------------------------------------------------------- */
let gamanData = load(KEYS.gaman, []);
let useData = load(KEYS.use, []);
let useLimits = load(KEYS.useLimits, {});
let paymentMethods = load(KEYS.methods, ['現金', 'PayPay', '楽天', 'UFJ']);
let incomeData = load(KEYS.income, []);
let expenseData = load(KEYS.expense, []);
let fixedCosts = load(KEYS.fixed, []);
let investData = load(KEYS.invest, []);
let investFixed = load(KEYS.investFixed, []);
let metricsConfig = load(KEYS.metricsConfig, { custom: [], hiddenBase: [] });
let appTitle = load(KEYS.appTitle, '家計簿');

function saveAll() {
  save(KEYS.gaman, gamanData);
  save(KEYS.use, useData);
  save(KEYS.useLimits, useLimits);
  save(KEYS.methods, paymentMethods);
  save(KEYS.income, incomeData);
  save(KEYS.expense, expenseData);
  save(KEYS.fixed, fixedCosts);
  save(KEYS.invest, investData);
  save(KEYS.investFixed, investFixed);
  save(KEYS.metricsConfig, metricsConfig);
  save(KEYS.appTitle, appTitle);
}

/* ---------------------------------------------------------
   2. タブ / サブタブ ナビゲーション
--------------------------------------------------------- */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tabTarget));
});
function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tabTarget === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tab === tab));
  if (tab === 'data') renderDataTab();
}

document.querySelectorAll('.subtab-switch').forEach(group => {
  const panelsWrap = group.parentElement;
  group.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.subtab-btn').forEach(b => b.classList.toggle('active', b === btn));
      panelsWrap.querySelectorAll('.subtab-panel').forEach(p => p.classList.toggle('active', p.dataset.subpanel === btn.dataset.subtab));
    });
  });
});

/* ---------------------------------------------------------
   3. モーダル（編集・削除・各種フォーム）
--------------------------------------------------------- */
const modalOverlay = document.getElementById('modalOverlay');
const modalContent = document.getElementById('modalContent');

function closeModal() {
  modalOverlay.classList.remove('open');
  modalContent.innerHTML = '';
}
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

function openModal(html) {
  modalContent.innerHTML = `<div class="modal-close"></div>${html}`;
  modalOverlay.classList.add('open');
}

// 汎用: 項目編集モーダル（項目名・金額・日付 [・決済媒体]）
function openEditItemModal({ title, name, price, date, method, onSave, onDelete }) {
  const methodOptions = method !== undefined
    ? `<div class="form-group"><label>決済媒体</label><select id="mf_method">${paymentMethods.map(m => `<option value="${escapeHTML(m)}" ${m === method ? 'selected' : ''}>${escapeHTML(m)}</option>`).join('')}</select></div>`
    : '';
  openModal(`
    <h3>${escapeHTML(title)}</h3>
    <div class="form-group"><label>項目</label><input type="text" id="mf_name" value="${escapeHTML(name)}"></div>
    <div class="form-row">
      <div class="form-group half"><label>金額 (¥)</label><input type="number" id="mf_price" value="${price}" min="1"></div>
      <div class="form-group half"><label>日付</label><input type="date" id="mf_date" value="${date}"></div>
    </div>
    ${methodOptions}
    <div class="modal-actions">
      <button class="btn-danger" id="mf_delete">削除</button>
      <button class="btn-primary accent-gaman-bg" id="mf_save"><span>保存</span></button>
    </div>
  `);
  document.getElementById('mf_save').addEventListener('click', () => {
    const newName = document.getElementById('mf_name').value.trim();
    const newPrice = parseInt(document.getElementById('mf_price').value, 10);
    const newDate = document.getElementById('mf_date').value;
    if (!newName || !newPrice || !newDate) return;
    const newMethod = method !== undefined ? document.getElementById('mf_method').value : undefined;
    onSave({ name: newName, price: newPrice, date: newDate, method: newMethod });
    closeModal();
  });
  document.getElementById('mf_delete').addEventListener('click', () => {
    if (confirm('この記録を削除しますか？')) {
      onDelete();
      closeModal();
    }
  });
}

/* ---------------------------------------------------------
   4. 固定費の自動反映
--------------------------------------------------------- */
function ensureFixedCostsGenerated() {
  const log = load(KEYS.fixedLog, []);
  const ym = currentMonthKey();
  const [y, m] = ym.split('-').map(Number);
  const lastDay = daysInMonth(y, m);
  let changed = false;

  fixedCosts.forEach(fc => {
    const logKey = `k_${fc.id}_${ym}`;
    if (!log.includes(logKey)) {
      const day = Math.min(parseInt(fc.day, 10), lastDay);
      const dateStr = `${ym}-${pad2(day)}`;
      const entry = { id: genId(), name: fc.name, price: fc.price, date: dateStr, checked: false, fixedId: fc.id };
      if (fc.type === 'income') {
        incomeData.push(entry);
      } else {
        entry.method = fc.method || paymentMethods[0];
        expenseData.push(entry);
      }
      log.push(logKey);
      changed = true;
    }
  });

  investFixed.forEach(fc => {
    const logKey = `i_${fc.id}_${ym}`;
    if (!log.includes(logKey)) {
      const day = Math.min(parseInt(fc.day, 10), lastDay);
      const dateStr = `${ym}-${pad2(day)}`;
      investData.push({ id: genId(), category: fc.category, name: fc.name, price: fc.price, date: dateStr, fixedId: fc.id });
      log.push(logKey);
      changed = true;
    }
  });

  if (changed) {
    saveAll();
    save(KEYS.fixedLog, log);
  }
}

/* ---------------------------------------------------------
   5. 我慢タブ
--------------------------------------------------------- */
const gamanForm = document.getElementById('gamanForm');
document.getElementById('gamanDate').value = todayStr();

gamanForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('gamanName').value.trim();
  const price = parseInt(document.getElementById('gamanPrice').value, 10);
  const date = document.getElementById('gamanDate').value;
  if (!name || !price || !date) return;
  gamanData.push({ id: genId(), name, price, date });
  saveAll();
  document.getElementById('gamanName').value = '';
  document.getElementById('gamanPrice').value = '';
  renderGamanTab();
  renderDataTabIfActive();
});

document.querySelector('[data-clear="gaman"]').addEventListener('click', () => {
  if (gamanData.length === 0) return;
  if (confirm('我慢の履歴をすべて削除しますか？この操作は元に戻せません。')) {
    gamanData = [];
    saveAll();
    renderGamanTab();
  }
});

function renderHistoryGrouped(container, items, { onItemClick, priceClass = null, renderMeta = null } = {}) {
  container.innerHTML = '';
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">まだ記録がありません。</div>`;
    return;
  }
  const groups = {};
  items.forEach(item => {
    const key = monthKeyOf(item.date);
    if (!groups[key]) groups[key] = { items: [], total: 0 };
    groups[key].items.push(item);
    groups[key].total += item.price;
  });
  const sortedKeys = Object.keys(groups).sort().reverse();
  sortedKeys.forEach(key => {
    const group = groups[key];
    group.items.sort((a, b) => new Date(b.date) - new Date(a.date));
    const wrap = document.createElement('div');
    wrap.className = 'month-group';
    const listHTML = group.items.map(item => {
      const meta = renderMeta ? renderMeta(item) : `<div class="item-meta">${item.date}</div>`;
      const pc = priceClass ? priceClass(item) : '';
      return `
        <li class="history-item" data-id="${item.id}">
          <div class="item-info">
            <div class="item-name">${escapeHTML(item.name)}</div>
            ${meta}
          </div>
          <div class="item-price ${pc}">¥${fmt(item.price)}</div>
        </li>`;
    }).join('');
    wrap.innerHTML = `
      <h3 class="month-title"><span>${formatMonthLabel(key)}</span><span class="month-total">¥${fmt(group.total)}</span></h3>
      <ul class="item-list">${listHTML}</ul>`;
    container.appendChild(wrap);
  });
  if (onItemClick) {
    container.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => onItemClick(el.dataset.id));
    });
  }
}

function renderGamanTab() {
  const total = gamanData.reduce((s, i) => s + i.price, 0);
  document.getElementById('gamanTotal').textContent = fmt(total);
  renderHistoryGrouped(document.getElementById('gamanHistory'), gamanData, {
    onItemClick: id => {
      const item = gamanData.find(i => i.id === id);
      if (!item) return;
      openEditItemModal({
        title: '我慢の記録を編集',
        name: item.name, price: item.price, date: item.date,
        onSave: v => {
          Object.assign(item, v);
          saveAll();
          renderGamanTab();
          renderDataTabIfActive();
        },
        onDelete: () => {
          gamanData = gamanData.filter(i => i.id !== id);
          saveAll();
          renderGamanTab();
          renderDataTabIfActive();
        }
      });
    }
  });
}

/* ---------------------------------------------------------
   6. 使用タブ
--------------------------------------------------------- */
const useForm = document.getElementById('useForm');
document.getElementById('useDate').value = todayStr();

function refreshMethodSelects() {
  const selects = ['useMethod', 'expenseMethod', 'fixedMethod'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = paymentMethods.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join('');
    if (paymentMethods.includes(prev)) sel.value = prev;
  });
}
refreshMethodSelects();

document.getElementById('editMethodsBtn').addEventListener('click', () => {
  openMethodsModal();
});

function openMethodsModal() {
  const renderList = () => paymentMethods.map((m, idx) => `
    <div class="metric-manage-item">
      <span>${escapeHTML(m)}</span>
      <button class="del-metric" data-idx="${idx}" ${paymentMethods.length <= 1 ? 'disabled' : ''}>削除</button>
    </div>`).join('');
  openModal(`
    <h3>決済媒体を編集</h3>
    <div id="methodsListWrap" class="metric-manage-list">${renderList()}</div>
    <div class="form-group">
      <label>新しい決済媒体を追加</label>
      <div class="limit-editor-row">
        <input type="text" id="newMethodInput" placeholder="例: 交通系IC">
        <button class="btn-small" id="addMethodBtn">追加</button>
      </div>
    </div>
    <div class="modal-actions"><button class="btn-primary accent-use-bg" id="methodsCloseBtn"><span>閉じる</span></button></div>
  `);
  const rerender = () => {
    document.getElementById('methodsListWrap').innerHTML = renderList();
    document.getElementById('methodsListWrap').querySelectorAll('.del-metric').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        paymentMethods.splice(idx, 1);
        saveAll();
        refreshMethodSelects();
        rerender();
      });
    });
  };
  rerender();
  document.getElementById('addMethodBtn').addEventListener('click', () => {
    const input = document.getElementById('newMethodInput');
    const val = input.value.trim();
    if (!val || paymentMethods.includes(val)) return;
    paymentMethods.push(val);
    saveAll();
    refreshMethodSelects();
    input.value = '';
    rerender();
  });
  document.getElementById('methodsCloseBtn').addEventListener('click', closeModal);
}

useForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('useName').value.trim();
  const price = parseInt(document.getElementById('usePrice').value, 10);
  const date = document.getElementById('useDate').value;
  const method = document.getElementById('useMethod').value;
  if (!name || !price || !date) return;
  useData.push({ id: genId(), name, price, date, method });
  saveAll();
  document.getElementById('useName').value = '';
  document.getElementById('usePrice').value = '';
  renderUseTab();
  renderKakeiboTab();
  renderDataTabIfActive();
});

document.querySelector('[data-clear="use"]').addEventListener('click', () => {
  if (useData.length === 0) return;
  if (confirm('使用の履歴をすべて削除しますか？この操作は元に戻せません。')) {
    useData = [];
    saveAll();
    renderUseTab();
    renderKakeiboTab();
  }
});

document.getElementById('saveLimitBtn').addEventListener('click', () => {
  const val = parseInt(document.getElementById('useLimitInput').value, 10);
  if (!val || val < 0) return;
  useLimits[currentMonthKey()] = val;
  saveAll();
  renderUseTab();
});

function openUseEditModal(id) {
  const item = useData.find(i => i.id === id);
  if (!item) return;
  openEditItemModal({
    title: '使用の記録を編集',
    name: item.name, price: item.price, date: item.date, method: item.method,
    onSave: v => {
      Object.assign(item, v);
      saveAll();
      renderUseTab();
      renderKakeiboTab();
      renderDataTabIfActive();
    },
    onDelete: () => {
      useData = useData.filter(i => i.id !== id);
      saveAll();
      renderUseTab();
      renderKakeiboTab();
      renderDataTabIfActive();
    }
  });
}

function renderUseTab() {
  const ym = currentMonthKey();
  const monthTotal = useData.filter(i => monthKeyOf(i.date) === ym).reduce((s, i) => s + i.price, 0);
  const limit = useLimits[ym] || 0;
  const remaining = limit - monthTotal;

  document.getElementById('useMonthTotal').textContent = fmt(monthTotal);
  document.getElementById('useRemaining').textContent = fmt(Math.abs(remaining));
  const remWrap = document.getElementById('useRemainingWrap');
  remWrap.querySelector('#useRemaining').style.color = remaining < 0 ? 'var(--danger)' : 'var(--success)';
  if (remaining < 0) document.getElementById('useRemaining').textContent = '-' + fmt(Math.abs(remaining));

  const pct = limit > 0 ? Math.min(100, (monthTotal / limit) * 100) : 0;
  const bar = document.getElementById('useProgressBar');
  bar.style.width = pct + '%';
  bar.classList.toggle('over', limit > 0 && monthTotal > limit);

  document.getElementById('useLimitInput').value = limit || '';

  renderHistoryGrouped(document.getElementById('useHistory'), useData, {
    onItemClick: openUseEditModal,
    renderMeta: item => `<div class="item-meta">${item.date}<span class="method-tag">${escapeHTML(item.method || '')}</span></div>`
  });
}

/* ---------------------------------------------------------
   7. 家計簿タブ
--------------------------------------------------------- */
document.getElementById('incomeDate').value = todayStr();
document.getElementById('expenseDate').value = todayStr();

document.getElementById('incomeForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('incomeName').value.trim();
  const price = parseInt(document.getElementById('incomePrice').value, 10);
  const date = document.getElementById('incomeDate').value;
  if (!name || !price || !date) return;
  incomeData.push({ id: genId(), name, price, date, checked: false });
  saveAll();
  document.getElementById('incomeName').value = '';
  document.getElementById('incomePrice').value = '';
  renderKakeiboTab();
  renderDataTabIfActive();
});

document.getElementById('expenseForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('expenseName').value.trim();
  const price = parseInt(document.getElementById('expensePrice').value, 10);
  const date = document.getElementById('expenseDate').value;
  const method = document.getElementById('expenseMethod').value;
  if (!name || !price || !date) return;
  expenseData.push({ id: genId(), name, price, date, method, checked: false });
  saveAll();
  document.getElementById('expenseName').value = '';
  document.getElementById('expensePrice').value = '';
  renderKakeiboTab();
  renderDataTabIfActive();
});

document.getElementById('fixedType').addEventListener('change', e => {
  document.getElementById('fixedMethodWrap').style.display = e.target.value === 'expense' ? 'flex' : 'none';
});

document.getElementById('fixedForm').addEventListener('submit', e => {
  e.preventDefault();
  const type = document.getElementById('fixedType').value;
  const name = document.getElementById('fixedName').value.trim();
  const day = parseInt(document.getElementById('fixedDay').value, 10);
  const price = parseInt(document.getElementById('fixedPrice').value, 10);
  const method = document.getElementById('fixedMethod').value;
  if (!name || !day || !price) return;
  fixedCosts.push({ id: genId(), type, name, day, price, method: type === 'expense' ? method : undefined });
  saveAll();
  ensureFixedCostsGenerated();
  document.getElementById('fixedName').value = '';
  document.getElementById('fixedDay').value = '';
  document.getElementById('fixedPrice').value = '';
  renderKakeiboTab();
  renderDataTabIfActive();
});

function openIncomeEditModal(id) {
  const item = incomeData.find(i => i.id === id);
  if (!item) return;
  openEditItemModal({
    title: '収入を編集', name: item.name, price: item.price, date: item.date,
    onSave: v => { Object.assign(item, v); saveAll(); renderKakeiboTab(); renderDataTabIfActive(); },
    onDelete: () => { incomeData = incomeData.filter(i => i.id !== id); saveAll(); renderKakeiboTab(); renderDataTabIfActive(); }
  });
}
function openExpenseEditModal(id) {
  const item = expenseData.find(i => i.id === id);
  if (!item) return;
  openEditItemModal({
    title: '支出を編集', name: item.name, price: item.price, date: item.date, method: item.method,
    onSave: v => { Object.assign(item, v); saveAll(); renderKakeiboTab(); renderDataTabIfActive(); },
    onDelete: () => { expenseData = expenseData.filter(i => i.id !== id); saveAll(); renderKakeiboTab(); renderDataTabIfActive(); }
  });
}

function renderCheckableList(container, items, onToggle, onClick, metaFn) {
  container.innerHTML = '';
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">今月の記録はまだありません。</div>`;
    return;
  }
  items.sort((a, b) => new Date(a.date) - new Date(b.date));
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'checklist-row';
    const linked = item.linked ? `<span class="linked-tag">使用</span>` : '';
    row.innerHTML = `
      <div class="check-toggle ${item.checked ? 'checked' : ''}" data-id="${item.id}" data-linked="${!!item.linked}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <div class="history-item" data-id="${item.id}" data-linked="${!!item.linked}">
        <div class="item-info">
          <div class="item-name">${escapeHTML(item.name)} ${linked}</div>
          <div class="item-meta">${item.date}${metaFn ? metaFn(item) : ''}</div>
        </div>
        <div class="item-price">¥${fmt(item.price)}</div>
      </div>`;
    container.appendChild(row);
  });
  container.querySelectorAll('.check-toggle').forEach(el => {
    if (el.dataset.linked === 'true') { el.style.opacity = '0.3'; el.style.cursor = 'default'; return; }
    el.addEventListener('click', () => onToggle(el.dataset.id));
  });
  container.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => onClick(el.dataset.id, el.dataset.linked === 'true'));
  });
}

function renderKakeiboTab() {
  const ym = currentMonthKey();
  const monthIncome = incomeData.filter(i => monthKeyOf(i.date) === ym);
  const monthExpenseManual = expenseData.filter(i => monthKeyOf(i.date) === ym);
  const monthUse = useData.filter(i => monthKeyOf(i.date) === ym);

  const incomeTotal = monthIncome.reduce((s, i) => s + i.price, 0);
  const expenseTotal = monthExpenseManual.reduce((s, i) => s + i.price, 0) + monthUse.reduce((s, i) => s + i.price, 0);
  const balance = incomeTotal - expenseTotal;

  document.getElementById('kakeiboIncomeTotal').textContent = fmt(incomeTotal);
  document.getElementById('kakeiboExpenseTotal').textContent = fmt(expenseTotal);
  const balEl = document.getElementById('kakeiboBalance');
  balEl.textContent = (balance < 0 ? '-' : '') + fmt(Math.abs(balance));
  balEl.style.color = balance < 0 ? 'var(--danger)' : 'var(--success)';

  // 収入一覧
  renderCheckableList(
    document.getElementById('incomeList'),
    monthIncome.map(i => ({ ...i })),
    id => { const it = incomeData.find(i => i.id === id); it.checked = !it.checked; saveAll(); renderKakeiboTab(); },
    id => openIncomeEditModal(id)
  );

  // 支出一覧（決済媒体ごとにグループ化: 手入力 + 使用タブ連携分）
  const combined = [
    ...monthExpenseManual.map(i => ({ ...i, linked: false })),
    ...monthUse.map(i => ({ ...i, linked: true }))
  ];
  const expenseWrap = document.getElementById('expenseList');
  expenseWrap.innerHTML = '';
  if (combined.length === 0) {
    expenseWrap.innerHTML = `<div class="empty-state">今月の支出はまだありません。</div>`;
  } else {
    paymentMethods.forEach(method => {
      const items = combined.filter(i => (i.method || '') === method).sort((a, b) => new Date(a.date) - new Date(b.date));
      if (items.length === 0) return;
      const subtotal = items.reduce((s, i) => s + i.price, 0);
      const groupWrap = document.createElement('div');
      groupWrap.className = 'month-group';
      groupWrap.innerHTML = `<div class="method-group-title"><span>${escapeHTML(method)}</span><span>¥${fmt(subtotal)}</span></div>`;
      const list = document.createElement('div');
      list.className = 'history-list';
      groupWrap.appendChild(list);
      renderCheckableList(
        list, items,
        id => { const it = expenseData.find(i => i.id === id); if (it) { it.checked = !it.checked; saveAll(); renderKakeiboTab(); } },
        (id, isLinked) => { if (isLinked) openUseEditModal(id); else openExpenseEditModal(id); }
      );
      expenseWrap.appendChild(groupWrap);
    });
    const noMethod = combined.filter(i => !i.method);
    if (noMethod.length) {
      const groupWrap = document.createElement('div');
      groupWrap.className = 'month-group';
      groupWrap.innerHTML = `<div class="method-group-title"><span>その他</span><span>¥${fmt(noMethod.reduce((s, i) => s + i.price, 0))}</span></div>`;
      const list = document.createElement('div');
      list.className = 'history-list';
      groupWrap.appendChild(list);
      renderCheckableList(list, noMethod,
        id => { const it = expenseData.find(i => i.id === id); if (it) { it.checked = !it.checked; saveAll(); renderKakeiboTab(); } },
        (id, isLinked) => { if (isLinked) openUseEditModal(id); else openExpenseEditModal(id); });
      expenseWrap.appendChild(groupWrap);
    }
  }

  // 固定費一覧
  const fixedWrap = document.getElementById('fixedList');
  fixedWrap.innerHTML = '';
  if (fixedCosts.length === 0) {
    fixedWrap.innerHTML = `<div class="empty-state">固定費はまだ設定されていません。</div>`;
  } else {
    fixedCosts.forEach(fc => {
      const row = document.createElement('div');
      row.className = 'history-item';
      row.innerHTML = `
        <div class="item-info">
          <div class="item-name">${escapeHTML(fc.name)} <span class="method-tag">${fc.type === 'income' ? '収入' : '支出'}</span></div>
          <div class="item-meta">毎月${fc.day}日${fc.method ? ' ・ ' + escapeHTML(fc.method) : ''}</div>
        </div>
        <div class="item-price ${fc.type === 'income' ? 'plus' : 'minus'}">¥${fmt(fc.price)}</div>`;
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        if (confirm('この固定費を削除しますか？（今月以降、自動追加されなくなります）')) {
          fixedCosts = fixedCosts.filter(f => f.id !== fc.id);
          saveAll();
          renderKakeiboTab();
        }
      });
      fixedWrap.appendChild(row);
    });
  }
}

/* ---------------------------------------------------------
   8. 投資タブ
--------------------------------------------------------- */
document.getElementById('investDate').value = todayStr();

document.getElementById('investForm').addEventListener('submit', e => {
  e.preventDefault();
  const category = document.getElementById('investCategory').value;
  const name = document.getElementById('investName').value.trim();
  const price = parseInt(document.getElementById('investPrice').value, 10);
  const date = document.getElementById('investDate').value;
  if (!name || !price || !date) return;
  investData.push({ id: genId(), category, name, price, date });
  saveAll();
  document.getElementById('investName').value = '';
  document.getElementById('investPrice').value = '';
  renderInvestTab();
  renderDataTabIfActive();
});

document.getElementById('investFixedForm').addEventListener('submit', e => {
  e.preventDefault();
  const category = document.getElementById('investFixedCategory').value;
  const name = document.getElementById('investFixedName').value.trim();
  const day = parseInt(document.getElementById('investFixedDay').value, 10);
  const price = parseInt(document.getElementById('investFixedPrice').value, 10);
  if (!name || !day || !price) return;
  investFixed.push({ id: genId(), category, name, day, price });
  saveAll();
  ensureFixedCostsGenerated();
  document.getElementById('investFixedName').value = '';
  document.getElementById('investFixedDay').value = '';
  document.getElementById('investFixedPrice').value = '';
  renderInvestTab();
  renderDataTabIfActive();
});

function openInvestEditModal(id) {
  const item = investData.find(i => i.id === id);
  if (!item) return;
  openEditItemModal({
    title: `投資記録を編集（${CATEGORY_LABEL[item.category]}）`,
    name: item.name, price: item.price, date: item.date,
    onSave: v => { Object.assign(item, v); saveAll(); renderInvestTab(); renderDataTabIfActive(); },
    onDelete: () => { investData = investData.filter(i => i.id !== id); saveAll(); renderInvestTab(); renderDataTabIfActive(); }
  });
}

function renderInvestTab() {
  const byCategory = { tsumitate: 0, seicho: 0, ideco: 0 };
  investData.forEach(i => { byCategory[i.category] = (byCategory[i.category] || 0) + i.price; });
  const total = byCategory.tsumitate + byCategory.seicho + byCategory.ideco;
  document.getElementById('investTotal').textContent = fmt(total);
  document.getElementById('investTsumitate').textContent = '¥' + fmt(byCategory.tsumitate);
  document.getElementById('investSeicho').textContent = '¥' + fmt(byCategory.seicho);
  document.getElementById('investIdeco').textContent = '¥' + fmt(byCategory.ideco);

  renderHistoryGrouped(document.getElementById('investHistory'), investData, {
    onItemClick: openInvestEditModal,
    renderMeta: item => `<div class="item-meta">${item.date}<span class="method-tag">${CATEGORY_LABEL[item.category]}</span></div>`
  });

  const fixedWrap = document.getElementById('investFixedList');
  fixedWrap.innerHTML = '';
  if (investFixed.length === 0) {
    fixedWrap.innerHTML = `<div class="empty-state">積立の固定費はまだ設定されていません。</div>`;
  } else {
    investFixed.forEach(fc => {
      const row = document.createElement('div');
      row.className = 'history-item';
      row.innerHTML = `
        <div class="item-info">
          <div class="item-name">${escapeHTML(fc.name)} <span class="method-tag">${CATEGORY_LABEL[fc.category]}</span></div>
          <div class="item-meta">毎月${fc.day}日</div>
        </div>
        <div class="item-price">¥${fmt(fc.price)}</div>`;
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        if (confirm('この固定費を削除しますか？')) {
          investFixed = investFixed.filter(f => f.id !== fc.id);
          saveAll();
          renderInvestTab();
        }
      });
      fixedWrap.appendChild(row);
    });
  }
}

/* ---------------------------------------------------------
   9. データタブ（指標・グラフ）
--------------------------------------------------------- */
const BASE_METRICS = {
  total_assets: { label: '総資産（貯金＋投資）', calc: cutoff => savingsAsOf(cutoff) + investAsOf(cutoff, ['tsumitate', 'seicho', 'ideco']) },
  savings: { label: '貯金額', calc: cutoff => savingsAsOf(cutoff) },
  nisa: { label: 'NISA投資（積立＋成長）', calc: cutoff => investAsOf(cutoff, ['tsumitate', 'seicho']) },
  ideco: { label: 'iDeCo投資', calc: cutoff => investAsOf(cutoff, ['ideco']) },
  gaman: { label: '我慢金額（累計）', calc: cutoff => gamanAsOf(cutoff) }
};

function incomeAsOf(cutoff) {
  return incomeData.filter(i => i.date <= cutoff).reduce((s, i) => s + i.price, 0);
}
function expenseAsOf(cutoff) {
  const manual = expenseData.filter(i => i.date <= cutoff).reduce((s, i) => s + i.price, 0);
  const used = useData.filter(i => i.date <= cutoff).reduce((s, i) => s + i.price, 0);
  return manual + used;
}
function savingsAsOf(cutoff) {
  return incomeAsOf(cutoff) - expenseAsOf(cutoff);
}
function investAsOf(cutoff, categories) {
  return investData.filter(i => i.date <= cutoff && categories.includes(i.category)).reduce((s, i) => s + i.price, 0);
}
function gamanAsOf(cutoff) {
  return gamanData.filter(i => i.date <= cutoff).reduce((s, i) => s + i.price, 0);
}

function getAllMetrics() {
  const list = Object.keys(BASE_METRICS)
    .filter(k => !metricsConfig.hiddenBase.includes(k))
    .map(k => ({ key: k, label: BASE_METRICS[k].label, custom: false }));
  metricsConfig.custom.forEach(c => list.push({ key: c.id, label: c.name, custom: true, components: c.components }));
  return list;
}

function getMetricValueAsOf(key, cutoff, depth = 0) {
  if (depth > 5) return 0;
  if (BASE_METRICS[key]) return BASE_METRICS[key].calc(cutoff);
  const custom = metricsConfig.custom.find(c => c.id === key);
  if (custom) return custom.components.reduce((s, compKey) => s + getMetricValueAsOf(compKey, cutoff, depth + 1), 0);
  return 0;
}

function lastNMonthKeys(n) {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  return keys;
}
function monthEndCutoff(ym) {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = daysInMonth(y, m);
  const end = `${ym}-${pad2(lastDay)}`;
  return end < todayStr() ? end : todayStr();
}

let trendChart = null;
let strengthChart = null;

function renderDataTabIfActive() {
  if (document.querySelector('.tab-panel[data-tab="data"]').classList.contains('active')) {
    renderDataTab();
  }
}

function renderDataTab() {
  const cutoff = todayStr();
  const metrics = getAllMetrics();

  // サマリーカード
  const grid = document.getElementById('dataSummaryGrid');
  grid.innerHTML = metrics.map(m => `
    <div class="metric-card ${m.key === 'total_assets' ? 'wide' : ''}">
      <span class="stat-label">${escapeHTML(m.label)}</span>
      <div class="stat-amount"><span class="yen">¥</span>${fmt(getMetricValueAsOf(m.key, cutoff))}</div>
    </div>`).join('');

  // 指標セレクト
  const select = document.getElementById('chartMetricSelect');
  const prevVal = select.value;
  select.innerHTML = metrics.map(m => `<option value="${m.key}">${escapeHTML(m.label)}</option>`).join('');
  if (metrics.some(m => m.key === prevVal)) select.value = prevVal;

  renderTrendChart(select.value || (metrics[0] && metrics[0].key));
  select.onchange = () => renderTrendChart(select.value);

  renderStrengthChart();
  renderMetricManageUI(metrics);
}

function renderTrendChart(metricKey) {
  if (!metricKey || typeof Chart === 'undefined') return;
  const months = lastNMonthKeys(6);
  const labels = months.map(m => m.slice(5) + '月');
  const values = months.map(m => getMetricValueAsOf(metricKey, monthEndCutoff(m)));

  const ctx = document.getElementById('trendChart').getContext('2d');
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: 'rgba(250, 204, 21, 0.75)',
        borderRadius: 6,
        maxBarThickness: 34
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => '¥' + fmt(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Noto Sans JP' } } },
        y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#94a3b8', callback: v => '¥' + currencyFormatter.format(v) } }
      }
    }
  });
}

function renderStrengthChart() {
  if (typeof Chart === 'undefined') return;
  const months = lastNMonthKeys(6);
  const labels = months.map(m => m.slice(5) + '月');
  const values = months.map(m => {
    const [y, mo] = m.split('-').map(Number);
    const lastDay = daysInMonth(y, mo);
    const start = `${m}-01`;
    const end = `${m}-${pad2(lastDay)}`;
    const monthGaman = gamanData.filter(i => i.date >= start && i.date <= end).reduce((s, i) => s + i.price, 0);
    const monthExpense = expenseData.filter(i => i.date >= start && i.date <= end).reduce((s, i) => s + i.price, 0)
      + useData.filter(i => i.date >= start && i.date <= end).reduce((s, i) => s + i.price, 0);
    return monthExpense > 0 ? Math.round((monthGaman / monthExpense) * 1000) / 10 : 0;
  });

  const ctx = document.getElementById('ganmanStrengthChart').getContext('2d');
  if (strengthChart) strengthChart.destroy();
  strengthChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.15)',
        fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: '#3b82f6'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.raw + '%' } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Noto Sans JP' } } },
        y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#94a3b8', callback: v => v + '%' } }
      }
    }
  });
}

function renderMetricManageUI(metrics) {
  const list = document.getElementById('metricManageList');
  list.innerHTML = metrics.map(m => `
    <div class="metric-manage-item">
      <span>${escapeHTML(m.label)}${m.custom ? '<span class="tag-custom">合成</span>' : ''}</span>
      <button class="del-metric" data-key="${m.key}" data-custom="${m.custom}">削除</button>
    </div>`).join('');
  list.querySelectorAll('.del-metric').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const isCustom = btn.dataset.custom === 'true';
      if (isCustom) {
        metricsConfig.custom = metricsConfig.custom.filter(c => c.id !== key);
      } else {
        if (!metricsConfig.hiddenBase.includes(key)) metricsConfig.hiddenBase.push(key);
      }
      saveAll();
      renderDataTab();
    });
  });

  // 合成指標の部品ピッカー
  const picker = document.getElementById('comboComponentPicker');
  picker.innerHTML = metrics.map(m => `<div class="chip-option" data-key="${m.key}">${escapeHTML(m.label)}</div>`).join('');
  const selected = new Set();
  picker.querySelectorAll('.chip-option').forEach(chip => {
    chip.addEventListener('click', () => {
      const key = chip.dataset.key;
      if (selected.has(key)) { selected.delete(key); chip.classList.remove('selected'); }
      else { selected.add(key); chip.classList.add('selected'); }
    });
  });

  const comboForm = document.getElementById('comboMetricForm');
  comboForm.onsubmit = e => {
    e.preventDefault();
    const name = document.getElementById('comboName').value.trim();
    if (!name || selected.size < 2) {
      alert('指標名を入力し、合計する指標を2つ以上選択してください。');
      return;
    }
    metricsConfig.custom.push({ id: 'combo_' + genId(), name, components: Array.from(selected) });
    saveAll();
    document.getElementById('comboName').value = '';
    renderDataTab();
  };
}

/* ---------------------------------------------------------
   10. タイトル編集
--------------------------------------------------------- */
document.getElementById('appTitle').textContent = appTitle;
document.title = appTitle;
document.getElementById('editTitleBtn').addEventListener('click', () => {
  openModal(`
    <h3>タイトルを編集</h3>
    <div class="form-group"><input type="text" id="titleInput" value="${escapeHTML(appTitle)}"></div>
    <div class="modal-actions"><button class="btn-primary accent-gaman-bg" id="titleSaveBtn"><span>保存</span></button></div>
  `);
  document.getElementById('titleSaveBtn').addEventListener('click', () => {
    const val = document.getElementById('titleInput').value.trim();
    if (val) {
      appTitle = val;
      saveAll();
      document.getElementById('appTitle').textContent = appTitle;
      document.title = appTitle;
    }
    closeModal();
  });
});

/* ---------------------------------------------------------
   11. 初期化
--------------------------------------------------------- */
function init() {
  ensureFixedCostsGenerated();
  refreshMethodSelects();
  renderGamanTab();
  renderUseTab();
  renderKakeiboTab();
  renderInvestTab();
}

// PWA: register service worker for fast reloads (best-effort)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

init();

});
