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
  creditGroupChecks: 'creditGroupChecks',
  growthStages: 'growthStages',
  appTitle: 'appTitle',
  fixedLog: 'generatedFixedLog'
};

const CATEGORY_LABEL = { tsumitate: 'NISA（積立）', seicho: 'NISA（成長）', ideco: 'iDeCo' };
const DEFAULT_CREDIT_NAMES = ['PayPay', '楽天', 'UFJ'];

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
const addMonths = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
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

// 決済媒体: 旧形式（文字列配列 / credit フラグのみの旧オブジェクト形式）からの移行に対応
function loadPaymentMethods() {
  const raw = load(KEYS.methods, null);
  const withDefaults = (name, overrides = {}) => Object.assign(
    { name, credit: DEFAULT_CREDIT_NAMES.includes(name), closingMode: 'monthEnd', closingDay: null },
    overrides
  );
  if (!raw || raw.length === 0) {
    return [
      withDefaults('現金'),
      withDefaults('PayPay'),
      withDefaults('楽天'),
      withDefaults('UFJ', { closingMode: 'custom', closingDay: 15 })
    ];
  }
  if (typeof raw[0] === 'string') {
    return raw.map(name => withDefaults(name, name === 'UFJ' ? { closingMode: 'custom', closingDay: 15 } : {}));
  }
  // 既存のオブジェクト形式（closingMode/closingDay が無い旧バージョン）を補完
  return raw.map(m => ({
    name: m.name,
    credit: !!m.credit,
    closingMode: m.closingMode || 'monthEnd',
    closingDay: m.closingDay != null ? m.closingDay : null
  }));
}
let paymentMethods = loadPaymentMethods();

let incomeData = load(KEYS.income, []);
let expenseData = load(KEYS.expense, []);
let fixedCosts = load(KEYS.fixed, []);
let investData = load(KEYS.invest, []);
let investFixed = load(KEYS.investFixed, []);
let metricsConfig = load(KEYS.metricsConfig, { custom: [], hiddenBase: [] });
let creditGroupChecks = load(KEYS.creditGroupChecks, {});
let appTitle = load(KEYS.appTitle, '家計簿');

let useViewMonth = currentMonthKey();
let kakeiboViewMonth = currentMonthKey();
let dataViewMonth = currentMonthKey();

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
  save(KEYS.creditGroupChecks, creditGroupChecks);
  save(KEYS.growthStages, growthStages);
  save(KEYS.appTitle, appTitle);
}

function isCreditMethod(methodName) {
  const pm = paymentMethods.find(p => p.name === methodName);
  return pm ? !!pm.credit : false;
}
function methodConfigOf(methodName) {
  return paymentMethods.find(p => p.name === methodName);
}
// 締め日設定に応じた表示ラベル（例: 「月末締め」「15日締め」）
function methodSettlementLabel(pm) {
  if (!pm || !pm.credit) return '';
  if (pm.closingMode === 'custom' && pm.closingDay) return `${pm.closingDay}日締め`;
  return '月末締め';
}
// 使用タブの記録がクレジット決済媒体の場合、締め日設定に応じて「どの月分の利用か（利用計上月）」を決める
// - 月末締め: 利用した月がそのまま計上月（支払いはその翌月）
// - 日付指定（締め日D）: 利用日が D 以前ならその月が計上月、D を過ぎていれば翌月が計上月
//   （例: 締め日15日の場合、8/16〜9/15の利用は「9月分」、9/16の利用は「10月分」）
function usageAttributionMonthOf(item) {
  const pm = methodConfigOf(item.method);
  if (!pm || !pm.credit) return monthKeyOf(item.date);
  if (pm.closingMode === 'custom' && pm.closingDay) {
    const d = parseInt(item.date.split('-')[2], 10);
    const D = parseInt(pm.closingDay, 10);
    return addMonths(monthKeyOf(item.date), d <= D ? 0 : 1);
  }
  return monthKeyOf(item.date);
}
// 家計簿上の支出計上月（実際の引き落とし月）＝利用計上月の翌月
function settlementMonthOf(item) {
  return addMonths(usageAttributionMonthOf(item), 1);
}
function settlementDateOf(item) {
  const sm = settlementMonthOf(item);
  if (sm === monthKeyOf(item.date)) return item.date;
  const [y, m] = sm.split('-').map(Number);
  const day = Math.min(parseInt(item.date.split('-')[2], 10), daysInMonth(y, m));
  return `${sm}-${pad2(day)}`;
}
function usageAttributionDateOf(item) {
  const am = usageAttributionMonthOf(item);
  if (am === monthKeyOf(item.date)) return item.date;
  const [y, m] = am.split('-').map(Number);
  const day = Math.min(parseInt(item.date.split('-')[2], 10), daysInMonth(y, m));
  return `${am}-${pad2(day)}`;
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

// 汎用: 項目編集モーダル（項目名・金額・日付・メモ [・決済媒体]）
function openEditItemModal({ title, name, price, date, method, memo, onSave, onDelete }) {
  const methodOptions = method !== undefined
    ? `<div class="form-group"><label>決済媒体</label><select id="mf_method">${paymentMethods.map(m => `<option value="${escapeHTML(m.name)}" ${m.name === method ? 'selected' : ''}>${escapeHTML(m.name)}${m.credit ? `（${methodSettlementLabel(m)}）` : ''}</option>`).join('')}</select></div>`
    : '';
  openModal(`
    <h3>${escapeHTML(title)}</h3>
    <div class="form-group"><label>項目</label><input type="text" id="mf_name" value="${escapeHTML(name)}"></div>
    <div class="form-row">
      <div class="form-group half"><label>金額 (¥)</label><input type="number" id="mf_price" value="${price}" min="1"></div>
      <div class="form-group half"><label>日付</label><input type="date" id="mf_date" value="${date}"></div>
    </div>
    ${methodOptions}
    <div class="form-group"><label>メモ</label><input type="text" id="mf_memo" value="${escapeHTML(memo || '')}" placeholder="任意"></div>
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
    const newMemo = document.getElementById('mf_memo').value.trim();
    onSave({ name: newName, price: newPrice, date: newDate, method: newMethod, memo: newMemo });
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
   - 家計簿の固定費は「表示中の月」に応じて生成する（支出日を迎えていなくても
     その月の記録として計上されるように、月を移動するたびに生成される）
   - 投資の固定費はこれまで通り実際の当月のみ生成する
--------------------------------------------------------- */
function ensureKakeiboFixedForMonth(ym) {
  const log = load(KEYS.fixedLog, []);
  const [y, m] = ym.split('-').map(Number);
  const lastDay = daysInMonth(y, m);
  let changed = false;

  fixedCosts.forEach(fc => {
    const logKey = `k_${fc.id}_${ym}`;
    if (!log.includes(logKey)) {
      const day = Math.min(parseInt(fc.day, 10), lastDay);
      const dateStr = `${ym}-${pad2(day)}`;
      const amount = fc.type === 'expense' ? (fc.totalPrice != null ? fc.totalPrice : fc.price) : fc.price;
      const entry = {
        id: genId(), name: fc.name, price: amount, date: dateStr, checked: false, fixedId: fc.id,
        memo: fc.memo || '', isSubscription: !!fc.isSubscription, options: fc.options || []
      };
      if (fc.type === 'income') {
        incomeData.push(entry);
      } else {
        entry.method = fc.method || (paymentMethods[0] && paymentMethods[0].name);
        expenseData.push(entry);
      }
      log.push(logKey);
      changed = true;
    }
  });

  if (changed) {
    saveAll();
    save(KEYS.fixedLog, log);
  }
}

function ensureInvestFixedGenerated() {
  const log = load(KEYS.fixedLog, []);
  const ym = currentMonthKey();
  const [y, m] = ym.split('-').map(Number);
  const lastDay = daysInMonth(y, m);
  let changed = false;

  investFixed.forEach(fc => {
    const logKey = `i_${fc.id}_${ym}`;
    if (!log.includes(logKey)) {
      const day = Math.min(parseInt(fc.day, 10), lastDay);
      const dateStr = `${ym}-${pad2(day)}`;
      investData.push({ id: genId(), category: fc.category, name: fc.name, price: fc.price, date: dateStr, fixedId: fc.id, memo: fc.memo || '' });
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
  const memo = document.getElementById('gamanMemo').value.trim();
  if (!name || !price || !date) return;
  gamanData.push({ id: genId(), name, price, date, memo });
  saveAll();
  document.getElementById('gamanName').value = '';
  document.getElementById('gamanPrice').value = '';
  document.getElementById('gamanMemo').value = '';
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

function renderHistoryGrouped(container, items, { onItemClick, priceClass = null, renderMeta = null, groupKeyFn = null } = {}) {
  container.innerHTML = '';
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">まだ記録がありません。</div>`;
    return;
  }
  const keyFn = groupKeyFn || (item => monthKeyOf(item.date));
  const groups = {};
  items.forEach(item => {
    const key = keyFn(item);
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
      const memoHTML = item.memo ? `<div class="item-memo">${escapeHTML(item.memo)}</div>` : '';
      const pc = priceClass ? priceClass(item) : '';
      return `
        <li class="history-item" data-id="${item.id}">
          <div class="item-info">
            <div class="item-name">${escapeHTML(item.name)}</div>
            ${meta}
            ${memoHTML}
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

// 節約のモチベーション：累計我慢金額に応じて変化する「進化」ビジュアル
// プランクトン→魚→トカゲ→犬→猿→人間→ゴジラ、と具体的な生き物の変化で表現。
// アイコンは SVG のプリセットから選択、金額のしきい値・ラベルは自由に編集可能（growthStages に保存）
const ICON_LIBRARY = {
  plankton: '<svg viewBox="0 0 100 100" fill="currentColor"><ellipse cx="50" cy="55" rx="20" ry="16"/><circle cx="43" cy="50" r="3" fill="#fdf8f0"/><path d="M30 42 Q20 30 14 34" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M68 42 Q78 30 84 34" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M34 68 Q24 80 18 78" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M66 68 Q76 80 82 78" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M50 36 Q46 24 50 16" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
  fish: '<svg viewBox="0 0 100 100" fill="currentColor"><path d="M18 50 Q35 24 66 34 Q82 40 88 50 Q82 60 66 66 Q35 76 18 50 Z"/><path d="M14 50 L0 34 L0 66 Z"/><circle cx="62" cy="43" r="3.5" fill="#fdf8f0"/><path d="M48 34 L54 20 L62 34 Z" opacity="0.9"/></svg>',
  lizard: '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 55 Q35 40 52 48 Q68 55 82 46"/><path d="M82 46 Q94 40 97 28"/><path d="M34 60 L27 78"/><path d="M44 62 L39 80"/><path d="M60 60 L66 78"/><path d="M70 56 L78 74"/><circle cx="16" cy="55" r="1" fill="currentColor"/></svg>',
  dog: '<svg viewBox="0 0 100 100" fill="currentColor"><ellipse cx="46" cy="58" rx="26" ry="15"/><circle cx="74" cy="44" r="13"/><path d="M66 33 L60 20 L71 29 Z"/><path d="M80 32 L88 20 L83 32 Z"/><path d="M20 58 L13 76" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M32 65 L28 82" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M56 66 L54 82" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M66 62 L70 80" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M22 48 Q8 40 12 28" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round"/></svg>',
  monkey: '<svg viewBox="0 0 100 100" fill="currentColor"><circle cx="50" cy="32" r="15"/><circle cx="35" cy="26" r="6"/><circle cx="65" cy="26" r="6"/><ellipse cx="50" cy="64" rx="19" ry="21"/><path d="M32 58 Q16 64 16 80" stroke="currentColor" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M68 58 Q84 64 84 80" stroke="currentColor" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M40 83 L37 96" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M60 83 L63 96" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>',
  human: '<svg viewBox="0 0 100 100" fill="currentColor"><circle cx="50" cy="20" r="10.5"/><path d="M38 34 h24 a6 6 0 016 6 v18 a6 6 0 01-6 6 h-24 a6 6 0 01-6-6 v-18 a6 6 0 016-6 z"/><path d="M35 39 L20 58" stroke="currentColor" stroke-width="8" stroke-linecap="round"/><path d="M65 39 L80 58" stroke="currentColor" stroke-width="8" stroke-linecap="round"/><path d="M43 64 L37 94" stroke="currentColor" stroke-width="9" stroke-linecap="round"/><path d="M57 64 L63 94" stroke="currentColor" stroke-width="9" stroke-linecap="round"/></svg>',
  godzilla: '<svg viewBox="0 0 100 100" fill="currentColor"><ellipse cx="48" cy="62" rx="24" ry="26"/><path d="M65 70 Q88 78 92 95" stroke="currentColor" stroke-width="12" fill="none" stroke-linecap="round"/><circle cx="42" cy="30" r="14"/><path d="M32 20 L27 8 L38 16 Z"/><path d="M43 15 L43 3 L52 12 Z"/><path d="M53 18 L58 6 L64 17 Z"/><path d="M28 34 L20 42" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M56 34 L64 42" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M35 84 L28 98" stroke="currentColor" stroke-width="10" stroke-linecap="round"/><path d="M58 86 L66 99" stroke="currentColor" stroke-width="10" stroke-linecap="round"/></svg>'
};
const ICON_ORDER = ['plankton', 'fish', 'lizard', 'dog', 'monkey', 'human', 'godzilla'];

function defaultGrowthStages() {
  return [
    { id: genId(), min: 0, iconId: 'plankton', label: 'プランクトン' },
    { id: genId(), min: 1000, iconId: 'fish', label: '魚' },
    { id: genId(), min: 10000, iconId: 'lizard', label: 'トカゲ' },
    { id: genId(), min: 50000, iconId: 'dog', label: '犬' },
    { id: genId(), min: 200000, iconId: 'monkey', label: '猿' },
    { id: genId(), min: 500000, iconId: 'human', label: '人間' },
    { id: genId(), min: 1000000, iconId: 'godzilla', label: 'ゴジラ' }
  ];
}

// 旧デザイン（人型のみ）からの移行: アイコンIDを新セットへ置き換え、
// ラベルが旧デフォルトのまま（未編集）であれば新しいラベルに更新する。ユーザーが編集済みのラベルはそのまま残す。
const OLD_TO_NEW_ICON = { crouch: 'plankton', hunch: 'fish', semi: 'lizard', upright: 'dog', stand: 'monkey', triumph: 'human', victory: 'godzilla' };
const OLD_DEFAULT_LABEL_BY_ICON = { crouch: 'スタート', hunch: '一歩ずつ', semi: '前進中', upright: '自立', stand: '堂々', triumph: '達成', victory: '頂点' };
function migrateGrowthStages(stages) {
  return stages.map(s => {
    const newIcon = OLD_TO_NEW_ICON[s.iconId];
    if (!newIcon) return s;
    const wasDefaultLabel = OLD_DEFAULT_LABEL_BY_ICON[s.iconId] === s.label;
    const defaults = defaultGrowthStages().find(d => d.iconId === newIcon);
    return { ...s, iconId: newIcon, label: wasDefaultLabel && defaults ? defaults.label : s.label };
  });
}
const loadedGrowthStages = load(KEYS.growthStages, null);
let growthStages = loadedGrowthStages ? migrateGrowthStages(loadedGrowthStages) : defaultGrowthStages();

function sortedGrowthStages() {
  return [...growthStages].sort((a, b) => a.min - b.min);
}
function getGrowthInfo(total) {
  const stages = sortedGrowthStages();
  let idx = 0;
  for (let i = 0; i < stages.length; i++) {
    if (total >= stages[i].min) idx = i;
  }
  const stage = stages[idx];
  const next = stages[idx + 1];
  const pct = next ? Math.min(100, ((total - stage.min) / (next.min - stage.min)) * 100) : 100;
  return { stage, next, pct };
}
function iconSvg(iconId) {
  return ICON_LIBRARY[iconId] || ICON_LIBRARY.plankton;
}

document.getElementById('editGrowthBtn').addEventListener('click', () => openGrowthSettingsModal());

function openGrowthSettingsModal() {
  let editingId = null;
  let selectedIcon = 'plankton';

  const renderList = () => sortedGrowthStages().map(s => `
    <div class="metric-manage-item">
      <div class="growth-stage-row">
        <div class="stage-icon-preview">${iconSvg(s.iconId)}</div>
        <div class="stage-info">
          <span class="stage-name">${escapeHTML(s.label)}</span>
          <span class="stage-amount">¥${fmt(s.min)}以上</span>
        </div>
      </div>
      <span class="method-row-actions">
        <button class="btn-text edit-stage" data-id="${s.id}">編集</button>
        <button class="del-metric del-stage" data-id="${s.id}" ${growthStages.length <= 1 ? 'disabled' : ''}>削除</button>
      </span>
    </div>`).join('');

  const iconPickerHTML = () => ICON_ORDER.map(id => `
    <div class="icon-grid-option ${id === selectedIcon ? 'selected' : ''}" data-icon="${id}">${ICON_LIBRARY[id]}</div>
  `).join('');

  const formTitle = () => editingId === null ? '新しい段階を追加' : '段階を編集';
  const formHTML = () => {
    const s = editingId === null ? { label: '', min: '' } : growthStages.find(g => g.id === editingId);
    return `
    <div class="form-group"><label>${formTitle()}</label></div>
    <div class="form-group">
      <label for="stageLabelInput">名前</label>
      <input type="text" id="stageLabelInput" placeholder="例: がんばり中" value="${escapeHTML(s.label)}">
    </div>
    <div class="form-group">
      <label for="stageMinInput">しきい値（この金額以上で到達）</label>
      <input type="number" id="stageMinInput" min="0" placeholder="10000" value="${s.min}">
    </div>
    <div class="form-group">
      <label>アイコン</label>
      <div class="icon-grid-picker" id="iconGridPicker">${iconPickerHTML()}</div>
    </div>
    <div class="modal-actions">
      ${editingId !== null ? '<button type="button" class="btn-danger" id="cancelEditStageBtn">キャンセル</button>' : ''}
      <button class="btn-primary accent-gaman-bg" id="saveStageBtn"><span>${editingId === null ? '追加' : '更新'}</span></button>
    </div>
  `;
  };

  openModal(`
    <h3>育成の設定</h3>
    <p class="hint-text">今月の我慢金額に応じて表示が変化します（毎月リセットされます）。段階・金額・アイコンは自由に編集できます。</p>
    <div id="stagesListWrap" class="metric-manage-list">${renderList()}</div>
    <div id="stageFormWrap">${formHTML()}</div>
    <div class="modal-actions"><button class="btn-text" id="growthCloseBtn">閉じる</button></div>
  `);

  function wireForm() {
    document.getElementById('iconGridPicker').querySelectorAll('.icon-grid-option').forEach(opt => {
      opt.addEventListener('click', () => {
        selectedIcon = opt.dataset.icon;
        document.getElementById('iconGridPicker').querySelectorAll('.icon-grid-option').forEach(o => o.classList.toggle('selected', o.dataset.icon === selectedIcon));
      });
    });
    document.getElementById('saveStageBtn').addEventListener('click', () => {
      const label = document.getElementById('stageLabelInput').value.trim();
      const min = parseInt(document.getElementById('stageMinInput').value, 10);
      if (!label || isNaN(min) || min < 0) return;
      if (editingId === null) {
        growthStages.push({ id: genId(), min, iconId: selectedIcon, label });
      } else {
        const s = growthStages.find(g => g.id === editingId);
        s.label = label; s.min = min; s.iconId = selectedIcon;
        editingId = null;
      }
      saveAll();
      renderGamanTab();
      rerender();
    });
    const cancelBtn = document.getElementById('cancelEditStageBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { editingId = null; selectedIcon = 'plankton'; rerender(); });
  }

  function rerender() {
    document.getElementById('stagesListWrap').innerHTML = renderList();
    document.getElementById('stageFormWrap').innerHTML = formHTML();
    document.getElementById('stagesListWrap').querySelectorAll('.del-stage').forEach(btn => {
      btn.addEventListener('click', () => {
        growthStages = growthStages.filter(g => g.id !== btn.dataset.id);
        if (editingId === btn.dataset.id) editingId = null;
        saveAll();
        renderGamanTab();
        rerender();
      });
    });
    document.getElementById('stagesListWrap').querySelectorAll('.edit-stage').forEach(btn => {
      btn.addEventListener('click', () => {
        editingId = btn.dataset.id;
        const s = growthStages.find(g => g.id === editingId);
        selectedIcon = s ? s.iconId : 'plankton';
        rerender();
      });
    });
    wireForm();
  }
  rerender();
  document.getElementById('growthCloseBtn').addEventListener('click', closeModal);
}

let gamanMonthlyChart = null;

function renderGamanTab() {
  const total = gamanData.reduce((s, i) => s + i.price, 0);
  document.getElementById('gamanTotal').textContent = fmt(total);

  // 今月の我慢額（育成ビジュアルは毎月リセットされ、今月分の金額のみで判定する）
  const thisMonth = currentMonthKey();
  const lastMonth = addMonths(thisMonth, -1);
  const thisMonthTotal = gamanData.filter(i => monthKeyOf(i.date) === thisMonth).reduce((s, i) => s + i.price, 0);
  const lastMonthTotal = gamanData.filter(i => monthKeyOf(i.date) === lastMonth).reduce((s, i) => s + i.price, 0);

  // 育成ビジュアル（今月の我慢額ベース）
  const { stage, next, pct } = getGrowthInfo(thisMonthTotal);
  document.getElementById('growthEmoji').innerHTML = iconSvg(stage.iconId);
  document.getElementById('growthLabel').textContent = stage.label;
  document.getElementById('growthSub').textContent = next
    ? `次の「${next.label}」まであと¥${fmt(next.min - thisMonthTotal)}（今月分）`
    : '今月、最高段階に到達しました！';
  document.getElementById('growthProgressBar').style.width = pct + '%';

  // 先月との比較
  const diff = thisMonthTotal - lastMonthTotal;
  const compareEl = document.getElementById('gamanMonthCompare');
  if (lastMonthTotal === 0 && thisMonthTotal === 0) {
    compareEl.textContent = '今月も我慢を記録してみましょう';
  } else if (diff > 0) {
    compareEl.textContent = `先月より¥${fmt(diff)}多く我慢できています！このペースを続けましょう 👏`;
  } else if (diff < 0) {
    compareEl.textContent = `先月より¥${fmt(Math.abs(diff))}少なめです。今月も一つずつ記録していきましょう`;
  } else {
    compareEl.textContent = '先月と同じペースです';
  }

  renderGamanMonthlyChart();

  renderHistoryGrouped(document.getElementById('gamanHistory'), gamanData, {
    onItemClick: id => {
      const item = gamanData.find(i => i.id === id);
      if (!item) return;
      openEditItemModal({
        title: '我慢の記録を編集',
        name: item.name, price: item.price, date: item.date, memo: item.memo,
        onSave: v => {
          Object.assign(item, v);
          delete item.method;
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

function renderGamanMonthlyChart() {
  if (typeof Chart === 'undefined') return;
  const months = lastNMonthKeysEndingAt(currentMonthKey(), 6);
  const labels = months.map(m => m.slice(5) + '月');
  const values = months.map(m => gamanData.filter(i => monthKeyOf(i.date) === m).reduce((s, i) => s + i.price, 0));

  const ctx = document.getElementById('gamanMonthlyChart').getContext('2d');
  if (gamanMonthlyChart) gamanMonthlyChart.destroy();
  gamanMonthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: 'rgba(79, 127, 181, 0.75)',
        borderRadius: 6,
        maxBarThickness: 34
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => '¥' + fmt(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8a7c6c', font: { family: 'Noto Sans JP' } } },
        y: { grid: { color: 'rgba(90,70,45,0.08)' }, ticks: { color: '#8a7c6c', callback: v => '¥' + currencyFormatter.format(v) } }
      }
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
    sel.innerHTML = paymentMethods.map(m => `<option value="${escapeHTML(m.name)}">${escapeHTML(m.name)}${m.credit ? `（${methodSettlementLabel(m)}）` : ''}</option>`).join('');
    if (paymentMethods.some(m => m.name === prev)) sel.value = prev;
  });
}
refreshMethodSelects();

document.getElementById('editMethodsBtn').addEventListener('click', () => {
  openMethodsModal();
});

function openMethodsModal() {
  let editingIdx = null;

  const renderList = () => paymentMethods.map((m, idx) => `
    <div class="metric-manage-item">
      <span>${escapeHTML(m.name)} ${m.credit ? `<span class="credit-tag">${methodSettlementLabel(m)}</span>` : ''}</span>
      <span class="method-row-actions">
        <button class="btn-text edit-metric" data-idx="${idx}">編集</button>
        <button class="del-metric" data-idx="${idx}" ${paymentMethods.length <= 1 ? 'disabled' : ''}>削除</button>
      </span>
    </div>`).join('');

  const formTitle = () => editingIdx === null ? '新しい決済媒体を追加' : `「${escapeHTML(paymentMethods[editingIdx].name)}」を編集`;
  const formHTML = () => {
    const m = editingIdx === null ? { name: '', credit: false, closingMode: 'monthEnd', closingDay: 15 } : paymentMethods[editingIdx];
    return `
    <div class="form-group">
      <label id="methodFormTitle">${formTitle()}</label>
      <div class="limit-editor-row">
        <input type="text" id="newMethodInput" placeholder="例: 交通系IC" value="${escapeHTML(m.name)}" ${editingIdx !== null ? 'disabled' : ''}>
        <button class="btn-small" id="addMethodBtn">${editingIdx === null ? '追加' : '更新'}</button>
      </div>
    </div>
    <div class="form-group checkbox-group">
      <label class="checkbox-label"><input type="checkbox" id="newMethodCredit" ${m.credit ? 'checked' : ''}><span>クレジットカード（利用月より後の月に支出として計上）</span></label>
    </div>
    <div id="closingConfigWrap" class="options-wrap ${m.credit ? '' : 'hidden'}">
      <label>締め日の設定</label>
      <select id="closingModeSelect">
        <option value="monthEnd" ${m.closingMode !== 'custom' ? 'selected' : ''}>月末締め（利用月の翌月に計上）</option>
        <option value="custom" ${m.closingMode === 'custom' ? 'selected' : ''}>日付を指定する</option>
      </select>
      <div id="closingDayWrap" class="form-group ${m.closingMode === 'custom' ? '' : 'hidden'}" style="margin-top:8px;">
        <label for="closingDayInput">毎月の締め日（例: 15日締めなら「15」）</label>
        <input type="number" id="closingDayInput" min="1" max="31" value="${m.closingDay || 15}">
        <p class="hint-text">締め日以前の利用は翌月払い、締め日を過ぎた利用は翌々月払いになります。</p>
      </div>
    </div>
    ${editingIdx !== null ? '<button type="button" class="btn-text" id="cancelEditMethodBtn">編集をキャンセル</button>' : ''}
  `;
  };

  openModal(`
    <h3>決済媒体を編集</h3>
    <div id="methodsListWrap" class="metric-manage-list">${renderList()}</div>
    <div id="methodFormWrap">${formHTML()}</div>
    <div class="modal-actions"><button class="btn-primary accent-use-bg" id="methodsCloseBtn"><span>閉じる</span></button></div>
  `);

  function wireForm() {
    const creditCheckbox = document.getElementById('newMethodCredit');
    creditCheckbox.addEventListener('change', () => {
      document.getElementById('closingConfigWrap').classList.toggle('hidden', !creditCheckbox.checked);
    });
    const closingModeSelect = document.getElementById('closingModeSelect');
    closingModeSelect.addEventListener('change', () => {
      document.getElementById('closingDayWrap').classList.toggle('hidden', closingModeSelect.value !== 'custom');
    });
    document.getElementById('addMethodBtn').addEventListener('click', () => {
      const input = document.getElementById('newMethodInput');
      const val = input.value.trim();
      const credit = document.getElementById('newMethodCredit').checked;
      const closingMode = document.getElementById('closingModeSelect').value;
      const closingDay = closingMode === 'custom' ? (parseInt(document.getElementById('closingDayInput').value, 10) || 15) : null;
      if (editingIdx === null) {
        if (!val || paymentMethods.some(m => m.name === val)) return;
        paymentMethods.push({ name: val, credit, closingMode, closingDay });
      } else {
        const m = paymentMethods[editingIdx];
        m.credit = credit;
        m.closingMode = closingMode;
        m.closingDay = closingDay;
        editingIdx = null;
      }
      saveAll();
      refreshMethodSelects();
      rerender();
    });
    const cancelBtn = document.getElementById('cancelEditMethodBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { editingIdx = null; rerender(); });
  }

  function rerender() {
    document.getElementById('methodsListWrap').innerHTML = renderList();
    document.getElementById('methodFormWrap').innerHTML = formHTML();
    document.getElementById('methodsListWrap').querySelectorAll('.del-metric').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        paymentMethods.splice(idx, 1);
        if (editingIdx === idx) editingIdx = null;
        saveAll();
        refreshMethodSelects();
        rerender();
      });
    });
    document.getElementById('methodsListWrap').querySelectorAll('.edit-metric').forEach(btn => {
      btn.addEventListener('click', () => {
        editingIdx = parseInt(btn.dataset.idx, 10);
        rerender();
      });
    });
    wireForm();
  }
  rerender();
  document.getElementById('methodsCloseBtn').addEventListener('click', closeModal);
}

useForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('useName').value.trim();
  const price = parseInt(document.getElementById('usePrice').value, 10);
  const date = document.getElementById('useDate').value;
  const method = document.getElementById('useMethod').value;
  const memo = document.getElementById('useMemo').value.trim();
  if (!name || !price || !date) return;
  useData.push({ id: genId(), name, price, date, method, memo, checked: false });
  saveAll();
  document.getElementById('useName').value = '';
  document.getElementById('usePrice').value = '';
  document.getElementById('useMemo').value = '';
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
  useLimits[useViewMonth] = val;
  saveAll();
  renderUseTab();
});

document.getElementById('usePrevMonth').addEventListener('click', () => { useViewMonth = addMonths(useViewMonth, -1); renderUseTab(); });
document.getElementById('useNextMonth').addEventListener('click', () => { useViewMonth = addMonths(useViewMonth, 1); renderUseTab(); });

function openUseEditModal(id) {
  const item = useData.find(i => i.id === id);
  if (!item) return;
  openEditItemModal({
    title: '使用の記録を編集',
    name: item.name, price: item.price, date: item.date, method: item.method, memo: item.memo,
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
  document.getElementById('useMonthLabel').textContent = formatMonthLabel(useViewMonth);
  const ym = useViewMonth;
  // クレジット決済は締め日設定に応じた「利用計上月」でその月の使用として扱う（現金は利用日そのまま）
  const monthItems = useData.filter(i => usageAttributionMonthOf(i) === ym);
  const monthTotal = monthItems.reduce((s, i) => s + i.price, 0);
  const limit = useLimits[ym] || 0;
  const remaining = limit - monthTotal;

  document.getElementById('useMonthTotal').textContent = fmt(monthTotal);
  const remEl = document.getElementById('useRemaining');
  remEl.textContent = (remaining < 0 ? '-' : '') + fmt(Math.abs(remaining));
  remEl.style.color = remaining < 0 ? 'var(--danger)' : 'var(--success)';

  const pct = limit > 0 ? Math.min(100, (monthTotal / limit) * 100) : 0;
  const bar = document.getElementById('useProgressBar');
  bar.style.width = pct + '%';
  bar.classList.toggle('over', limit > 0 && monthTotal > limit);

  document.getElementById('useLimitInput').value = limit || '';

  renderHistoryGrouped(document.getElementById('useHistory'), monthItems, {
    onItemClick: openUseEditModal,
    groupKeyFn: item => usageAttributionMonthOf(item),
    renderMeta: item => `<div class="item-meta">${item.date}<span class="method-tag">${escapeHTML(item.method || '')}</span>${isCreditMethod(item.method) ? `<span class="credit-tag">${methodSettlementLabel(methodConfigOf(item.method))}</span>` : ''}</div>`
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
  const memo = document.getElementById('incomeMemo').value.trim();
  if (!name || !price || !date) return;
  incomeData.push({ id: genId(), name, price, date, checked: false, memo });
  saveAll();
  document.getElementById('incomeName').value = '';
  document.getElementById('incomePrice').value = '';
  document.getElementById('incomeMemo').value = '';
  renderKakeiboTab();
  renderDataTabIfActive();
});

document.getElementById('expenseForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('expenseName').value.trim();
  const price = parseInt(document.getElementById('expensePrice').value, 10);
  const date = document.getElementById('expenseDate').value;
  const method = document.getElementById('expenseMethod').value;
  const memo = document.getElementById('expenseMemo').value.trim();
  if (!name || !price || !date) return;
  expenseData.push({ id: genId(), name, price, date, method, checked: false, memo });
  saveAll();
  document.getElementById('expenseName').value = '';
  document.getElementById('expensePrice').value = '';
  document.getElementById('expenseMemo').value = '';
  renderKakeiboTab();
  renderDataTabIfActive();
});

document.getElementById('kakeiboPrevMonth').addEventListener('click', () => { kakeiboViewMonth = addMonths(kakeiboViewMonth, -1); renderKakeiboTab(); });
document.getElementById('kakeiboNextMonth').addEventListener('click', () => { kakeiboViewMonth = addMonths(kakeiboViewMonth, 1); renderKakeiboTab(); });

/* ---- 固定費フォーム（メモ・サブスク・オプション） ---- */
let fixedOptionsState = [];

function updateFixedOptionsTotal() {
  const base = parseInt(document.getElementById('fixedPrice').value, 10) || 0;
  const optSum = fixedOptionsState.reduce((s, o) => s + (o.price || 0), 0);
  document.getElementById('fixedOptionsTotalDisplay').textContent = '¥' + fmt(base + optSum);
}
function renderFixedOptionsList() {
  const wrap = document.getElementById('fixedOptionsList');
  wrap.innerHTML = fixedOptionsState.map(opt => `
    <div class="option-row" data-id="${opt.id}">
      <input type="text" class="opt-name" placeholder="例: 4Kオプション" value="${escapeHTML(opt.name)}">
      <input type="number" class="opt-price" placeholder="500" min="0" value="${opt.price || ''}">
      <button type="button" class="remove-option" data-id="${opt.id}">×</button>
    </div>`).join('');
  wrap.querySelectorAll('.opt-name').forEach(inp => inp.addEventListener('input', e => {
    const id = e.target.closest('.option-row').dataset.id;
    const opt = fixedOptionsState.find(o => o.id === id);
    if (opt) opt.name = e.target.value;
  }));
  wrap.querySelectorAll('.opt-price').forEach(inp => inp.addEventListener('input', e => {
    const id = e.target.closest('.option-row').dataset.id;
    const opt = fixedOptionsState.find(o => o.id === id);
    if (opt) opt.price = parseInt(e.target.value, 10) || 0;
    updateFixedOptionsTotal();
  }));
  wrap.querySelectorAll('.remove-option').forEach(btn => btn.addEventListener('click', () => {
    fixedOptionsState = fixedOptionsState.filter(o => o.id !== btn.dataset.id);
    renderFixedOptionsList();
    updateFixedOptionsTotal();
  }));
}
document.getElementById('fixedAddOptionBtn').addEventListener('click', () => {
  fixedOptionsState.push({ id: genId(), name: '', price: 0 });
  renderFixedOptionsList();
});
document.getElementById('fixedPrice').addEventListener('input', updateFixedOptionsTotal);
document.getElementById('fixedIsSub').addEventListener('change', e => {
  document.getElementById('fixedOptionsWrap').classList.toggle('hidden', !e.target.checked);
  updateFixedOptionsTotal();
});
document.getElementById('fixedType').addEventListener('change', e => {
  const isExpense = e.target.value === 'expense';
  document.getElementById('fixedMethodWrap').style.display = isExpense ? 'flex' : 'none';
  document.getElementById('fixedSubWrap').style.display = isExpense ? 'flex' : 'none';
  if (!isExpense) {
    document.getElementById('fixedIsSub').checked = false;
    document.getElementById('fixedOptionsWrap').classList.add('hidden');
    fixedOptionsState = [];
    renderFixedOptionsList();
  }
});

document.getElementById('fixedForm').addEventListener('submit', e => {
  e.preventDefault();
  const type = document.getElementById('fixedType').value;
  const name = document.getElementById('fixedName').value.trim();
  const day = parseInt(document.getElementById('fixedDay').value, 10);
  const basePrice = parseInt(document.getElementById('fixedPrice').value, 10);
  const method = document.getElementById('fixedMethod').value;
  const memo = document.getElementById('fixedMemo').value.trim();
  const isSub = type === 'expense' && document.getElementById('fixedIsSub').checked;
  const options = isSub ? fixedOptionsState.filter(o => o.name.trim()).map(o => ({ id: o.id, name: o.name.trim(), price: o.price || 0 })) : [];
  if (!name || !day || !basePrice) return;
  const totalPrice = basePrice + options.reduce((s, o) => s + o.price, 0);
  fixedCosts.push({
    id: genId(), type, name, day, price: basePrice, totalPrice, memo,
    isSubscription: isSub, options, method: type === 'expense' ? method : undefined
  });
  saveAll();
  ensureKakeiboFixedForMonth(kakeiboViewMonth);
  document.getElementById('fixedDay').value = '';
  document.getElementById('fixedPrice').value = '';
  document.getElementById('fixedMemo').value = '';
  document.getElementById('fixedIsSub').checked = false;
  document.getElementById('fixedOptionsWrap').classList.add('hidden');
  fixedOptionsState = [];
  renderFixedOptionsList();
  updateFixedOptionsTotal();
  renderKakeiboTab();
  renderDataTabIfActive();
});

function openIncomeEditModal(id) {
  const item = incomeData.find(i => i.id === id);
  if (!item) return;
  openEditItemModal({
    title: '収入を編集', name: item.name, price: item.price, date: item.date, memo: item.memo,
    onSave: v => { Object.assign(item, v); saveAll(); renderKakeiboTab(); renderDataTabIfActive(); },
    onDelete: () => { incomeData = incomeData.filter(i => i.id !== id); saveAll(); renderKakeiboTab(); renderDataTabIfActive(); }
  });
}
function openExpenseEditModal(id) {
  const item = expenseData.find(i => i.id === id);
  if (!item) return;
  openEditItemModal({
    title: '支出を編集', name: item.name, price: item.price, date: item.date, method: item.method, memo: item.memo,
    onSave: v => { Object.assign(item, v); saveAll(); renderKakeiboTab(); renderDataTabIfActive(); },
    onDelete: () => { expenseData = expenseData.filter(i => i.id !== id); saveAll(); renderKakeiboTab(); renderDataTabIfActive(); }
  });
}

/* ---- 固定費 編集モーダル（メモ・サブスク・オプション対応） ---- */
function openFixedCostEditModal(fc) {
  const isExpense = fc.type === 'expense';
  let optionsState = (fc.options || []).map(o => ({ ...o }));

  const methodOptions = isExpense
    ? `<div class="form-group"><label>決済媒体</label><select id="fmf_method">${paymentMethods.map(m => `<option value="${escapeHTML(m.name)}" ${m.name === fc.method ? 'selected' : ''}>${escapeHTML(m.name)}${m.credit ? `（${methodSettlementLabel(m)}）` : ''}</option>`).join('')}</select></div>`
    : '';
  const subToggle = isExpense ? `
    <div class="form-group checkbox-group">
      <label class="checkbox-label"><input type="checkbox" id="fmf_isSub" ${fc.isSubscription ? 'checked' : ''}><span>サブスクとして管理する</span></label>
    </div>
    <div id="fmf_optionsWrap" class="options-wrap ${fc.isSubscription ? '' : 'hidden'}">
      <label>オプション</label>
      <div id="fmf_optionsList" class="options-list"></div>
      <button type="button" id="fmf_addOptionBtn" class="btn-text">＋ オプションを追加</button>
      <div class="options-total">基本料金＋オプション合計：<span id="fmf_optionsTotalDisplay">¥0</span></div>
    </div>` : '';

  openModal(`
    <h3>固定費を編集</h3>
    <div class="form-group"><label>項目</label><input type="text" id="fmf_name" value="${escapeHTML(fc.name)}"></div>
    <div class="form-row">
      <div class="form-group half"><label>毎月の日にち</label><input type="number" id="fmf_day" min="1" max="31" value="${fc.day}"></div>
      <div class="form-group half"><label>基本料金 (¥)</label><input type="number" id="fmf_price" min="1" value="${fc.price}"></div>
    </div>
    ${methodOptions}
    <div class="form-group"><label>メモ</label><input type="text" id="fmf_memo" value="${escapeHTML(fc.memo || '')}"></div>
    ${subToggle}
    <div class="modal-actions">
      <button class="btn-danger" id="fmf_delete">削除</button>
      <button class="btn-primary accent-kakeibo-bg" id="fmf_save"><span>保存</span></button>
    </div>
  `);

  function renderOptRows() {
    const wrap = document.getElementById('fmf_optionsList');
    if (!wrap) return;
    wrap.innerHTML = optionsState.map(opt => `
      <div class="option-row" data-id="${opt.id}">
        <input type="text" class="fmf-opt-name" value="${escapeHTML(opt.name)}" placeholder="オプション名">
        <input type="number" class="fmf-opt-price" value="${opt.price || ''}" placeholder="金額" min="0">
        <button type="button" class="remove-option" data-id="${opt.id}">×</button>
      </div>`).join('');
    wrap.querySelectorAll('.fmf-opt-name').forEach(inp => inp.addEventListener('input', e => {
      const id = e.target.closest('.option-row').dataset.id;
      const opt = optionsState.find(o => o.id === id);
      if (opt) opt.name = e.target.value;
    }));
    wrap.querySelectorAll('.fmf-opt-price').forEach(inp => inp.addEventListener('input', e => {
      const id = e.target.closest('.option-row').dataset.id;
      const opt = optionsState.find(o => o.id === id);
      if (opt) opt.price = parseInt(e.target.value, 10) || 0;
      updateTotal();
    }));
    wrap.querySelectorAll('.remove-option').forEach(btn => btn.addEventListener('click', () => {
      optionsState = optionsState.filter(o => o.id !== btn.dataset.id);
      renderOptRows();
      updateTotal();
    }));
  }
  function updateTotal() {
    const disp = document.getElementById('fmf_optionsTotalDisplay');
    if (!disp) return;
    const base = parseInt(document.getElementById('fmf_price').value, 10) || 0;
    const sum = optionsState.reduce((s, o) => s + (o.price || 0), 0);
    disp.textContent = '¥' + fmt(base + sum);
  }
  if (isExpense) {
    renderOptRows();
    updateTotal();
    document.getElementById('fmf_isSub').addEventListener('change', e => {
      document.getElementById('fmf_optionsWrap').classList.toggle('hidden', !e.target.checked);
    });
    document.getElementById('fmf_addOptionBtn').addEventListener('click', () => {
      optionsState.push({ id: genId(), name: '', price: 0 });
      renderOptRows();
    });
    document.getElementById('fmf_price').addEventListener('input', updateTotal);
  }

  document.getElementById('fmf_save').addEventListener('click', () => {
    const name = document.getElementById('fmf_name').value.trim();
    const day = parseInt(document.getElementById('fmf_day').value, 10);
    const price = parseInt(document.getElementById('fmf_price').value, 10);
    if (!name || !day || !price) return;
    fc.name = name;
    fc.day = day;
    fc.price = price;
    fc.memo = document.getElementById('fmf_memo').value.trim();
    if (isExpense) {
      fc.method = document.getElementById('fmf_method').value;
      fc.isSubscription = document.getElementById('fmf_isSub').checked;
      fc.options = fc.isSubscription ? optionsState.filter(o => o.name.trim()) : [];
      fc.totalPrice = price + fc.options.reduce((s, o) => s + (o.price || 0), 0);
    } else {
      fc.totalPrice = price;
    }
    saveAll();
    renderKakeiboTab();
    renderDataTabIfActive();
    closeModal();
  });
  document.getElementById('fmf_delete').addEventListener('click', () => {
    if (confirm('この固定費を削除しますか？（今月以降、自動追加されなくなります）')) {
      fixedCosts = fixedCosts.filter(f => f.id !== fc.id);
      saveAll();
      renderKakeiboTab();
      closeModal();
    }
  });
}

function renderCheckableList(container, items, onToggle, onClick) {
  container.innerHTML = '';
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">この月の記録はまだありません。</div>`;
    return;
  }
  items.sort((a, b) => new Date(a.date) - new Date(b.date));
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'checklist-row';
    const linked = item.linked ? `<span class="linked-tag">使用</span>` : '';
    const credit = item.linked && isCreditMethod(item.method) ? `<span class="credit-tag">${methodSettlementLabel(methodConfigOf(item.method))}</span>` : '';
    const sub = item.isSubscription ? `<span class="sub-tag">サブスク</span>` : '';
    const memoHTML = item.memo ? `<div class="item-memo">${escapeHTML(item.memo)}</div>` : '';
    const optionsHTML = item.isSubscription && item.options && item.options.length
      ? `<div class="fixed-options-breakdown">${item.options.map(o => `+ ${escapeHTML(o.name)} ¥${fmt(o.price)}`).join('<br>')}</div>` : '';
    row.innerHTML = `
      <div class="check-toggle ${item.checked ? 'checked' : ''}" data-id="${item.id}" data-linked="${!!item.linked}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <div class="history-item" data-id="${item.id}" data-linked="${!!item.linked}">
        <div class="item-info">
          <div class="item-name">${escapeHTML(item.name)} ${linked}${credit}${sub}</div>
          <div class="item-meta">${item.date}</div>
          ${memoHTML}
          ${optionsHTML}
        </div>
        <div class="item-price">¥${fmt(item.price)}</div>
      </div>`;
    container.appendChild(row);
  });
  container.querySelectorAll('.check-toggle').forEach(el => {
    el.addEventListener('click', () => onToggle(el.dataset.id));
  });
  container.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => onClick(el.dataset.id, el.dataset.linked === 'true'));
  });
}

// クレジット系（決済媒体の credit フラグが true）のグループは、項目ごとではなく
// 媒体ごとに1つのチェックボックスを表示する（明細行はチェックなしの単純な行として表示）
function renderPlainList(container, items, onClick) {
  container.innerHTML = '';
  if (items.length === 0) return;
  items.sort((a, b) => new Date(a.date) - new Date(b.date));
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item plain-row';
    const linked = item.linked ? `<span class="linked-tag">使用</span>` : '';
    const sub = item.isSubscription ? `<span class="sub-tag">サブスク</span>` : '';
    const memoHTML = item.memo ? `<div class="item-memo">${escapeHTML(item.memo)}</div>` : '';
    const optionsHTML = item.isSubscription && item.options && item.options.length
      ? `<div class="fixed-options-breakdown">${item.options.map(o => `+ ${escapeHTML(o.name)} ¥${fmt(o.price)}`).join('<br>')}</div>` : '';
    row.dataset.id = item.id;
    row.dataset.linked = !!item.linked;
    row.innerHTML = `
      <div class="item-info">
        <div class="item-name">${escapeHTML(item.name)} ${linked}${sub}</div>
        <div class="item-meta">${item.date}</div>
        ${memoHTML}
        ${optionsHTML}
      </div>
      <div class="item-price">¥${fmt(item.price)}</div>`;
    container.appendChild(row);
  });
  container.querySelectorAll('.plain-row').forEach(el => {
    el.addEventListener('click', () => onClick(el.dataset.id, el.dataset.linked === 'true'));
  });
}

// 支出一覧のチェック対象は expenseData（手入力・固定費）と useData（使用タブ連携分）の両方にまたがるため、
// どちらにあるかを探して切り替える
function toggleExpenseOrUseChecked(id) {
  let it = expenseData.find(i => i.id === id);
  if (!it) it = useData.find(i => i.id === id);
  if (it) { it.checked = !it.checked; saveAll(); renderKakeiboTab(); }
}

function renderKakeiboTab() {
  document.getElementById('kakeiboMonthLabel').textContent = formatMonthLabel(kakeiboViewMonth);
  const ym = kakeiboViewMonth;
  // 固定費は支出日（設定した「毎月の日にち」）を迎えていなくても、表示中の月の記録として計上する
  ensureKakeiboFixedForMonth(ym);

  const monthIncome = incomeData.filter(i => monthKeyOf(i.date) === ym);
  const monthExpenseManual = expenseData.filter(i => monthKeyOf(i.date) === ym);
  // クレジット決済の使用記録は「使用月の翌月」を家計簿上の支出月として扱う
  const monthUse = useData.filter(i => settlementMonthOf(i) === ym);

  const incomeTotal = monthIncome.reduce((s, i) => s + i.price, 0);
  const expenseTotal = monthExpenseManual.reduce((s, i) => s + i.price, 0) + monthUse.reduce((s, i) => s + i.price, 0);
  const balance = incomeTotal - expenseTotal;

  document.getElementById('kakeiboIncomeTotal').textContent = fmt(incomeTotal);
  document.getElementById('kakeiboExpenseTotal').textContent = fmt(expenseTotal);
  const balEl = document.getElementById('kakeiboBalance');
  balEl.textContent = (balance < 0 ? '-' : '') + fmt(Math.abs(balance));
  balEl.style.color = balance < 0 ? 'var(--danger)' : 'var(--success)';

  // 収入一覧（チェックボックスは「自分で金額を反映したか」を確認するための個別チェック）
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
    expenseWrap.innerHTML = `<div class="empty-state">この月の支出はまだありません。</div>`;
  } else {
    paymentMethods.forEach(m => {
      const items = combined.filter(i => (i.method || '') === m.name).sort((a, b) => new Date(a.date) - new Date(b.date));
      if (items.length === 0) return;
      const subtotal = items.reduce((s, i) => s + i.price, 0);
      const groupWrap = document.createElement('div');
      groupWrap.className = 'month-group';
      const list = document.createElement('div');
      list.className = 'history-list';

      if (m.credit) {
        // 媒体ごとに1つのチェックボックス（引き落とし額を確認したかどうか）
        const groupKey = `${m.name}_${ym}`;
        const groupChecked = !!creditGroupChecks[groupKey];
        groupWrap.innerHTML = `
          <div class="method-group-title credit-group">
            <div class="method-group-left">
              <div class="check-toggle group-check ${groupChecked ? 'checked' : ''}" data-groupkey="${groupKey}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <span>${escapeHTML(m.name)} <span class="credit-tag">${methodSettlementLabel(m)}</span></span>
            </div>
            <span>¥${fmt(subtotal)}</span>
          </div>`;
        groupWrap.appendChild(list);
        renderPlainList(list, items, (id, isLinked) => { if (isLinked) openUseEditModal(id); else openExpenseEditModal(id); });
        expenseWrap.appendChild(groupWrap);
        groupWrap.querySelector('.group-check').addEventListener('click', () => {
          creditGroupChecks[groupKey] = !creditGroupChecks[groupKey];
          saveAll();
          renderKakeiboTab();
        });
      } else {
        groupWrap.innerHTML = `<div class="method-group-title"><span>${escapeHTML(m.name)}</span><span>¥${fmt(subtotal)}</span></div>`;
        groupWrap.appendChild(list);
        renderCheckableList(
          list, items,
          toggleExpenseOrUseChecked,
          (id, isLinked) => { if (isLinked) openUseEditModal(id); else openExpenseEditModal(id); }
        );
        expenseWrap.appendChild(groupWrap);
      }
    });
    const knownNames = paymentMethods.map(m => m.name);
    const noMethod = combined.filter(i => !i.method || !knownNames.includes(i.method));
    if (noMethod.length) {
      const groupWrap = document.createElement('div');
      groupWrap.className = 'month-group';
      groupWrap.innerHTML = `<div class="method-group-title"><span>その他</span><span>¥${fmt(noMethod.reduce((s, i) => s + i.price, 0))}</span></div>`;
      const list = document.createElement('div');
      list.className = 'history-list';
      groupWrap.appendChild(list);
      renderCheckableList(list, noMethod,
        toggleExpenseOrUseChecked,
        (id, isLinked) => { if (isLinked) openUseEditModal(id); else openExpenseEditModal(id); });
      expenseWrap.appendChild(groupWrap);
    }
  }


  // 固定費一覧（月に依存せず全件表示）
  const fixedWrap = document.getElementById('fixedList');
  fixedWrap.innerHTML = '';
  if (fixedCosts.length === 0) {
    fixedWrap.innerHTML = `<div class="empty-state">固定費はまだ設定されていません。</div>`;
  } else {
    fixedCosts.forEach(fc => {
      const displayPrice = fc.type === 'expense' ? (fc.totalPrice != null ? fc.totalPrice : fc.price) : fc.price;
      const subInfo = fc.isSubscription && fc.options && fc.options.length
        ? `<div class="fixed-options-breakdown">${fc.options.map(o => `+ ${escapeHTML(o.name)} ¥${fmt(o.price)}`).join('<br>')}</div>` : '';
      const row = document.createElement('div');
      row.className = 'history-item';
      row.innerHTML = `
        <div class="item-info">
          <div class="item-name">${escapeHTML(fc.name)} <span class="method-tag">${fc.type === 'income' ? '収入' : '支出'}</span>${fc.isSubscription ? '<span class="sub-tag">サブスク</span>' : ''}</div>
          <div class="item-meta">毎月${fc.day}日${fc.method ? ' ・ ' + escapeHTML(fc.method) : ''}</div>
          ${fc.memo ? `<div class="item-memo">${escapeHTML(fc.memo)}</div>` : ''}
          ${subInfo}
        </div>
        <div class="item-price ${fc.type === 'income' ? 'plus' : 'minus'}">¥${fmt(displayPrice)}</div>`;
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => openFixedCostEditModal(fc));
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
  const memo = document.getElementById('investMemo').value.trim();
  if (!name || !price || !date) return;
  investData.push({ id: genId(), category, name, price, date, memo });
  saveAll();
  document.getElementById('investName').value = '';
  document.getElementById('investPrice').value = '';
  document.getElementById('investMemo').value = '';
  renderInvestTab();
  renderDataTabIfActive();
});

document.getElementById('investFixedForm').addEventListener('submit', e => {
  e.preventDefault();
  const category = document.getElementById('investFixedCategory').value;
  const name = document.getElementById('investFixedName').value.trim();
  const day = parseInt(document.getElementById('investFixedDay').value, 10);
  const price = parseInt(document.getElementById('investFixedPrice').value, 10);
  const memo = document.getElementById('investFixedMemo').value.trim();
  if (!name || !day || !price) return;
  investFixed.push({ id: genId(), category, name, day, price, memo });
  saveAll();
  ensureInvestFixedGenerated();
  document.getElementById('investFixedName').value = '';
  document.getElementById('investFixedDay').value = '';
  document.getElementById('investFixedPrice').value = '';
  document.getElementById('investFixedMemo').value = '';
  renderInvestTab();
  renderDataTabIfActive();
});

function openInvestEditModal(id) {
  const item = investData.find(i => i.id === id);
  if (!item) return;
  openEditItemModal({
    title: `投資記録を編集（${CATEGORY_LABEL[item.category]}）`,
    name: item.name, price: item.price, date: item.date, memo: item.memo,
    onSave: v => { Object.assign(item, v); delete item.method; saveAll(); renderInvestTab(); renderDataTabIfActive(); },
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
          ${fc.memo ? `<div class="item-memo">${escapeHTML(fc.memo)}</div>` : ''}
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
  // クレジット決済分は引き落とし日（使用月の翌月）ベースで計上する
  const used = useData.filter(i => settlementDateOf(i) <= cutoff).reduce((s, i) => s + i.price, 0);
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

function lastNMonthKeysEndingAt(endYm, n) {
  const [y, m] = endYm.split('-').map(Number);
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
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

// 指標の内訳（タップした際に表示する内容）
function getMetricBreakdownRows(metric, cutoff) {
  if (metric.custom) {
    return metric.components.map(k => {
      const m = getAllMetrics().find(mm => mm.key === k);
      return { label: m ? m.label : k, value: getMetricValueAsOf(k, cutoff) };
    });
  }
  switch (metric.key) {
    case 'total_assets':
      return [
        { label: '貯金額', value: savingsAsOf(cutoff) },
        { label: 'NISA投資（積立＋成長）', value: investAsOf(cutoff, ['tsumitate', 'seicho']) },
        { label: 'iDeCo投資', value: investAsOf(cutoff, ['ideco']) }
      ];
    case 'savings':
      return [
        { label: '収入合計', value: incomeAsOf(cutoff) },
        { label: '支出合計', value: expenseAsOf(cutoff), negative: true }
      ];
    case 'nisa':
      return [
        { label: 'NISA（積立）', value: investAsOf(cutoff, ['tsumitate']) },
        { label: 'NISA（成長）', value: investAsOf(cutoff, ['seicho']) }
      ];
    case 'ideco':
      return [
        { label: '記録件数', value: investData.filter(i => i.date <= cutoff && i.category === 'ideco').length, isCount: true },
        { label: '合計金額', value: investAsOf(cutoff, ['ideco']) }
      ];
    case 'gaman':
      return [
        { label: '記録件数', value: gamanData.filter(i => i.date <= cutoff).length, isCount: true },
        { label: '合計金額', value: gamanAsOf(cutoff) }
      ];
    default:
      return [];
  }
}
function openMetricBreakdownModal(metric, cutoff) {
  const rows = getMetricBreakdownRows(metric, cutoff);
  const total = getMetricValueAsOf(metric.key, cutoff);
  openModal(`
    <h3>${escapeHTML(metric.label)}の内訳</h3>
    <p class="hint-text">${formatMonthLabel(dataViewMonth)}時点</p>
    <div class="metric-manage-list">
      ${rows.map(r => `<div class="metric-manage-item"><span>${escapeHTML(r.label)}</span><span>${r.isCount ? r.value + '件' : (r.negative ? '-' : '') + '¥' + fmt(r.value)}</span></div>`).join('')}
    </div>
    <div class="options-total breakdown-total">合計：<span>¥${fmt(total)}</span></div>
    <div class="modal-actions"><button class="btn-primary accent-data-bg" id="breakdownCloseBtn"><span>閉じる</span></button></div>
  `);
  document.getElementById('breakdownCloseBtn').addEventListener('click', closeModal);
}

let trendChart = null;
let strengthChart = null;

function renderDataTabIfActive() {
  if (document.querySelector('.tab-panel[data-tab="data"]').classList.contains('active')) {
    renderDataTab();
  }
}

document.getElementById('dataPrevMonth').addEventListener('click', () => { dataViewMonth = addMonths(dataViewMonth, -1); renderDataTab(); });
document.getElementById('dataNextMonth').addEventListener('click', () => { dataViewMonth = addMonths(dataViewMonth, 1); renderDataTab(); });

function renderDataTab() {
  const cutoff = monthEndCutoff(dataViewMonth);
  document.getElementById('dataMonthLabel').textContent = formatMonthLabel(dataViewMonth) + '時点';
  const metrics = getAllMetrics();

  const grid = document.getElementById('dataSummaryGrid');
  grid.innerHTML = metrics.map(m => `
    <div class="metric-card ${m.key === 'total_assets' ? 'wide' : ''}" data-key="${m.key}">
      <span class="stat-label">${escapeHTML(m.label)}</span>
      <div class="stat-amount"><span class="yen">¥</span>${fmt(getMetricValueAsOf(m.key, cutoff))}</div>
    </div>`).join('');
  grid.querySelectorAll('.metric-card').forEach(card => {
    card.addEventListener('click', () => {
      const metric = metrics.find(m => m.key === card.dataset.key);
      if (metric) openMetricBreakdownModal(metric, cutoff);
    });
  });

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
  const months = lastNMonthKeysEndingAt(dataViewMonth, 6);
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

// 我慢強さ＝その月の我慢額 ÷ その月の支出額（同一月・使用日ベースで算出。決済のタイミングはずらさない）
function renderStrengthChart() {
  if (typeof Chart === 'undefined') return;
  const months = lastNMonthKeysEndingAt(dataViewMonth, 6);
  const labels = months.map(m => m.slice(5) + '月');
  const values = months.map(m => {
    const start = `${m}-01`;
    const [y, mo] = m.split('-').map(Number);
    const end = `${m}-${pad2(daysInMonth(y, mo))}`;
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
  ensureInvestFixedGenerated();
  refreshMethodSelects();
  renderGamanTab();
  renderUseTab();
  renderKakeiboTab();
  renderInvestTab();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

init();

});
