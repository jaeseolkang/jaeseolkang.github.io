// 2026-06-17 14:00 KST | 작성: 가계부 앱 코어 로직 (IndexedDB + 렌더링)
'use strict';

/* =========================================================
   DB LAYER
   3단계 구조:
   - categories: 대분류 (헌금/이자/기타, 인건비/시설비 등). usePersonLevel 플래그 보유
   - persons: 대분류에 속한 인물(성도/직원 등). '하위항목' 사용 대분류에서만 의미 있음
   - subItems: 대분류에 속한 세부항목 (십일조/감사/주일, 전기료/수도료 등)
   - transactions: 거래 1건 = 날짜 + categoryId + (선택)personId + lines[{subItemId, amount}]
   ========================================================= */
const DB = (() => {
  const DB_NAME = 'budgetAppDB';
  const DB_VERSION = 2;
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const _db = e.target.result;
        if (!_db.objectStoreNames.contains('transactions')) {
          const tx = _db.createObjectStore('transactions', { keyPath: 'id' });
          tx.createIndex('byDate', 'date');
          tx.createIndex('byCategory', 'categoryId');
          tx.createIndex('byType', 'type');
        }
        if (!_db.objectStoreNames.contains('categories')) {
          const cat = _db.createObjectStore('categories', { keyPath: 'id' });
          cat.createIndex('byType', 'type');
        }
        if (!_db.objectStoreNames.contains('persons')) {
          const p = _db.createObjectStore('persons', { keyPath: 'id' });
          p.createIndex('byCategory', 'categoryId');
        }
        if (!_db.objectStoreNames.contains('subItems')) {
          const s = _db.createObjectStore('subItems', { keyPath: 'id' });
          s.createIndex('byCategory', 'categoryId');
        }
        if (!_db.objectStoreNames.contains('settings')) {
          _db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e);
    });
  }

  function tx(storeNames, mode = 'readonly') {
    return open().then(_db => _db.transaction(storeNames, mode));
  }

  async function getAll(store) {
    const t = await tx([store]);
    return new Promise((resolve, reject) => {
      const req = t.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e);
    });
  }

  async function get(store, key) {
    const t = await tx([store]);
    return new Promise((resolve, reject) => {
      const req = t.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e);
    });
  }

  async function put(store, value) {
    const t = await tx([store], 'readwrite');
    return new Promise((resolve, reject) => {
      const req = t.objectStore(store).put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = (e) => reject(e);
    });
  }

  async function del(store, key) {
    const t = await tx([store], 'readwrite');
    return new Promise((resolve, reject) => {
      const req = t.objectStore(store).delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e);
    });
  }

  return { open, getAll, get, put, del };
})();

/* =========================================================
   DEFAULT CATEGORIES (대분류) + SUB ITEMS (세부항목)
   ========================================================= */
const DEFAULT_CATEGORIES = [
  // 수입 — 헌금은 인물별 대분류로 관리하므로 시드에 없음
  { type: 'income', name: '이자', icon: '🏦', color: '#0EA5E9', usePersonLevel: false,
    subItems: ['예금이자', '적금이자', '기타이자'] },
  { type: 'income', name: '기타', icon: '✨', color: '#84CC16', usePersonLevel: false,
    subItems: ['잡수입', '환급금', '후원금'] },
  // 지출
  { type: 'expense', name: '인건비', icon: '💼', color: '#3B82F6', usePersonLevel: false,
    subItems: ['사례비', '활동비', '교통비'], budget: 0 },
  { type: 'expense', name: '시설비', icon: '🏠', color: '#F08C3A', usePersonLevel: false,
    subItems: ['전기료', '수도료', '관리비', '수선비'], budget: 0 },
  { type: 'expense', name: '선교비', icon: '🌍', color: '#10B981', usePersonLevel: false,
    subItems: ['국내선교', '해외선교', '단기선교'], budget: 0 },
  { type: 'expense', name: '운영비', icon: '📦', color: '#9CA3AF', usePersonLevel: false,
    subItems: ['사무용품', '식사비', '차량유지', '기타'], budget: 0 },
  { type: 'expense', name: '예금', icon: '🏦', color: '#64748B', usePersonLevel: false,
    subItems: ['후대헌금', '건축헌금', '선교헌금'], budget: 0 },
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function seedIfEmpty() {
  const cats = await DB.getAll('categories');
  if (cats.length === 0) {
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      const def = DEFAULT_CATEGORIES[i];
      const catId = uid();
      const { subItems, ...catFields } = def;
      await DB.put('categories', { id: catId, order: i, ...catFields });
      for (let j = 0; j < subItems.length; j++) {
        await DB.put('subItems', { id: uid(), categoryId: catId, name: subItems[j], order: j });
      }
    }
  } else {
    // 마이그레이션: 기존 사용자에게 '예금' 지출 대분류가 없으면 추가
    const hasDeposit = cats.some(c => c.type === 'expense' && c.name === '예금');
    if (!hasDeposit) {
      const def = DEFAULT_CATEGORIES.find(d => d.name === '예금');
      const catId = uid();
      const { subItems, ...catFields } = def;
      await DB.put('categories', { id: catId, order: cats.length, ...catFields });
      for (let j = 0; j < subItems.length; j++) {
        await DB.put('subItems', { id: uid(), categoryId: catId, name: subItems[j], order: j });
      }
    }
  }
  const settings = await DB.get('settings', 'general');
  if (!settings) {
    await DB.put('settings', { key: 'general', monthStartDay: 1, currency: 'KRW' });
  }
}

/* =========================================================
   APP STATE
   ========================================================= */
const State = {
  tab: 'home',
  homeView: 'calendar', // 'calendar' | 'daily' | 'monthly'
  cursorDate: new Date(), // 현재 보고 있는 월 기준
  categories: [],
  persons: [],
  subItems: [],
  transactions: [],
  statsType: 'expense',
  statsView: 'stats',        // 'stats'(통계) | 'detail'(내용)
  // 통계 기간 모드
  statsPeriod: 'month',      // 'week' | 'month' | 'year' | 'custom'
  statsCustomStart: null,    // 'YYYY-MM-DD'
  statsCustomEnd: null,      // 'YYYY-MM-DD'
  statsWeekOffset: 0,        // 주간 모드에서 현재 주 기준 오프셋
  statsYearOffset: 0,        // 연간 모드에서 현재 연도 기준 오프셋
  editingTx: null, // 편집 중인 거래 (null이면 신규)
  // 거래 입력 폼 진행 상태
  formType: 'expense',
  formStep: 'pick', // 'pick'(중분류 선택) -> 'items'
  formCategoryId: null,
  formPersonId: null,
  formDate: null,
  formMemo: '',
  formAmounts: {}, // { subItemId: amountNumber }
  dayDetailDate: null, // 현재 열려있는 '일별 상세' 시트의 날짜 (null이면 닫힌 상태)
  catStatDetailId: null, // 현재 열려있는 '통계 항목 상세' 시트의 categoryId (null이면 닫힌 상태)
  subStatDetailKey: null, // 현재 열려있는 '내용 탭 집계 상세' 시트의 key (null이면 닫힌 상태)
};

function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  return sign + Math.abs(Math.round(n)).toLocaleString('ko-KR');
}

/* ---- 금액 입력칸 콤마 자동 포맷 ---- */
function rawDigits(str) {
  return (str || '').replace(/[^0-9]/g, '');
}
function formatDigitsWithComma(digits) {
  if (!digits) return '';
  return Number(digits).toLocaleString('ko-KR');
}
// input[type=text][inputmode=numeric]에 천단위 콤마 자동입력을 붙인다.
// onChange(numberValue)는 콤마 제거 후 숫자값이 바뀔 때마다 호출된다.
function attachMoneyInputFormatter(input, onChange) {
  input.addEventListener('input', () => {
    const digits = rawDigits(input.value).replace(/^0+(?=\d)/, '');
    const formatted = formatDigitsWithComma(digits);
    const prevLen = input.value.length;
    input.value = formatted;
    const newLen = formatted.length;
    const diff = newLen - prevLen;
    try {
      const pos = Math.max(0, (input.selectionStart || newLen) + diff);
      input.setSelectionRange(pos, pos);
    } catch (e) { /* some input types don't support selection */ }
    if (onChange) onChange(digits === '' ? null : Number(digits));
  });
}

function ymKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isSameMonth(dateStr, d) {
  return dateStr.slice(0, 7) === ymKey(d);
}

function monthLabel(d) {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function catById(id) {
  return State.categories.find(c => c.id === id);
}
function personById(id) {
  return State.persons.find(p => p.id === id);
}
function subItemById(id) {
  return State.subItems.find(s => s.id === id);
}
function subItemsOfCategory(catId) {
  return State.subItems.filter(s => s.categoryId === catId).sort((a,b)=>a.name.localeCompare(b.name,'ko') || (a.order??0)-(b.order??0));
}
function personsOfCategory(catId) {
  return State.persons.filter(p => p.categoryId === catId).sort((a,b)=>a.name.localeCompare(b.name,'ko') || (a.order??0)-(b.order??0));
}

async function reloadData() {
  const [cats, persons, subItems, txs] = await Promise.all([
    DB.getAll('categories'), DB.getAll('persons'), DB.getAll('subItems'), DB.getAll('transactions')
  ]);
  cats.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  State.categories = cats;
  State.persons = persons;
  State.subItems = subItems;
  State.transactions = txs.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

/* ---- 연도별 전년이월 금액 ---- */
async function getYearCarryover(year) {
  const rec = await DB.get('settings', `yearCarryover:${year}`);
  return rec ? rec.amount : null; // null이면 아직 입력되지 않음
}
async function setYearCarryover(year, amount) {
  await DB.put('settings', { key: `yearCarryover:${year}`, amount: Number(amount) || 0 });
}

function txInCursorMonth() {
  return State.transactions.filter(t => isSameMonth(t.date, State.cursorDate));
}

function monthSummary() {
  const list = txInCursorMonth();
  let income = 0, expense = 0;
  for (const t of list) {
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, balance: income - expense };
}

async function totalAssets() {
  let income = 0, expense = 0;
  for (const t of State.transactions) {
    if (t.type === 'income') income += t.amount;
    else expense += t.amount;
  }
  // 거래 내역에 등장하는 모든 연도의 전년이월 합산 (미입력 연도는 0으로 처리)
  const years = new Set(State.transactions.map(t => Number(t.date.slice(0, 4))));
  let carryover = 0;
  for (const y of years) {
    const amt = await getYearCarryover(y);
    if (amt !== null) carryover += amt;
  }
  const net = carryover + income - expense;
  return { totalIncome: income, totalExpense: expense, carryover, net };
}

/* =========================================================
   ICONS (inline SVG, stroke-based, consistent 22x22 viewBox)
   ========================================================= */
const ICONS = {
  home: (active) => `<svg viewBox="0 0 24 24" fill="none" stroke="${active?'var(--primary)':'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></svg>`,
  list: (active) => `<svg viewBox="0 0 24 24" fill="none" stroke="${active?'var(--primary)':'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><circle cx="3.5" cy="6" r="1.3" fill="${active?'var(--primary)':'currentColor'}" stroke="none"/><circle cx="3.5" cy="12" r="1.3" fill="${active?'var(--primary)':'currentColor'}" stroke="none"/><circle cx="3.5" cy="18" r="1.3" fill="${active?'var(--primary)':'currentColor'}" stroke="none"/></svg>`,
  budget: (active) => `<svg viewBox="0 0 24 24" fill="none" stroke="${active?'var(--primary)':'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 14.5h4"/></svg>`,
  stats: (active) => `<svg viewBox="0 0 24 24" fill="none" stroke="${active?'var(--primary)':'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"/><path d="M12 20V4"/><path d="M20 20v-7"/></svg>`,
  settings: (active) => `<svg viewBox="0 0 24 24" fill="none" stroke="${active?'var(--primary)':'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.9-1.5-2-3.4-2.2.9a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.2-.9-2 3.4L4.6 10a7.7 7.7 0 0 0 0 3l-1.9 1.5 2 3.4 2.2-.9c.77.65 1.65 1.16 2.6 1.5L10 22h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.2.9 2-3.4z"/></svg>`,
  chevLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  chevRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.9-1.5-2-3.4-2.2.9a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.2-.9-2 3.4L4.6 10a7.7 7.7 0 0 0 0 3l-1.9 1.5 2 3.4 2.2-.9c.77.65 1.65 1.16 2.6 1.5L10 22h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.2.9 2-3.4z"/></svg>`,
  chevR: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/></svg>`,
};

const TABS = [
  { key: 'home', label: '홈' },
  { key: 'budget', label: '예산' },
  { key: 'stats', label: '통계' },
  { key: 'settings', label: '설정' },
];

/* =========================================================
   RENDER: APP SHELL
   ========================================================= */
function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="pages" id="pages">
      <div class="page" id="page-home"></div>
      <div class="page" id="page-budget"></div>
      <div class="page" id="page-stats"></div>
      <div class="page" id="page-settings"></div>
    </div>
    <button class="fab" id="fabAdd">${ICONS.plus}</button>
    <div class="tabbar" id="tabbar"></div>
    <div class="sheet-backdrop" id="sheetBackdrop"></div>
    <div class="sheet" id="txSheet"></div>
    <div class="sheet" id="catManageSheet"></div>
    <div class="sheet" id="catEditSheet"></div>
    <div class="sheet" id="catSubSheet"></div>
    <div class="sheet" id="dayDetailSheet" style="max-height:100%; border-radius:0;"></div>
    <div class="sheet" id="catStatDetailSheet" style="max-height:100%; border-radius:0;"></div>
    <div class="sheet" id="subStatDetailSheet" style="max-height:100%; border-radius:0;"></div>
    <div class="sheet" id="excelRangeSheet"></div>
    <div class="sheet" id="backupRangeSheet"></div>
    <div class="toast" id="toast"></div>
  `;
  renderTabbar();
  document.getElementById('fabAdd').addEventListener('click', () => openDayDetail(todayStr()));
  document.getElementById('sheetBackdrop').addEventListener('click', closeAllSheets);
}

function renderTabbar() {
  const bar = document.getElementById('tabbar');
  bar.innerHTML = TABS.map(t => `
    <button class="tab-btn ${State.tab === t.key ? 'active' : ''}" data-tab="${t.key}">
      ${ICONS[t.key](State.tab === t.key)}
      <span>${t.label}</span>
    </button>
  `).join('');
  bar.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(key) {
  State.tab = key;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + key).classList.add('active');
  renderTabbar();
  renderCurrentPage();
  document.getElementById('fabAdd').style.display = (key === 'settings') ? 'none' : 'flex';
  // 홈 탭 보조 상태 초기화는 renderHome에서 처리
}

function renderCurrentPage() {
  if (State.tab === 'home') renderHome();
  else if (State.tab === 'budget') renderBudget();
  else if (State.tab === 'stats') renderStats();
  else if (State.tab === 'settings') renderSettings();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

function changeMonth(delta) {
  const d = new Date(State.cursorDate);
  d.setMonth(d.getMonth() + delta);
  State.cursorDate = d;
  renderCurrentPage();
}

/* =========================================================
   RENDER: HOME (캘린더)
   ========================================================= */
function dayTotalsMap() {
  // { 'YYYY-MM-DD': { income, expense } }
  const map = {};
  for (const t of txInCursorMonth()) {
    if (!map[t.date]) map[t.date] = { income: 0, expense: 0 };
    map[t.date][t.type] += t.amount;
  }
  return map;
}

function buildCalendarCells(cursorDate) {
  const year = cursorDate.getFullYear();
  const month = cursorDate.getMonth(); // 0-indexed
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  // leading days from previous month
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const dt = new Date(year, month - 1, d);
    cells.push({ date: dt, inMonth: false });
  }
  // this month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  // trailing days to complete weeks (multiple of 7)
  while (cells.length % 7 !== 0) {
    const idx = cells.length - (startWeekday + daysInMonth);
    const d = idx + 1;
    cells.push({ date: new Date(year, month + 1, d), inMonth: false });
  }
  return cells;
}

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function renderHome() {
  const page = document.getElementById('page-home');
  const { income, expense, balance } = monthSummary();
  const { totalIncome, totalExpense, carryover, net } = await totalAssets();
  const netColor = net < 0 ? 'var(--expense-light)' : '#fff';

  const viewTabsHTML = `
    <div class="home-view-tabs">
      <button class="home-view-tab ${State.homeView==='calendar'?'active':''}" data-view="calendar">달력</button>
      <button class="home-view-tab ${State.homeView==='daily'?'active':''}" data-view="daily">일일</button>
      <button class="home-view-tab ${State.homeView==='monthly'?'active':''}" data-view="monthly">월별</button>
    </div>
  `;

  let viewContent = '';
  if (State.homeView === 'calendar') {
    viewContent = renderHomeCalendar();
  } else if (State.homeView === 'daily') {
    viewContent = renderHomeDaily();
  } else {
    viewContent = renderHomeMonthly();
  }

  page.innerHTML = `
    <div class="appbar" style="padding-left:0;padding-right:0;">
      <h1>주원교회 회계부</h1>
      <button class="icon-btn" id="goSettings">${ICONS.gear}</button>
    </div>

    <div class="total-assets-banner">
      <div class="total-assets-left">
        <div class="total-assets-label">현재까지 누적 자산</div>
        <div class="total-assets-value tabular" style="color:${netColor}">${net < 0 ? '-' : ''}${fmtMoney(Math.abs(net))}원</div>
      </div>
      <div class="total-assets-right">
        ${carryover !== 0 ? `<div class="total-assets-sub">전년이월 <span class="tabular">${fmtMoney(carryover)}원</span></div>` : ''}
        <div class="total-assets-sub">총 수입 <span class="tabular">${fmtMoney(totalIncome)}원</span></div>
        <div class="total-assets-sub">총 지출 <span class="tabular">${fmtMoney(totalExpense)}원</span></div>
      </div>
    </div>

    <div class="cal-summary-row">
      <div class="cal-summary-col">
        <div class="cal-summary-label">수입</div>
        <div class="cal-summary-value income tabular">${fmtMoney(income)}</div>
      </div>
      <div class="cal-summary-col">
        <div class="cal-summary-label">지출</div>
        <div class="cal-summary-value expense tabular">${fmtMoney(expense)}</div>
      </div>
      <div class="cal-summary-col">
        <div class="cal-summary-label">합계</div>
        <div class="cal-summary-value tabular">${fmtMoney(balance)}</div>
      </div>
    </div>

    ${viewTabsHTML}

    ${State.homeView !== 'monthly' ? `
    <div class="cal-month-nav">
      <button id="prevMonth">${ICONS.chevLeft}</button>
      <span class="lbl">${monthLabel(State.cursorDate)}</span>
      <button id="nextMonth">${ICONS.chevRight}</button>
    </div>` : ''}

    ${viewContent}
  `;

  page.querySelector('#goSettings').addEventListener('click', () => switchTab('settings'));
  page.querySelector('#prevMonth')?.addEventListener('click', () => changeMonth(-1));
  page.querySelector('#nextMonth')?.addEventListener('click', () => changeMonth(1));
  page.querySelectorAll('.home-view-tab').forEach(btn => {
    btn.addEventListener('click', () => { State.homeView = btn.dataset.view; renderHome(); });
  });

  if (State.homeView === 'calendar') {
    page.querySelectorAll('.cal-day').forEach(el => {
      el.addEventListener('click', () => openDayDetail(el.dataset.date));
    });
  } else if (State.homeView === 'daily') {
    page.querySelectorAll('.tx-item').forEach(el => {
      el.addEventListener('click', () => openTxSheet(el.dataset.id));
    });
  } else {
    // 월별: 클릭하면 해당 월로 이동 후 일일 탭
    page.querySelectorAll('.monthly-row').forEach(el => {
      el.addEventListener('click', () => {
        const [y, m] = el.dataset.ym.split('-').map(Number);
        State.cursorDate = new Date(y, m - 1, 1);
        State.homeView = 'daily';
        renderHome();
      });
    });
  }
}

function renderHomeCalendar() {
  const totals = dayTotalsMap();
  const cells = buildCalendarCells(State.cursorDate);
  const today = todayStr();
  const weekdayNames = ['일','월','화','수','목','금','토'];
  return `
    <div class="cal-grid">
      <div class="cal-weekdays">${weekdayNames.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="cal-days">
        ${cells.map(({ date, inMonth }) => {
          const dstr = dateToStr(date);
          const t = totals[dstr];
          const wd = date.getDay();
          const classes = ['cal-day'];
          if (!inMonth) classes.push('other-month');
          if (wd === 0) classes.push('is-sun');
          if (wd === 6) classes.push('is-sat');
          if (dstr === today) classes.push('is-today');
          return `
            <div class="${classes.join(' ')}" data-date="${dstr}">
              <div class="dnum">${date.getDate()}</div>
              ${t && t.income > 0 ? `<div class="damt income tabular">${fmtMoneyShort(t.income)}</div>` : ''}
              ${t && t.expense > 0 ? `<div class="damt expense tabular">${fmtMoneyShort(t.expense)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderHomeDaily() {
  const list = txInCursorMonth();
  const groups = {};
  for (const t of list) {
    (groups[t.date] = groups[t.date] || []).push(t);
  }
  const dates = Object.keys(groups).sort((a,b) => b.localeCompare(a));
  if (dates.length === 0) return emptyStateHTML('이번 달 내역이 없어요', '＋ 버튼으로 거래를 추가해보세요');
  return dates.map(date => `
    <div class="tx-group-label">${dateGroupLabel(date)}</div>
    <div class="card" style="padding:4px 16px;">
      ${groups[date].map(txItemHTML).join('')}
    </div>
  `).join('');
}

function renderHomeMonthly() {
  // 전체 거래에서 연-월 목록 추출
  const allTx = State.transactions;
  if (allTx.length === 0) return emptyStateHTML('내역이 없어요', '＋ 버튼으로 거래를 추가해보세요');

  const monthSet = new Set(allTx.map(t => t.date.slice(0, 7)));
  const months = Array.from(monthSet).sort((a, b) => b.localeCompare(a));

  return months.map(ym => {
    const [y, m] = ym.split('-').map(Number);
    const txs = allTx.filter(t => t.date.startsWith(ym));
    let inc = 0, exp = 0;
    for (const t of txs) {
      if (t.type === 'income') inc += t.amount;
      else exp += t.amount;
    }
    const bal = inc - exp;
    return `
      <div class="monthly-row card" data-ym="${ym}" style="margin-bottom:10px; padding:14px 16px; cursor:pointer;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="font-size:15px; font-weight:800; color:var(--text-1);">${y}년 ${m}월</div>
          <div class="tabular" style="font-size:15px; font-weight:800; color:${bal<0?'var(--expense)':'var(--text-1)'};">${bal<0?'-':''}${fmtMoney(Math.abs(bal))}원</div>
        </div>
        <div style="display:flex; gap:14px; margin-top:6px;">
          <span style="font-size:12.5px; color:var(--primary); font-weight:600;">수입 <b class="tabular">${fmtMoney(inc)}</b></span>
          <span style="font-size:12.5px; color:var(--expense); font-weight:600;">지출 <b class="tabular">${fmtMoney(exp)}</b></span>
          <span style="font-size:12.5px; color:var(--text-3); font-weight:500;">${txs.length}건</span>
        </div>
      </div>
    `;
  }).join('');
}
function fmtMoneyShort(n) {
  // 달력 셀에 들어가는 짧은 금액 표기 (예: 7,448,786 -> 그대로, 필요시 만원단위 축약은 생략하고 천단위 콤마만)
  return fmtMoney(n);
}

function emptyStateHTML(msg, sub) {
  return `<div class="empty-state"><div class="emoji">🧾</div><div class="msg">${msg}<br><span style="font-size:12.5px;">${sub}</span></div></div>`;
}

function txItemHTML(t) {
  const cat = catById(t.categoryId) || { icon: '📦', color: '#9CA3AF', name: '삭제된 항목' };
  const lines = t.lines || [];
  const person = t.personId ? personById(t.personId) : null;

  // 제목: 하위항목(중분류)이 있으면 그 이름, 없으면 대분류명
  const title = person ? person.name : cat.name;

  // 부제: 메모가 있으면 메모, 아니면 (인물별 대분류일 땐 대분류명도 같이) 세부항목 요약
  let itemsSummary;
  if (lines.length > 0) {
    const names = lines.map(l => (subItemById(l.subItemId) || {}).name || '항목').filter(Boolean);
    itemsSummary = names.slice(0, 2).join(', ');
    if (names.length > 2) itemsSummary += ` 외 ${names.length - 2}건`;
  } else {
    itemsSummary = t.date.slice(5).replace('-', '월 ') + '일';
  }
  let sub;
  if (t.memo) {
    sub = escapeHTML(t.memo);
  } else {
    sub = itemsSummary;
  }

  return `
    <div class="tx-item" data-id="${t.id}">
      <div class="tx-icon" style="background:${hexToLight(cat.color)};">${cat.icon}</div>
      <div class="tx-mid">
        <div class="tx-cat">${escapeHTML(title)}</div>
        <div class="tx-memo">${sub}</div>
      </div>
      <div class="tx-amt tabular ${t.type}">${t.type === 'income' ? '+' : '-'}${fmtMoney(t.amount)}원</div>
    </div>
  `;
}

function hexToLight(hex) {
  // returns a light tint background for icon circles
  try {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},0.14)`;
  } catch(e) { return '#F0F0F0'; }
}

function escapeHTML(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* =========================================================
   RENDER: LIST (내역)
   ========================================================= */
function renderList() {
  const page = document.getElementById('page-list');
  const list = txInCursorMonth();
  const groups = {};
  for (const t of list) {
    (groups[t.date] = groups[t.date] || []).push(t);
  }
  const dates = Object.keys(groups).sort((a,b) => b.localeCompare(a));

  page.innerHTML = `
    <div class="appbar" style="padding-left:0;padding-right:0;">
      <h1>내역</h1>
    </div>
    <div class="summary-month" style="justify-content:center; background:var(--card); border-radius:var(--radius-sm); padding:10px; box-shadow:var(--shadow); color:var(--text-1); margin-bottom:14px;">
      <button id="prevMonth2" style="color:var(--text-2);">${ICONS.chevLeft}</button>
      <span style="font-weight:700;">${monthLabel(State.cursorDate)}</span>
      <button id="nextMonth2" style="color:var(--text-2);">${ICONS.chevRight}</button>
    </div>
    ${dates.length === 0 ? emptyStateHTML('이번 달 내역이 없어요', '＋ 버튼으로 거래를 추가해보세요') : dates.map(date => `
      <div class="tx-group-label">${dateGroupLabel(date)}</div>
      <div class="card" style="padding:4px 16px;">
        ${groups[date].map(txItemHTML).join('')}
      </div>
    `).join('')}
  `;
  page.querySelector('#prevMonth2').addEventListener('click', () => changeMonth(-1));
  page.querySelector('#nextMonth2').addEventListener('click', () => changeMonth(1));
  page.querySelectorAll('.tx-item').forEach(el => {
    el.addEventListener('click', () => openTxSheet(el.dataset.id));
  });
}

function dateGroupLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['일','월','화','수','목','금','토'];
  const today = todayStr();
  const yest = new Date(); yest.setDate(yest.getDate()-1);
  const yestStr = `${yest.getFullYear()}-${String(yest.getMonth()+1).padStart(2,'0')}-${String(yest.getDate()).padStart(2,'0')}`;
  let prefix = '';
  if (dateStr === today) prefix = '오늘 · ';
  else if (dateStr === yestStr) prefix = '어제 · ';
  return `${prefix}${d.getMonth()+1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

/* =========================================================
   RENDER: BUDGET (예산)
   ========================================================= */
function renderBudget() {
  const page = document.getElementById('page-budget');
  const list = txInCursorMonth().filter(t => t.type === 'expense');
  const spentByCat = {};
  for (const t of list) spentByCat[t.categoryId] = (spentByCat[t.categoryId] || 0) + t.amount;

  const budgetCats = State.categories.filter(c => c.type === 'expense' && c.budget > 0);
  const totalBudget = budgetCats.reduce((s,c) => s + c.budget, 0);
  const totalSpent = budgetCats.reduce((s,c) => s + (spentByCat[c.id] || 0), 0);
  const totalPct = totalBudget > 0 ? Math.min(100, Math.round(totalSpent/totalBudget*100)) : 0;

  page.innerHTML = `
    <div class="appbar" style="padding-left:0;padding-right:0;">
      <h1>예산</h1>
      <button class="icon-btn" id="manageCatsBtn" style="width:auto;padding:0 14px;font-size:13px;font-weight:700;color:var(--primary);">항목 관리</button>
    </div>
    <div class="summary-month" style="justify-content:center; background:var(--card); border-radius:var(--radius-sm); padding:10px; box-shadow:var(--shadow); color:var(--text-1); margin-bottom:14px;">
      <button id="prevMonth3" style="color:var(--text-2);">${ICONS.chevLeft}</button>
      <span style="font-weight:700;">${monthLabel(State.cursorDate)}</span>
      <button id="nextMonth3" style="color:var(--text-2);">${ICONS.chevRight}</button>
    </div>

    ${budgetCats.length === 0 ? `
      <div class="card" style="text-align:center; padding:36px 20px;">
        <div style="font-size:14px; color:var(--text-2); line-height:1.6;">설정된 예산이 없어요<br>항목 관리에서 카테고리별 예산을 설정해보세요</div>
      </div>
    ` : `
      <div class="card" style="margin-bottom:16px;">
        <div class="budget-top">
          <div class="budget-name">전체 예산</div>
          <div class="budget-nums tabular"><b>${fmtMoney(totalSpent)}</b> / ${fmtMoney(totalBudget)}원</div>
        </div>
        <div class="budget-track"><div class="budget-fill" style="width:${totalPct}%; background:${budgetColor(totalPct)};"></div></div>
      </div>
      <div class="card">
        ${budgetCats.map(c => {
          const spent = spentByCat[c.id] || 0;
          const pct = Math.min(100, Math.round(spent / c.budget * 100));
          return `
            <div class="budget-item">
              <div class="budget-top">
                <div class="budget-name"><span style="font-size:16px;">${c.icon}</span>${c.name}</div>
                <div class="budget-nums tabular"><b>${fmtMoney(spent)}</b> / ${fmtMoney(c.budget)}원</div>
              </div>
              <div class="budget-track"><div class="budget-fill" style="width:${pct}%; background:${budgetColor(pct)};"></div></div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
  page.querySelector('#prevMonth3').addEventListener('click', () => changeMonth(-1));
  page.querySelector('#nextMonth3').addEventListener('click', () => changeMonth(1));
  page.querySelector('#manageCatsBtn').addEventListener('click', () => openCatManageSheet());
}

function budgetColor(pct) {
  if (pct < 70) return 'var(--income)';
  if (pct < 100) return '#F0A93A';
  return 'var(--expense)';
}

/* =========================================================
   RENDER: STATS (통계)
   ========================================================= */
/* =========================================================
   RENDER: STATS
   ========================================================= */

// 기간 계산: { start:'YYYY-MM-DD', end:'YYYY-MM-DD', label:string }
function statsPeriodRange() {
  const today = new Date();
  const todayStr = dateToStr(today);

  if (State.statsPeriod === 'week') {
    const d = new Date(today);
    d.setDate(d.getDate() + State.statsWeekOffset * 7);
    const day = d.getDay(); // 0=일
    const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7)); // 월요일
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const start = dateToStr(mon);
    const end   = dateToStr(sun);
    const label = `${mon.getMonth()+1}월 ${mon.getDate()}일 ~ ${sun.getMonth()+1}월 ${sun.getDate()}일`;
    return { start, end, label };
  }

  if (State.statsPeriod === 'month') {
    const d = new Date(State.cursorDate);
    const y = d.getFullYear(), m = d.getMonth();
    const start = `${y}-${String(m+1).padStart(2,'0')}-01`;
    const lastDay = new Date(y, m+1, 0).getDate();
    const end   = `${y}-${String(m+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    const label = `${y}년 ${m+1}월`;
    return { start, end, label };
  }

  if (State.statsPeriod === 'year') {
    const y = today.getFullYear() + State.statsYearOffset;
    return { start: `${y}-01-01`, end: `${y}-12-31`, label: `${y}년` };
  }

  if (State.statsPeriod === 'custom') {
    const s = State.statsCustomStart || todayStr;
    const e = State.statsCustomEnd   || todayStr;
    const sd = new Date(s), ed = new Date(e);
    const label = `${sd.getMonth()+1}월 ${sd.getDate()}일 ~ ${ed.getMonth()+1}월 ${ed.getDate()}일`;
    return { start: s, end: e, label };
  }

  return { start: todayStr, end: todayStr, label: '오늘' };
}

function txInPeriod(start, end) {
  return State.transactions.filter(t => t.date >= start && t.date <= end);
}

function renderStats() {
  const page = document.getElementById('page-stats');
  const range = statsPeriodRange();
  const allTx  = txInPeriod(range.start, range.end);
  const list   = allTx.filter(t => t.type === State.statsType);
  const isIncome = State.statsType === 'income';

  // 기간별 내역 (날짜순)
  const detailTx = list.slice().sort((a,b) => a.date.localeCompare(b.date) || b.createdAt - a.createdAt);

  const PERIOD_LABELS = { week:'주간', month:'월간', year:'연간', custom:'기간설정' };

  // 이전/다음 버튼 표시 여부
  const canNav = State.statsPeriod !== 'custom';

  // ── [통계] 탭: 수입=개인별 헌금 합계 / 지출=대분류별 합계 ──────────────
  // 수입: 헌금은 인물별 '대분류'로 관리되므로(대분류명 = 인물이름) categoryId 기준 집계
  // 지출: 대분류 기준 집계
  let statRows = [];
  let statTotal = 0;
  {
    const byCat = {};
    for (const t of list) {
      byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount;
      statTotal += t.amount;
    }
    statRows = Object.entries(byCat)
      .map(([catId, amt]) => {
        const cat = catById(catId) || {name:'삭제된 항목', color:'#9CA3AF', icon: isIncome ? '🙏' : '📦'};
        return { catId, icon: cat.icon, name: cat.name, color: cat.color, amt };
      })
      .sort((a,b) => b.amt - a.amt);
  }

  page.innerHTML = `
    <div class="appbar" style="padding-left:0;padding-right:0;">
      <h1>통계</h1>
    </div>

    <!-- 통계 | 내용 -->
    <div class="segctrl" style="margin-bottom:12px;">
      <button data-view="stats"  class="${State.statsView==='stats' ?'active':''}">통계</button>
      <button data-view="detail" class="${State.statsView==='detail'?'active':''}">내용</button>
    </div>

    <!-- 기간 모드 선택 -->
    <div style="display:flex; gap:6px; margin-bottom:12px; overflow-x:auto; padding-bottom:2px;">
      ${['week','month','year','custom'].map(p => `
        <button class="period-chip ${State.statsPeriod===p?'active':''}" data-period="${p}">
          ${PERIOD_LABELS[p]}
        </button>
      `).join('')}
    </div>

    <!-- 기간 네비게이터 -->
    <div class="summary-month" style="justify-content:center; background:var(--card); border-radius:var(--radius-sm); padding:10px; box-shadow:var(--shadow); margin-bottom:14px;">
      ${canNav ? `<button id="statsPrev" style="color:var(--text-2);">${ICONS.chevLeft}</button>` : `<div style="width:28px;"></div>`}
      <span style="font-weight:700; font-size:14px; flex:1; text-align:center;">${range.label}</span>
      ${canNav ? `<button id="statsNext" style="color:var(--text-2);">${ICONS.chevRight}</button>` : `<div style="width:28px;"></div>`}
    </div>

    <!-- 기간설정 입력 -->
    ${State.statsPeriod === 'custom' ? `
      <div class="card" style="padding:14px 16px; margin-bottom:14px; display:flex; gap:10px; align-items:center;">
        <input type="date" class="dateinput" id="customStart" value="${State.statsCustomStart || ''}" style="flex:1; font-size:13px;">
        <span style="color:var(--text-3);">~</span>
        <input type="date" class="dateinput" id="customEnd" value="${State.statsCustomEnd || ''}" style="flex:1; font-size:13px;">
      </div>
    ` : ''}

    <!-- 수입/지출 토글 -->
    <div class="segctrl" style="margin-bottom:14px;">
      <button data-type="expense" class="${State.statsType==='expense'?'active':''}">지출</button>
      <button data-type="income"  class="${State.statsType==='income' ?'active':''}">수입</button>
    </div>

    <!-- 요약 숫자 -->
    <div class="cal-summary-row" style="margin-bottom:14px;">
      <div class="cal-summary-col">
        <div class="cal-summary-label">수입</div>
        <div class="cal-summary-value income tabular">${fmtMoney(allTx.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0))}</div>
      </div>
      <div class="cal-summary-col">
        <div class="cal-summary-label">지출</div>
        <div class="cal-summary-value expense tabular">${fmtMoney(allTx.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0))}</div>
      </div>
      <div class="cal-summary-col">
        <div class="cal-summary-label">합계</div>
        <div class="cal-summary-value tabular">${fmtMoney(
          allTx.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0) -
          allTx.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)
        )}</div>
      </div>
    </div>

    ${State.statsView === 'stats' ? renderStatsTabBars(statRows, statTotal, isIncome) : renderStatsTabDetail(detailTx, isIncome)}
  `;

  // 이벤트
  page.querySelectorAll('.segctrl')[0].querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => { State.statsView = b.dataset.view; renderStats(); });
  });

  page.querySelectorAll('.period-chip').forEach(b => {
    b.addEventListener('click', () => {
      State.statsPeriod = b.dataset.period;
      if (State.statsPeriod === 'custom' && !State.statsCustomStart) {
        State.statsCustomStart = dateToStr(new Date());
        State.statsCustomEnd   = dateToStr(new Date());
      }
      renderStats();
    });
  });

  if (canNav) {
    page.querySelector('#statsPrev').addEventListener('click', () => {
      if (State.statsPeriod === 'week')  State.statsWeekOffset--;
      if (State.statsPeriod === 'month') changeMonth(-1);
      if (State.statsPeriod === 'year')  State.statsYearOffset--;
      renderStats();
    });
    page.querySelector('#statsNext').addEventListener('click', () => {
      if (State.statsPeriod === 'week')  State.statsWeekOffset++;
      if (State.statsPeriod === 'month') changeMonth(1);
      if (State.statsPeriod === 'year')  State.statsYearOffset++;
      renderStats();
    });
  }

  if (State.statsPeriod === 'custom') {
    page.querySelector('#customStart').addEventListener('change', e => {
      State.statsCustomStart = e.target.value;
      renderStats();
    });
    page.querySelector('#customEnd').addEventListener('change', e => {
      State.statsCustomEnd = e.target.value;
      renderStats();
    });
  }

  page.querySelectorAll('.segctrl')[1].querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => { State.statsType = b.dataset.type; renderStats(); });
  });

  page.querySelectorAll('.tx-item').forEach(el => {
    el.addEventListener('click', () => openTxSheet(el.dataset.id));
  });

  page.querySelectorAll('.stat-bar-row').forEach(el => {
    el.addEventListener('click', () => openCatStatDetail(el.dataset.catid));
  });

  page.querySelectorAll('.stats-agg-row').forEach(el => {
    el.addEventListener('click', () => openSubStatDetail(el.dataset.key));
  });
}

// [통계] 탭: 막대 차트형 요약 (수입=개인별 헌금 합계 / 지출=대분류별 합계)
function renderStatsTabBars(rows, total, isIncome) {
  if (rows.length === 0) {
    return `<div class="card" style="padding:6px 16px;">${emptyStateHTML('내역이 없어요', `선택한 기간의 ${isIncome?'수입':'지출'} 내역이 없습니다`)}</div>`;
  }
  return `
    <div class="card" style="margin-bottom:14px;">
      <div style="font-size:13px; color:var(--text-2); margin-bottom:12px;">
        ${isIncome ? '개인별 헌금액' : '대분류별 지출'} ·
        <b class="tabular" style="color:var(--text-1);">${fmtMoney(total)}원</b>
      </div>
      ${rows.map(r => {
        const pct = total > 0 ? Math.round(r.amt/total*100) : 0;
        return `
          <div class="stat-bar-row" data-catid="${r.catId}" style="cursor:pointer;">
            <div class="stat-bar-label">${r.icon} ${escapeHTML(r.name)}</div>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%; background:${r.color};"></div></div>
            <div class="stat-bar-amt tabular">${fmtMoney(r.amt)}</div>
            <div class="stat-bar-pct tabular">${pct}%</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// [내용] 탭: 수입=헌금 종류별 / 지출=대분류/소분류 집계 테이블
// 통계 [내용] 탭 집계: key → { label, amount, count, entries:[{txId,date,amount}] }
function buildStatsAggMap(detailTx, isIncome) {
  const aggMap = {};
  if (isIncome) {
    // 수입: 헌금 종류(세부항목 이름) 기준으로 집계
    for (const t of detailTx) {
      for (const l of (t.lines || [])) {
        const si  = subItemById(l.subItemId);
        const key = si ? si.name : 'etc';
        const lbl = key;
        if (!aggMap[key]) aggMap[key] = { label: lbl, amount: 0, count: 0, entries: [] };
        aggMap[key].amount += l.amount;
        aggMap[key].count  += 1;
        aggMap[key].entries.push({ txId: t.id, date: t.date, amount: l.amount, categoryId: t.categoryId });
      }
    }
  } else {
    // 지출: "대분류/소분류" 조합으로 집계
    for (const t of detailTx) {
      const cat = catById(t.categoryId) || { name: '기타' };
      for (const l of (t.lines || [])) {
        const si  = subItemById(l.subItemId);
        const key = `${t.categoryId}__${l.subItemId||''}`;
        const lbl = si ? `${cat.name}/${si.name}` : cat.name;
        if (!aggMap[key]) aggMap[key] = { label: lbl, amount: 0, count: 0, entries: [] };
        aggMap[key].amount += l.amount;
        aggMap[key].count  += 1;
        aggMap[key].entries.push({ txId: t.id, date: t.date, amount: l.amount, categoryId: t.categoryId });
      }
    }
  }
  return aggMap;
}

function renderStatsTabDetail(detailTx, isIncome) {
  const header = `
    <div class="section-title" style="display:flex; justify-content:space-between; align-items:center;">
      <span>내용</span>
      <div style="display:flex; gap:16px; font-size:11.5px; color:var(--text-3); font-weight:700; padding-right:2px;">
        <span style="min-width:36px; text-align:right;">건수</span>
        <span style="min-width:90px; text-align:right;">금액</span>
      </div>
    </div>
  `;

  if (detailTx.length === 0) {
    return header + `<div class="card" style="padding:6px 16px;">${emptyStateHTML('내역이 없어요', `선택한 기간의 ${isIncome?'수입':'지출'} 내역이 없습니다`)}</div>`;
  }

  const aggMap = buildStatsAggMap(detailTx, isIncome);

  const aggRows = Object.entries(aggMap)
    .map(([key, r]) => ({ key, ...r }))
    .sort((a,b) => b.amount - a.amount);
  const totalAmt = aggRows.reduce((s,r) => s+r.amount, 0);

  return header + `
    <div class="card" style="padding:0 16px;">
      ${aggRows.map(r => `
        <div class="stats-agg-row" data-key="${escapeHTML(r.key)}" style="cursor:pointer;">
          <div class="stats-agg-label">${escapeHTML(r.label)}</div>
          <div class="stats-agg-count tabular">${r.count}건</div>
          <div class="stats-agg-amt tabular ${isIncome ? 'income' : 'expense'}">
            ${fmtMoney(r.amount)}원
          </div>
        </div>
      `).join('')}
      <div class="stats-agg-total">
        <span style="font-weight:700; color:var(--text-2);">합계</span>
        <span class="tabular ${isIncome?'income':'expense'}" style="font-weight:800;">${fmtMoney(totalAmt)}원</span>
      </div>
    </div>
  `;
}

/* =========================================================
   RENDER: SETTINGS
   ========================================================= */
function renderSettings() {
  const page = document.getElementById('page-settings');
  page.innerHTML = `
    <div class="appbar" style="padding-left:0;padding-right:0;">
      <h1>설정</h1>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">관리</div>
      <div class="settings-row" id="rowCats">
        <div><div class="settings-label">수입/지출 항목 관리</div></div>
        ${ICONS.chevR}
      </div>
    </div>

    <div class="settings-group">
      <div class="settings-group-title">데이터</div>
      <div class="settings-row" id="rowExportExcel">
        <div>
          <div class="settings-label">엑셀로 내보내기</div>
          <div class="settings-sub">xlsx 파일로 거래 내역 내보내기</div>
        </div>
        ${ICONS.download}
      </div>
      <div class="settings-row" id="rowExport">
        <div>
          <div class="settings-label">데이터 백업 (JSON)</div>
          <div class="settings-sub">전체 데이터를 JSON 파일로 백업</div>
        </div>
        ${ICONS.download}
      </div>
      <div class="settings-row" id="rowImport">
        <div>
          <div class="settings-label">데이터 가져오기</div>
          <div class="settings-sub">백업 파일에서 복원</div>
        </div>
        ${ICONS.upload}
      </div>
      <input type="file" id="importFile" accept="application/json" style="display:none;">
    </div>

    <div class="settings-group">
      <div class="settings-group-title">정보</div>
      <div class="settings-row">
        <div class="settings-label">버전</div>
        <div class="settings-value">1.0.0 (로컬 저장)</div>
      </div>
      <div class="settings-row" id="rowReset">
        <div class="settings-label" style="color:var(--expense);">모든 데이터 초기화</div>
      </div>
    </div>
  `;
  page.querySelector('#rowCats').addEventListener('click', () => openCatManageSheet());
  page.querySelector('#rowExportExcel').addEventListener('click', exportExcel);
  page.querySelector('#rowExport').addEventListener('click', openBackupRangeSheet);
  page.querySelector('#rowImport').addEventListener('click', () => page.querySelector('#importFile').click());
  page.querySelector('#importFile').addEventListener('change', importData);
  page.querySelector('#rowReset').addEventListener('click', resetAllData);
}

/* =========================================================
   엑셀 내보내기 — 교회 회계부 양식
   컬럼: 일자 / 대분류 / 소분류 / 수입금액 / 지출금액 / 누계금액
   ========================================================= */

// 세부항목 표시명: 수입 세부항목 중 헌금 종류는 '...헌금' 접미어 부착
// (대분류가 인물이름으로 바뀌었으므로 세부항목 이름 자체로 판단)
const HEONG_SUBS_NO_SUFFIX = new Set(['십일조','통장이동','통장이동(퇴직)']);
function subItemDisplayName(catType, catName, subName) {
  // 이미 헌금으로 끝나면 그대로
  if (subName.endsWith('헌금')) return subName;
  // 예외 목록은 그대로
  if (HEONG_SUBS_NO_SUFFIX.has(subName)) return subName;
  // 수입 거래 세부항목이면 헌금 접미어 부착
  if (catType === 'income') return subName + '헌금';
  return subName;
}

// 거래 1건을 출력용 줄 단위로 풀어낸다.
// 인물단계 대분류: 대분류칸=인물이름, 소분류칸=세부항목명(헌금 표기)
// 인물단계 없는 대분류: 대분류칸=대분류명, 소분류칸=세부항목명
function explodeTxToRows(t) {
  const cat  = cats.get(t['categoryId'], {'name': '삭제된 항목', 'usePersonLevel': false, 'type': t['type']});
  const lines = (t['lines'] && t['lines'].length > 0) ? t['lines'] : [{ subItemId: null, amount: t['amount'] }];
  return lines.map(l => {
    const si = l['subItemId'] ? subItemById(l['subItemId']) : null;
    const subName = si ? subItemDisplayName(cat['type'], cat['name'], si['name']) : '';
    return {
      date: t['date'],
      major: cat['name'],   // 대분류명 = 인물이름 또는 카테고리명
      minor: subName,
      amount: l['amount'],
      type: t['type'],
    };
  });
}

// 지정 연/월 범위의 월 목록을 만든다. [{year, month}], month는 1~12
function buildMonthRange(startYear, startMonth, endYear, endMonth) {
  const months = [];
  let y = startYear, m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    months.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

const EXCEL_HEADER = ['일자', '대분류', '소분류', '수입금액', '지출금액', '누계금액'];

// 한 달치 결산에 필요한 항목별 합계 계산
function monthCalc(txs, year, month) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const list = txs.filter(t => t.date.startsWith(ym));
  let income = 0, expense = 0;
  for (const t of list) { if (t.type === 'income') income += t.amount; else expense += t.amount; }

  // 통장이동(선교) = 그 달 '교회' 대분류(또는 통장이동 세부항목을 가진 임의 수입 대분류)의 '통장이동' 세부항목 합계
  // 구 구조(헌금 대분류)와 신 구조(교회 대분류) 모두 지원
  let missionTransfer = 0;
  // '통장이동' 이름의 세부항목을 가진 수입 거래 전체를 합산
  const transferSubIds = new Set(
    State.subItems
      .filter(s => s.name === '통장이동')
      .map(s => s.id)
  );
  if (transferSubIds.size > 0) {
    for (const t of list) {
      if (t.type !== 'income') continue;
      for (const l of (t.lines || [])) {
        if (transferSubIds.has(l.subItemId)) missionTransfer += l.amount;
      }
    }
  }

  // 예금 = 그 달 '예금' 지출 대분류 합계
  const depositCat = State.categories.find(c => c.type === 'expense' && c.name === '예금');
  let depositTotal = 0;
  if (depositCat) {
    for (const t of list) {
      if (t.categoryId === depositCat.id) depositTotal += t.amount;
    }
  }

  return {
    list,
    income,
    expense,
    missionTransfer,
    depositTotal,
    netIncome: income - missionTransfer,
    netExpense: expense,
  };
}

async function ensureYearCarryover(year) {
  let amount = await getYearCarryover(year);
  if (amount === null) {
    const input = prompt(`${year}년 전년이월 금액을 입력해주세요 (처음 한 번만 입력하면 계속 사용됩니다)`, '0');
    if (input === null) return null; // 사용자가 취소
    amount = Number(rawDigits(input)) || 0;
    await setYearCarryover(year, amount);
  }
  return amount;
}

async function exportExcel() {
  if (State.transactions.length === 0) { showToast('내보낼 거래가 없어요'); return; }
  openExcelRangeSheet();
}

function availableMonthsFromTx() {
  const set = new Set();
  for (const t of State.transactions) set.add(t.date.slice(0, 7)); // YYYY-MM
  return Array.from(set).sort();
}

function openExcelRangeSheet() {
  const months = availableMonthsFromTx();
  if (months.length === 0) { showToast('내보낼 거래가 없어요'); return; }
  renderExcelRangeSheet(months, months[0], months[months.length - 1]);
  openSheet('excelRangeSheet');
}

function renderExcelRangeSheet(months, startYm, endYm) {
  const sheet = document.getElementById('excelRangeSheet');
  const optionHTML = months.map(ym => {
    const [y, m] = ym.split('-');
    return `<option value="${ym}">${y}년 ${Number(m)}월</option>`;
  }).join('');

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <h3>엑셀 내보내기 범위</h3>
      <button id="excClose" class="sheet-close-btn">${ICONS.close}닫기</button>
    </div>
    <div class="sheet-body">
      <div class="formrow">
        <label>시작 월</label>
        <select class="dateinput" id="excStart">${optionHTML}</select>
      </div>
      <div class="formrow">
        <label>종료 월</label>
        <select class="dateinput" id="excEnd">${optionHTML}</select>
      </div>
      <div style="font-size:12.5px; color:var(--text-3); padding:0 2px 16px;">한 달만 내보내려면 시작 월과 종료 월을 같게 선택하세요. 달마다 시트가 따로 만들어집니다.</div>
      <button class="btn-primary" id="excGo">엑셀 파일 만들기</button>
    </div>
  `;
  sheet.querySelector('#excStart').value = startYm;
  sheet.querySelector('#excEnd').value = endYm;

  sheet.querySelector('#excClose').addEventListener('click', closeAllSheets);
  sheet.querySelector('#excGo').addEventListener('click', async () => {
    const sYm = sheet.querySelector('#excStart').value;
    const eYm = sheet.querySelector('#excEnd').value;
    let [sy, sm] = sYm.split('-').map(Number);
    let [ey, em] = eYm.split('-').map(Number);
    if (sy > ey || (sy === ey && sm > em)) { showToast('시작 월이 종료 월보다 늦어요'); return; }

    const monthsRange = buildMonthRange(sy, sm, ey, em);
    const yearsNeeded = Array.from(new Set(monthsRange.map(m => m.year)));
    const carryoverByYear = {};
    for (const y of yearsNeeded) {
      const amt = await ensureYearCarryover(y);
      if (amt === null) { showToast('취소되었습니다'); return; }
      carryoverByYear[y] = amt;
    }

    const wb = generateChurchLedgerWorkbook(monthsRange, carryoverByYear);
    const fname = (sYm === eYm) ? `회계부-${sYm}.xlsx` : `회계부-${sYm}_${eYm}.xlsx`;
    XLSX.writeFile(wb, fname);
    closeAllSheets();
    showToast('엑셀 내보내기 완료');
  });
}

// 실제 엑셀 생성: months = [{year, month}] (출력할 달), carryoverByYear = { year: amount }
function generateChurchLedgerWorkbook(months, carryoverByYear) {
  const wb = XLSX.utils.book_new();
  if (months.length === 0) return wb;

  // 누계는 항상 그 해 1월부터 정확히 계산해야 하므로,
  // 출력 시작월이 1월이 아니면 1월~(시작월-1)까지를 '선행 계산'으로 누계만 구해둔다(시트에는 안 보임).
  const firstOut = months[0];
  let runningTotal = carryoverByYear[firstOut.year] || 0;
  for (let m = 1; m < firstOut.month; m++) {
    const calc = monthCalc(State.transactions, firstOut.year, m);
    const sortedTx = calc.list.slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    for (const t of sortedTx) {
      for (const r of explodeTxToRows(t)) {
        runningTotal += (r.type === 'income') ? r.amount : -r.amount;
      }
    }
  }

  let lastYear = null;

  for (const { year, month } of months) {
    // 연도가 바뀌면(이 범위 안에서 새 해로 넘어가면) 그 해의 carryover로 누계를 다시 맞춘다.
    if (year !== lastYear) {
      if (lastYear !== null) {
        // 새 해로 넘어가는 경우: 1월부터 다시 선행 계산 (month가 1이 아닐 일은 없지만 안전하게)
        runningTotal = carryoverByYear[year] || 0;
        for (let m = 1; m < month; m++) {
          const calc = monthCalc(State.transactions, year, m);
          const sortedTx = calc.list.slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
          for (const t of sortedTx) {
            for (const r of explodeTxToRows(t)) {
              runningTotal += (r.type === 'income') ? r.amount : -r.amount;
            }
          }
        }
      }
      lastYear = year;
    }

    const aoa = [];
    const merges = [];

    aoa.push(EXCEL_HEADER);

    // 그 해의 1월을 출력하는 경우에만 '전년이월' 줄 표시
    if (month === 1) {
      const carry = carryoverByYear[year] || 0;
      aoa.push([`${year}-01-01`, '전년이월', '전년이월', carry, '', carry]);
    }

    const calc = monthCalc(State.transactions, year, month);
    const sortedTx = calc.list.slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

    for (const t of sortedTx) {
      const rows = explodeTxToRows(t);
      for (const r of rows) {
        if (r.type === 'income') runningTotal += r.amount;
        else runningTotal -= r.amount;
        aoa.push([
          r.date,
          r.major,
          r.minor,
          r.type === 'income' ? r.amount : '',
          r.type === 'expense' ? r.amount : '',
          runningTotal,
        ]);
      }
    }

    // 월 결산 5줄 (결산 줄 자체는 누계에 영향 주지 않음)
    aoa.push([`${month}월 결산`, '', '', calc.income, -calc.expense, '']);
    aoa.push(['', '통장이동(선교)', '', calc.missionTransfer, '', '']);
    aoa.push(['', '예금', '', '', -calc.depositTotal, '']);
    aoa.push(['', '순헌금/지출', '', calc.netIncome, -calc.netExpense, '']);

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // D, E, F열(수입금액/지출금액/누계금액) 숫자 셀에 천단위 콤마 서식 적용
    const numFmtCols = [3, 4, 5]; // D, E, F (0-indexed)
    for (let r = 0; r < aoa.length; r++) {
      for (const c of numFmtCols) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && typeof cell.v === 'number') {
          cell.z = '#,##0;-#,##0';
        }
      }
    }

    ws['!cols'] = [
      { wch: 10 }, // 일자
      { wch: 10 }, // 대분류
      { wch: 11 }, // 소분류
      { wch: 11 }, // 수입금액
      { wch: 11 }, // 지출금액
      { wch: 11 }, // 누계금액
      { wch: 9 },
    ];
    ws['!merges'] = merges;
    // A4 인쇄 설정 (가로 폭을 한 페이지에 맞춤)
    ws['!pageSetup'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 0, scale: 100 };
    ws['!margins'] = { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 };

    const sheetName = `${String(year).slice(2)}년${month}월`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  return wb;
}

function openBackupRangeSheet() {
  if (State.transactions.length === 0) { showToast('내보낼 거래가 없어요'); return; }
  const months = availableMonthsFromTx();
  renderBackupRangeSheet(months, months[0], months[months.length - 1]);
  openSheet('backupRangeSheet');
}

function renderBackupRangeSheet(months, startYm, endYm) {
  const sheet = document.getElementById('backupRangeSheet');
  const optionHTML = months.map(ym => {
    const [y, m] = ym.split('-');
    return `<option value="${ym}">${y}년 ${Number(m)}월</option>`;
  }).join('');

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <h3>데이터 백업 범위</h3>
      <button id="bkClose" class="sheet-close-btn">${ICONS.close}닫기</button>
    </div>
    <div class="sheet-body">
      <div class="formrow">
        <label>시작 월</label>
        <select class="dateinput" id="bkStart">${optionHTML}</select>
      </div>
      <div class="formrow">
        <label>종료 월</label>
        <select class="dateinput" id="bkEnd">${optionHTML}</select>
      </div>
      <div style="font-size:12.5px; color:var(--text-3); padding:0 2px 16px;">선택한 기간의 거래 데이터와 모든 카테고리/이름 정보가 함께 저장됩니다.</div>
      <button class="btn-primary" id="bkGo">JSON 백업 파일 만들기</button>
    </div>
  `;
  sheet.querySelector('#bkStart').value = startYm;
  sheet.querySelector('#bkEnd').value = endYm;

  sheet.querySelector('#bkClose').addEventListener('click', closeAllSheets);
  sheet.querySelector('#bkGo').addEventListener('click', () => {
    const sYm = sheet.querySelector('#bkStart').value;
    const eYm = sheet.querySelector('#bkEnd').value;
    if (sYm > eYm) { showToast('시작 월이 종료 월보다 늦어요'); return; }
    exportData(sYm, eYm);
    closeAllSheets();
  });
}

async function exportData(startYm, endYm) {
  // 범위 내 거래만 필터 (인수 없으면 전체)
  const txs = (startYm && endYm)
    ? State.transactions.filter(t => t.date.slice(0, 7) >= startYm && t.date.slice(0, 7) <= endYm)
    : State.transactions;

  const [sy, sm] = startYm ? startYm.split('-') : ['', ''];
  const [ey, em] = endYm   ? endYm.split('-')   : ['', ''];
  const rangeLabel = (startYm && endYm && startYm !== endYm)
    ? `${sy}년${Number(sm)}월-${ey}년${Number(em)}월`
    : startYm ? `${sy}년${Number(sm)}월` : todayStr();

  const data = {
    exportedAt: new Date().toISOString(),
    rangeStart: startYm || null,
    rangeEnd:   endYm   || null,
    categories: State.categories,
    persons:    State.persons,
    subItems:   State.subItems,
    transactions: txs,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-${rangeLabel}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`${txs.length}건 백업 완료`);
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.categories || !data.transactions) throw new Error('invalid');
      const replace = confirm(
        `${data.categories.length}개 항목, ${data.transactions.length}개 거래가 있는 백업 파일입니다.\n\n` +
        `[확인]을 누르면 기존 데이터를 모두 지우고 이 파일로 교체합니다.\n` +
        `[취소]를 누르면 가져오기를 중단합니다.\n\n` +
        `(기존 데이터에 추가하려면 취소 후 설정에서 별도로 진행해주세요)`
      );
      if (!replace) return;

      // 기존 데이터 전체 삭제 후 교체
      const [oldCats, oldPersons, oldSubs, oldTxs] = await Promise.all([
        DB.getAll('categories'), DB.getAll('persons'), DB.getAll('subItems'), DB.getAll('transactions')
      ]);
      for (const x of oldTxs) await DB.del('transactions', x.id);
      for (const x of oldSubs) await DB.del('subItems', x.id);
      for (const x of oldPersons) await DB.del('persons', x.id);
      for (const x of oldCats) await DB.del('categories', x.id);

      for (const c of data.categories) await DB.put('categories', c);
      for (const p of (data.persons || [])) await DB.put('persons', p);
      for (const s of (data.subItems || [])) await DB.put('subItems', s);
      for (const t of data.transactions) await DB.put('transactions', t);
      await reloadData();
      renderCurrentPage();
      showToast('가져오기 완료');
    } catch (err) {
      alert('올바른 백업 파일이 아닙니다.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

async function resetAllData() {
  if (!confirm('모든 거래와 항목이 삭제됩니다. 계속할까요?')) return;
  if (!confirm('정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
  const [cats, persons, subItems, txs] = await Promise.all([
    DB.getAll('categories'), DB.getAll('persons'), DB.getAll('subItems'), DB.getAll('transactions')
  ]);
  for (const c of cats) await DB.del('categories', c.id);
  for (const p of persons) await DB.del('persons', p.id);
  for (const s of subItems) await DB.del('subItems', s.id);
  for (const t of txs) await DB.del('transactions', t.id);
  await seedIfEmpty();
  await reloadData();
  renderCurrentPage();
  showToast('초기화 완료');
}

/* =========================================================
   SHEETS: shared open/close
   ========================================================= */
function closeAllSheets() {
  document.getElementById('sheetBackdrop').classList.remove('show');
  document.querySelectorAll('.sheet').forEach(s => s.classList.remove('show'));
  State.dayDetailDate = null;
  State.catStatDetailId = null;
  State.subStatDetailKey = null;
}

function openSheet(id) {
  document.getElementById('sheetBackdrop').classList.add('show');
  document.getElementById(id).classList.add('show');
}

// 거래입력 시트(txSheet)만 닫기: 일별상세/통계항목상세에서 열렸으면 그 화면으로 복귀, 아니면 전체 닫기
function closeTxSheet() {
  if (State.dayDetailDate) {
    document.getElementById('txSheet').classList.remove('show');
    openDayDetail(State.dayDetailDate);
  } else if (State.catStatDetailId) {
    document.getElementById('txSheet').classList.remove('show');
    openCatStatDetail(State.catStatDetailId);
  } else if (State.subStatDetailKey) {
    document.getElementById('txSheet').classList.remove('show');
    openSubStatDetail(State.subStatDetailKey);
  } else {
    closeAllSheets();
  }
}

/* =========================================================
   TX SHEET (거래 추가/수정) — 3단계: 대분류 -> (하위항목:이름) -> 세부항목 다중입력
   ========================================================= */
function resetTxForm(type) {
  State.formType = type || 'expense';
  State.formStep = 'pick';
  State.formCategoryId = null;
  State.formPersonId = null;
  State.formDate = todayStr();
  State.formMemo = '';
  State.formAmounts = {};
}

function openTxSheet(txId, presetDate, presetType) {
  const editing = txId ? State.transactions.find(t => t.id === txId) : null;
  State.editingTx = editing;

  if (editing) {
    State.formType = editing.type;
    State.formCategoryId = editing.categoryId;
    State.formPersonId = editing.personId || null;
    State.formDate = editing.date;
    State.formMemo = editing.memo || '';
    State.formAmounts = {};
    (editing.lines || []).forEach(l => { State.formAmounts[l.subItemId] = l.amount; });
    // 수정 시에는 바로 항목 입력 단계로 진입 (대분류/이름은 이미 확정된 상태로 보여줌)
    State.formStep = 'items';
  } else {
    resetTxForm(presetType || 'expense');
    if (presetDate) State.formDate = presetDate;
  }

  renderTxSheet();
  openSheet('txSheet');
}

function renderTxSheet() {
  const sheet = document.getElementById('txSheet');
  if (State.formStep === 'pick') {
    renderTxStepPick(sheet);
  } else {
    renderTxStepItems(sheet);
  }
}

/* ---- STEP 1: 중분류 선택 (대분류는 건너뛰고 바로 중분류부터) ----
   하위항목(중분류)을 쓰는 대분류는 그 사람들/이름을, 그렇지 않은 대분류는
   대분류 자기 자신을 하나짜리 중분류처럼 만들어, 전부 하나의 목록으로 합쳐
   이름순으로 정렬해서 보여준다. 고르면 다음 단계(소분류 금액 입력)로 넘어간다. */
function renderTxStepPick(sheet) {
  const cats = State.categories.filter(c => c.type === State.formType);

  const flat = [];
  for (const c of cats) {
    if (c.usePersonLevel) {
      for (const p of personsOfCategory(c.id)) {
        flat.push({ catId: c.id, personId: p.id, name: p.name, icon: c.icon, color: c.color });
      }
    } else {
      flat.push({ catId: c.id, personId: null, name: c.name, icon: c.icon, color: c.color });
    }
  }
  flat.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <h3>새 거래</h3>
      <button id="txClose" class="sheet-close-btn">${ICONS.close}취소</button>
    </div>
    <div class="sheet-body">
      <div class="typeswitch">
        <button data-type="expense" class="${State.formType==='expense'?'active expense':''}">지출</button>
        <button data-type="income" class="${State.formType==='income'?'active income':''}">수입</button>
      </div>
      <div class="formrow">
        <label>항목 선택</label>
        <div class="catgrid">
          ${flat.map(item => `
            <button class="catchip" data-pick-cat="${item.catId}" data-pick-person="${item.personId || ''}">
              <span class="ic" style="background:${hexToLight(item.color)};">${item.icon}</span>
              <span>${escapeHTML(item.name)}</span>
            </button>
          `).join('')}
        </div>
        ${flat.length === 0 ? `<div style="font-size:13px;color:var(--text-3);padding:8px 2px;">설정에서 대분류를 먼저 추가해주세요</div>` : ''}
      </div>
    </div>
  `;
  sheet.querySelector('#txClose').addEventListener('click', closeTxSheet);
  sheet.querySelectorAll('.typeswitch button').forEach(b => {
    b.addEventListener('click', () => {
      State.formType = b.dataset.type;
      State.formCategoryId = null;
      renderTxStepPick(sheet);
    });
  });
  sheet.querySelectorAll('[data-pick-cat]').forEach(b => {
    b.addEventListener('click', () => {
      State.formCategoryId = b.dataset.pickCat;
      State.formPersonId = b.dataset.pickPerson || null;
      State.formAmounts = {};
      State.formStep = 'items';
      renderTxSheet();
    });
  });
}

/* ---- STEP 3: 세부항목 다중 입력 ---- */
function renderTxStepItems(sheet) {
  const editing = State.editingTx;
  const cat = catById(State.formCategoryId);
  const person = State.formPersonId ? personById(State.formPersonId) : null;
  const items = subItemsOfCategory(cat.id);
  const total = Object.values(State.formAmounts).reduce((s, v) => s + (Number(v) || 0), 0);

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head" style="flex-direction:column; align-items:stretch; gap:10px; padding-bottom:12px;">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        ${!editing ? `<button id="txBack" style="font-size:13px;color:var(--text-2);display:flex;align-items:center;gap:2px;">${ICONS.chevLeft}이전</button>` : `<div style="width:40px;"></div>`}
        <div style="text-align:center;">
          <h3 style="line-height:1.3;">${cat.icon} ${person ? escapeHTML(person.name) : cat.name}</h3>
          <div style="font-size:12px; color:var(--text-3); font-weight:600;">${dayLabel(State.formDate)}</div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <button id="txClose" class="sheet-close-btn">${ICONS.close}취소</button>
          <button id="txSave" style="color:var(--primary); font-weight:800; font-size:14.5px; white-space:nowrap;">${editing ? '수정 완료' : '저장'}</button>
        </div>
      </div>
      <div class="card" style="background:var(--bg); box-shadow:none; display:flex; justify-content:space-between; align-items:center; margin:0;">
        <span style="font-size:13.5px; color:var(--text-2); font-weight:600;">합계</span>
        <span class="tabular" style="font-size:19px; font-weight:800; color:${State.formType==='income'?'var(--primary)':'var(--expense)'};">${fmtMoney(total)}원</span>
      </div>
    </div>
    <div class="sheet-body">
      <div class="formrow">
        <label>세부항목별 금액 입력</label>
        <div id="itemsList">
          ${items.map(it => `
            <div class="formrow" style="margin-bottom:12px;">
              <label style="font-weight:600; color:var(--text-1); margin-bottom:6px;">${escapeHTML(it.name)}</label>
              <div class="amt-input-wrap item-amt-wrap">
                <input type="text" inputmode="numeric" class="item-amt-input" data-item="${it.id}" placeholder="0" value="${State.formAmounts[it.id] != null ? fmtMoney(State.formAmounts[it.id]) : ''}">
                <span class="won">원</span>
              </div>
            </div>
          `).join('')}
        </div>
        <div style="display:flex; gap:8px; margin-top:4px;">
          <input type="text" class="textinput" id="newSubItemName" placeholder="새 세부항목 추가" style="flex:1;">
          <button class="btn-secondary" id="addSubItemBtn" style="width:auto; padding:0 16px; margin-top:0; color:var(--primary); font-weight:700;">추가</button>
        </div>
        ${items.length === 0 ? `<div style="font-size:13px;color:var(--text-3);padding:8px 2px 0;">세부항목이 없어요. 위에서 추가해주세요</div>` : ''}
      </div>

      ${editing ? `<button class="btn-secondary" id="txDelete" style="color:var(--expense);">삭제</button>` : ''}
    </div>
  `;

  sheet.querySelector('#txClose').addEventListener('click', closeTxSheet);
  const backBtn = sheet.querySelector('#txBack');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      State.formStep = 'pick';
      renderTxSheet();
    });
  }

  sheet.querySelectorAll('.item-amt-input').forEach(input => {
    attachMoneyInputFormatter(input, (numVal) => {
      if (numVal === null) delete State.formAmounts[input.dataset.item];
      else State.formAmounts[input.dataset.item] = numVal;
      // 합계만 갱신 (전체 리렌더 없이 가볍게)
      const totalNow = Object.values(State.formAmounts).reduce((s, vv) => s + (Number(vv) || 0), 0);
      const totalEl = sheet.querySelector('.card .tabular');
      if (totalEl) totalEl.textContent = fmtMoney(totalNow) + '원';
    });
    const wrap = input.closest('.amt-input-wrap');
    input.addEventListener('focus', () => wrap.classList.add('focus'));
    input.addEventListener('blur', () => wrap.classList.remove('focus'));
  });

  sheet.querySelector('#addSubItemBtn').addEventListener('click', () => addSubItemInline(sheet, cat.id));
  sheet.querySelector('#newSubItemName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addSubItemInline(sheet, cat.id);
  });

  sheet.querySelector('#txSave').addEventListener('click', saveTx);
  if (editing) sheet.querySelector('#txDelete').addEventListener('click', deleteTx);
}

async function addSubItemInline(sheet, categoryId) {
  const input = sheet.querySelector('#newSubItemName');
  const name = input.value.trim();
  if (!name) { showToast('세부항목 이름을 입력해주세요'); return; }
  const existing = subItemsOfCategory(categoryId).find(s => s.name === name);
  if (existing) { showToast('이미 있는 항목이에요'); return; }
  const subItem = { id: uid(), categoryId, name, order: subItemsOfCategory(categoryId).length };
  await DB.put('subItems', subItem);
  await reloadData();
  renderTxSheet();
}

async function saveTx() {
  const date = State.formDate;
  const memo = '';
  const cat = catById(State.formCategoryId);

  const lines = Object.entries(State.formAmounts)
    .filter(([, amt]) => Number(amt) > 0)
    .map(([subItemId, amt]) => ({ subItemId, amount: Number(amt) }));

  if (lines.length === 0) { showToast('금액을 1개 이상 입력해주세요'); return; }
  if (cat.usePersonLevel && !State.formPersonId) { showToast('이름을 선택해주세요'); return; }
  if (!date) { showToast('날짜를 선택해주세요'); return; }

  const total = lines.reduce((s, l) => s + l.amount, 0);

  const record = {
    id: State.editingTx ? State.editingTx.id : uid(),
    type: State.formType,
    categoryId: State.formCategoryId,
    personId: State.formPersonId || null,
    lines,
    amount: total,
    date,
    memo,
    createdAt: State.editingTx ? State.editingTx.createdAt : Date.now(),
  };
  await DB.put('transactions', record);
  await reloadData();
  closeTxSheet();
  renderCurrentPage();
  showToast(State.editingTx ? '수정되었습니다' : '저장되었습니다');
}

async function deleteTx() {
  if (!confirm('이 거래를 삭제할까요?')) return;
  await DB.del('transactions', State.editingTx.id);
  await reloadData();
  closeTxSheet();
  renderCurrentPage();
  showToast('삭제되었습니다');
}

/* =========================================================
   DAY DETAIL SHEET — 날짜 탭 시 그 날의 거래 목록 + 추가
   ========================================================= */
function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['일','월','화','수','목','금','토'];
  return `${d.getMonth()+1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

function openDayDetail(dateStr) {
  State.dayDetailDate = dateStr;
  renderDayDetail(dateStr);
  openSheet('dayDetailSheet');
}

function renderDayDetail(dateStr) {
  const sheet = document.getElementById('dayDetailSheet');
  const list = State.transactions.filter(t => t.date === dateStr);
  let income = 0, expense = 0;
  for (const t of list) { if (t.type === 'income') income += t.amount; else expense += t.amount; }

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <button id="ddClose" class="sheet-close-btn">${ICONS.close}닫기</button>
      <h3>${dayLabel(dateStr)}</h3>
      <button class="sheet-close-btn" style="visibility:hidden;">${ICONS.close}닫기</button>
    </div>
    <div class="sheet-body">
      <div class="daydetail-summary">
        <span>수입 <b class="income tabular">${fmtMoney(income)}원</b></span>
        <span>지출 <b class="expense tabular">${fmtMoney(expense)}원</b></span>
      </div>

      <div class="day-add-row">
        <button class="day-add-btn income" id="ddAddIncome">${ICONS.plus} 수입 추가</button>
        <button class="day-add-btn expense" id="ddAddExpense">${ICONS.plus} 지출 추가</button>
      </div>

      <div class="card" style="padding:4px 16px;">
        ${list.length === 0 ? emptyStateHTML('이 날의 내역이 없어요', '위 버튼으로 수입이나 지출을 추가해보세요') : list.map(txItemHTML).join('')}
      </div>
    </div>
  `;

  sheet.querySelector('#ddClose').addEventListener('click', closeAllSheets);
  sheet.querySelector('#ddAddIncome').addEventListener('click', () => openTxSheet(null, dateStr, 'income'));
  sheet.querySelector('#ddAddExpense').addEventListener('click', () => openTxSheet(null, dateStr, 'expense'));
  sheet.querySelectorAll('.tx-item').forEach(el => {
    el.addEventListener('click', () => openTxSheet(el.dataset.id, dateStr));
  });
}

/* =========================================================
   CAT STAT DETAIL SHEET — 통계 탭에서 항목(인물/대분류) 클릭 시
   해당 기간의 해당 항목 거래 내역을 일자별로 나열
   ========================================================= */
function openCatStatDetail(categoryId) {
  State.catStatDetailId = categoryId;
  renderCatStatDetail(categoryId);
  openSheet('catStatDetailSheet');
}

function renderCatStatDetail(categoryId) {
  const sheet = document.getElementById('catStatDetailSheet');
  const range = statsPeriodRange();
  const cat = catById(categoryId) || { name: '삭제된 항목', icon: '📦', color: '#9CA3AF' };
  const list = txInPeriod(range.start, range.end)
    .filter(t => t.type === State.statsType && t.categoryId === categoryId)
    .sort((a,b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

  const total = list.reduce((s,t) => s + t.amount, 0);

  // 날짜별 그룹화
  const byDate = {};
  for (const t of list) {
    (byDate[t.date] = byDate[t.date] || []).push(t);
  }
  const dates = Object.keys(byDate).sort();

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <button id="csdClose" class="sheet-close-btn">${ICONS.close}닫기</button>
      <h3>${cat.icon} ${escapeHTML(cat.name)}</h3>
      <button class="sheet-close-btn" style="visibility:hidden;">${ICONS.close}닫기</button>
    </div>
    <div class="sheet-body">
      <div class="daydetail-summary">
        <span>${range.label}</span>
        <b class="tabular ${State.statsType}">${fmtMoney(total)}원</b>
      </div>

      ${dates.length === 0
        ? `<div class="card" style="padding:6px 16px;">${emptyStateHTML('내역이 없어요', '선택한 기간의 거래 내역이 없습니다')}</div>`
        : dates.map(d => `
            <div class="section-title">${dayLabel(d)}</div>
            <div class="card" style="padding:4px 16px; margin-bottom:14px;">
              ${byDate[d].map(txItemHTML).join('')}
            </div>
          `).join('')
      }
    </div>
  `;

  sheet.querySelector('#csdClose').addEventListener('click', closeAllSheets);
  sheet.querySelectorAll('.tx-item').forEach(el => {
    el.addEventListener('click', () => openTxSheet(el.dataset.id));
  });
}

/* =========================================================
   SUB STAT DETAIL SHEET — 통계 [내용] 탭에서 집계 항목(헌금종류/대분류·소분류)
   클릭 시 해당 기간의 해당 항목 내역을 일자별로 나열
   ========================================================= */
function openSubStatDetail(key) {
  State.subStatDetailKey = key;
  renderSubStatDetail(key);
  openSheet('subStatDetailSheet');
}

function renderSubStatDetail(key) {
  const sheet = document.getElementById('subStatDetailSheet');
  const range = statsPeriodRange();
  const isIncome = State.statsType === 'income';
  const allTx  = txInPeriod(range.start, range.end);
  const detailTx = allTx.filter(t => t.type === State.statsType);
  const aggMap = buildStatsAggMap(detailTx, isIncome);
  const agg = aggMap[key] || { label: '내역', amount: 0, count: 0, entries: [] };

  const entries = agg.entries.slice().sort((a,b) => a.date.localeCompare(b.date));

  // 날짜별 그룹화
  const byDate = {};
  for (const e of entries) {
    (byDate[e.date] = byDate[e.date] || []).push(e);
  }
  const dates = Object.keys(byDate).sort();

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <button id="ssdClose" class="sheet-close-btn">${ICONS.close}닫기</button>
      <h3>${escapeHTML(agg.label)}</h3>
      <button class="sheet-close-btn" style="visibility:hidden;">${ICONS.close}닫기</button>
    </div>
    <div class="sheet-body">
      <div class="daydetail-summary">
        <span>${range.label}</span>
        <b class="tabular ${isIncome ? 'income' : 'expense'}">${fmtMoney(agg.amount)}원</b>
      </div>

      ${dates.length === 0
        ? `<div class="card" style="padding:6px 16px;">${emptyStateHTML('내역이 없어요', '선택한 기간의 거래 내역이 없습니다')}</div>`
        : dates.map(d => `
            <div class="section-title">${dayLabel(d)}</div>
            <div class="card" style="padding:0 16px; margin-bottom:14px;">
              ${byDate[d].map(e => {
                const cat = catById(e.categoryId) || { name: '삭제된 항목', icon:'📦', color:'#9CA3AF' };
                return `
                  <div class="stats-agg-row tx-item" data-id="${e.txId}" style="cursor:pointer;">
                    <div class="stats-agg-label">${cat.icon ? cat.icon + ' ' : ''}${escapeHTML(cat.name)}</div>
                    <div class="stats-agg-amt tabular ${isIncome ? 'income' : 'expense'}">${fmtMoney(e.amount)}원</div>
                  </div>
                `;
              }).join('')}
            </div>
          `).join('')
      }
    </div>
  `;

  sheet.querySelector('#ssdClose').addEventListener('click', closeAllSheets);
  sheet.querySelectorAll('.tx-item').forEach(el => {
    el.addEventListener('click', () => openTxSheet(el.dataset.id));
  });
}

/* =========================================================
   CATEGORY MANAGE SHEET (목록)
   ========================================================= */
let catManageType = 'expense';
let catManageExpanded = new Set();

function openCatManageSheet() {
  catManageType = 'expense';
  catManageExpanded = new Set();
  renderCatManageSheet();
  openSheet('catManageSheet');
}

function renderCatManageSheet() {
  const sheet = document.getElementById('catManageSheet');
  const cats = State.categories.filter(c => c.type === catManageType);
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <h3>항목 관리</h3>
      <button id="catMClose" class="sheet-close-btn">${ICONS.close}닫기</button>
    </div>
    <div class="sheet-body">
      <div class="segctrl">
        <button data-type="expense" class="${catManageType==='expense'?'active':''}">지출 항목</button>
        <button data-type="income" class="${catManageType==='income'?'active':''}">수입 항목</button>
      </div>
      <div class="card" style="padding:4px 14px;">
        ${cats.map(c => {
          const subs = subItemsOfCategory(c.id);
          const persons = c.usePersonLevel ? personsOfCategory(c.id) : [];
          const hasChildren = subs.length > 0 || persons.length > 0;
          const expanded = catManageExpanded.has(c.id);
          const leafRow = (item, store, isItems) => `
            <div class="cattree-leaf">
              <span>${escapeHTML(item.name)}</span>
              <div style="display:flex; gap:2px;">
                <button class="grip" data-tree-rename="${item.id}" data-tree-store="${store}">${ICONS.edit}</button>
                <button class="grip" data-tree-del="${item.id}" data-tree-store="${store}" data-tree-isitems="${isItems}" style="color:var(--expense);">${ICONS.trash}</button>
              </div>
            </div>`;
          const addRow = (mode, placeholder) => `
            <div class="cattree-addrow">
              <input type="text" class="textinput" data-tree-addinput="${c.id}" data-tree-addmode="${mode}" placeholder="${placeholder}">
              <button class="btn-secondary" data-tree-addbtn="${c.id}" data-tree-addmode="${mode}">추가</button>
            </div>`;
          return `
          <div class="cattree-group">
            <div class="catrow" data-toggle="${c.id}">
              <button class="treetoggle" style="visibility:${hasChildren?'visible':'hidden'}; transform:rotate(${expanded?90:0}deg);">${ICONS.chevR}</button>
              <div class="ic" style="background:${hexToLight(c.color)};">${c.icon}</div>
              <div class="nm">${escapeHTML(c.name)}${c.usePersonLevel ? ' <span style="font-size:11px; color:var(--primary); font-weight:700;">· 하위항목</span>' : ''}</div>
              ${c.type === 'expense' ? `<div class="budgetval tabular">${c.budget > 0 ? fmtMoney(c.budget)+'원' : '예산 없음'}</div>` : ''}
              <button class="grip" data-edit="${c.id}">${ICONS.edit}</button>
            </div>
            ${expanded ? `
              <div class="cattree-children">
                ${c.usePersonLevel ? `
                  <div class="cattree-subhead">하위항목 (${persons.length}명)</div>
                  ${persons.map(p => leafRow(p, 'persons', false)).join('')}
                  ${addRow('persons', '새 하위항목 이름')}
                ` : ''}
                <div class="cattree-subhead">세부항목 (${subs.length}개)</div>
                ${subs.map(s => leafRow(s, 'subItems', true)).join('')}
                ${addRow('items', '새 세부항목 이름')}
              </div>
            ` : ''}
          </div>
        `;
        }).join('')}
      </div>
      <button class="btn-secondary" id="catAddNew" style="color:var(--primary); font-weight:800;">+ 새 대분류 추가</button>
    </div>
  `;
  sheet.querySelector('#catMClose').addEventListener('click', closeAllSheets);
  sheet.querySelectorAll('.segctrl button').forEach(b => {
    b.addEventListener('click', () => { catManageType = b.dataset.type; renderCatManageSheet(); });
  });
  sheet.querySelectorAll('[data-toggle]').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.toggle;
      if (catManageExpanded.has(id)) catManageExpanded.delete(id);
      else catManageExpanded.add(id);
      renderCatManageSheet();
    });
  });
  sheet.querySelectorAll('[data-edit]').forEach(b => {
    b.addEventListener('click', (e) => { e.stopPropagation(); openCatEditSheet(b.dataset.edit); });
  });
  sheet.querySelector('#catAddNew').addEventListener('click', () => openCatEditSheet(null));

  // 트리 안에서 바로 이름 수정
  sheet.querySelectorAll('[data-tree-rename]').forEach(b => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const store = b.dataset.treeStore;
      const item = await DB.get(store, b.dataset.treeRename);
      if (!item) return;
      const newName = prompt('이름 수정', item.name);
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed) { showToast('이름을 입력해주세요'); return; }
      item.name = trimmed;
      await DB.put(store, item);
      await reloadData();
      renderCatManageSheet();
      renderCurrentPage();
    });
  });

  // 트리 안에서 바로 삭제
  sheet.querySelectorAll('[data-tree-del]').forEach(b => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const store = b.dataset.treeStore;
      const isItems = b.dataset.treeIsitems === 'true';
      const item = await DB.get(store, b.dataset.treeDel);
      if (!item) return;
      const used = isItems
        ? State.transactions.filter(t => (t.lines||[]).some(l => l.subItemId === item.id)).length
        : State.transactions.filter(t => t.personId === item.id).length;
      const msg = used > 0
        ? `이 ${isItems?'세부항목':'이름'}을 사용한 거래가 ${used}건 있습니다. 삭제해도 거래 기록은 남습니다. 계속할까요?`
        : `'${item.name}'을 삭제할까요?`;
      if (!confirm(msg)) return;
      await DB.del(store, item.id);
      await reloadData();
      renderCatManageSheet();
      renderCurrentPage();
      showToast('삭제되었습니다');
    });
  });

  // 트리 안에서 바로 추가
  const doTreeAdd = async (catId, mode) => {
    const input = sheet.querySelector(`[data-tree-addinput][data-tree-addmode="${mode}"][data-tree-addinput="${catId}"]`);
    const name = input.value.trim();
    if (!name) { showToast('이름을 입력해주세요'); return; }
    const isItems = mode === 'items';
    const store = isItems ? 'subItems' : 'persons';
    const list = isItems ? subItemsOfCategory(catId) : personsOfCategory(catId);
    if (list.find(x => x.name === name)) { showToast('이미 있는 항목이에요'); return; }
    await DB.put(store, { id: uid(), categoryId: catId, name, order: list.length });
    await reloadData();
    renderCatManageSheet();
  };
  sheet.querySelectorAll('[data-tree-addbtn]').forEach(b => {
    b.addEventListener('click', (e) => { e.stopPropagation(); doTreeAdd(b.dataset.treeAddbtn, b.dataset.treeAddmode); });
  });
  sheet.querySelectorAll('[data-tree-addinput]').forEach(inp => {
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doTreeAdd(inp.dataset.treeAddinput, inp.dataset.treeAddmode);
    });
  });
}

/* =========================================================
   CATEGORY EDIT SHEET (추가/수정)
   ========================================================= */
const ICON_PALETTE = ['🍚','🚌','🏠','🛍️','🎬','💊','📚','📱','🙏','📦','💼','👛','💰','✨','🎁','🐶','✈️','🏥','🚗','⚡','💧','📺','☕','🍺','👕','🧒','💳','🏦','🎮','🛠️'];
const COLOR_PALETTE = ['#E5484D','#F08C3A','#F0A93A','#1FAA59','#10B981','#0EA5E9','#3B82F6','#6366F1','#8B5CF6','#A855F7','#EC4899','#9CA3AF'];

function openCatEditSheet(catId) {
  const editing = catId ? catById(catId) : null;
  const sheet = document.getElementById('catEditSheet');
  const draft = editing ? { ...editing } : { type: catManageType, name: '', icon: ICON_PALETTE[0], color: COLOR_PALETTE[0], budget: 0, usePersonLevel: false };

  function paint() {
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h3>${editing ? '대분류 수정' : '새 대분류'}</h3>
        <div style="display:flex; align-items:center; gap:10px;">
          <button id="catEClose" class="sheet-close-btn">${ICONS.close}취소</button>
          <button id="catSave" style="color:var(--primary); font-weight:800; font-size:14.5px; white-space:nowrap;">${editing ? '수정 완료' : '추가'}</button>
        </div>
      </div>
      <div class="sheet-body">
        <div class="formrow">
          <label>이름</label>
          <input type="text" class="textinput" id="catName" placeholder="예: 헌금" value="${escapeHTML(draft.name)}">
        </div>
        <div class="formrow">
          <label>아이콘</label>
          <div class="catgrid">
            ${ICON_PALETTE.map(ic => `
              <button class="catchip iconpick ${draft.icon===ic?'selected':''}" data-icon="${ic}">
                <span class="ic" style="background:${hexToLight(draft.color)};">${ic}</span>
              </button>
            `).join('')}
          </div>
        </div>
        <div class="formrow">
          <label>색상</label>
          <div style="display:flex; flex-wrap:wrap; gap:10px;">
            ${COLOR_PALETTE.map(c => `
              <button class="colorpick" data-color="${c}" style="width:32px;height:32px;border-radius:50%;background:${c}; ${draft.color===c?'box-shadow:0 0 0 3px '+c+'55, 0 0 0 2px #fff inset;':''}"></button>
            `).join('')}
          </div>
        </div>
        ${draft.type === 'expense' ? `
          <div class="formrow">
            <label>월 예산 (선택, 0이면 미설정)</label>
            <div class="amt-input-wrap" id="budgetWrap">
              <input type="text" inputmode="numeric" id="catBudget" placeholder="0" value="${draft.budget ? fmtMoney(draft.budget) : ''}">
              <span class="won">원</span>
            </div>
          </div>
        ` : ''}
        <div class="formrow">
          <div class="settings-row" style="padding:14px 16px;">
            <div>
              <div class="settings-label">하위항목 사용</div>
              <div class="settings-sub">예: 헌금 → 성도 이름 선택 후 세부항목 입력</div>
            </div>
            <button class="switch ${draft.usePersonLevel ? 'on' : ''}" id="personLevelSwitch"></button>
          </div>
        </div>
        ${editing ? `
          <button class="btn-secondary" id="manageSubItemsBtn" style="font-weight:700; color:var(--text-1);">세부항목 관리 (${subItemsOfCategory(editing.id).length}개)</button>
          ${draft.usePersonLevel ? `<button class="btn-secondary" id="managePersonsBtn" style="font-weight:700; color:var(--text-1);">하위항목 설정 (${personsOfCategory(editing.id).length}개)</button>` : ''}
        ` : `<div style="font-size:12.5px; color:var(--text-3); padding:2px 2px 0;">세부항목과 하위항목은 추가 후 관리할 수 있어요</div>`}

        ${editing ? `<button class="btn-secondary" id="catDelete" style="color:var(--expense);">대분류 삭제</button>` : ''}
      </div>
    `;
    sheet.querySelector('#catEClose').addEventListener('click', () => { closeAllSheets(); openCatManageSheet(); });
    sheet.querySelectorAll('.iconpick').forEach(b => {
      b.addEventListener('click', () => { draft.icon = b.dataset.icon; paint(); });
    });
    sheet.querySelectorAll('.colorpick').forEach(b => {
      b.addEventListener('click', () => { draft.color = b.dataset.color; paint(); });
    });
    sheet.querySelector('#personLevelSwitch').addEventListener('click', () => {
      draft.usePersonLevel = !draft.usePersonLevel;
      paint();
    });
    const budgetInput = sheet.querySelector('#catBudget');
    if (budgetInput) {
      attachMoneyInputFormatter(budgetInput, () => {});
      const bWrap = sheet.querySelector('#budgetWrap');
      budgetInput.addEventListener('focus', () => bWrap.classList.add('focus'));
      budgetInput.addEventListener('blur', () => bWrap.classList.remove('focus'));
    }
    if (editing) {
      sheet.querySelector('#manageSubItemsBtn').addEventListener('click', () => openCatSubSheet(editing.id, 'items'));
      const pBtn = sheet.querySelector('#managePersonsBtn');
      if (pBtn) pBtn.addEventListener('click', () => openCatSubSheet(editing.id, 'persons'));
    }
    sheet.querySelector('#catSave').addEventListener('click', async () => {
      const name = sheet.querySelector('#catName').value.trim();
      if (!name) { showToast('이름을 입력해주세요'); return; }
      draft.name = name;
      if (draft.type === 'expense') {
        draft.budget = Number(rawDigits(sheet.querySelector('#catBudget').value)) || 0;
      }
      const isNew = !editing;
      if (isNew) { draft.id = uid(); draft.order = State.categories.length; }
      await DB.put('categories', draft);
      await reloadData();
      closeAllSheets();
      openCatManageSheet();
      renderCurrentPage();
      showToast(editing ? '수정되었습니다' : '대분류가 추가되었습니다');
    });
    if (editing) {
      sheet.querySelector('#catDelete').addEventListener('click', async () => {
        const usedCount = State.transactions.filter(t => t.categoryId === editing.id).length;
        const msg = usedCount > 0
          ? `이 대분류를 사용한 거래가 ${usedCount}건 있습니다. 삭제해도 거래 기록은 남지만 분류명이 표시되지 않습니다. 계속할까요?`
          : '이 대분류를 삭제할까요? 하위 세부항목/이름도 함께 삭제됩니다.';
        if (!confirm(msg)) return;
        await DB.del('categories', editing.id);
        for (const s of subItemsOfCategory(editing.id)) await DB.del('subItems', s.id);
        for (const p of personsOfCategory(editing.id)) await DB.del('persons', p.id);
        await reloadData();
        closeAllSheets();
        openCatManageSheet();
        renderCurrentPage();
        showToast('삭제되었습니다');
      });
    }
  }
  paint();
  openSheet('catEditSheet');
}

/* =========================================================
   CAT SUB SHEET — 세부항목 관리 / 하위항목(이름) 관리
   ========================================================= */
function openCatSubSheet(categoryId, mode) {
  renderCatSubSheet(categoryId, mode);
  openSheet('catSubSheet');
}

function renderCatSubSheet(categoryId, mode) {
  const sheet = document.getElementById('catSubSheet');
  const cat = catById(categoryId);
  const isItems = mode === 'items';
  const list = isItems ? subItemsOfCategory(categoryId) : personsOfCategory(categoryId);
  const store = isItems ? 'subItems' : 'persons';
  const usageCountOf = (id) => isItems
    ? State.transactions.filter(t => t.categoryId === categoryId && (t.lines||[]).some(l => l.subItemId === id)).length
    : State.transactions.filter(t => t.personId === id).length;

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <button id="subBack" style="font-size:13px;color:var(--text-2);display:flex;align-items:center;gap:2px;">${ICONS.chevLeft}이전</button>
      <h3>${cat.icon} ${isItems ? '세부항목' : '하위항목'} 관리</h3>
      <button id="subClose" class="sheet-close-btn">${ICONS.close}닫기</button>
    </div>
    <div class="sheet-body">
      <div class="card" style="padding:4px 14px;">
        ${list.length === 0 ? `<div style="font-size:13px;color:var(--text-3);padding:16px 2px;">등록된 ${isItems?'세부항목이':'하위항목이'} 없어요</div>` : list.map(item => `
          <div class="catrow" data-id="${item.id}">
            ${!isItems ? `<div class="ic" style="background:${hexToLight(cat.color)};font-size:16px;">👤</div>` : ''}
            <div class="nm" style="${isItems?'margin-left:2px;':''}">${escapeHTML(item.name)}</div>
            <button class="grip" data-rename="${item.id}">${ICONS.edit}</button>
            <button class="grip" data-del="${item.id}" style="color:var(--expense);">${ICONS.trash}</button>
          </div>
        `).join('')}
      </div>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <input type="text" class="textinput" id="newSubName" placeholder="${isItems?'예: 추수감사':'예: 김철수'}" style="flex:1;">
        <button class="btn-primary" id="addSubBtn" style="width:auto; padding:0 18px; margin-top:0;">추가</button>
      </div>
    </div>
  `;

  sheet.querySelector('#subClose').addEventListener('click', closeAllSheets);
  sheet.querySelector('#subBack').addEventListener('click', () => { closeAllSheets(); openCatEditSheet(categoryId); });

  sheet.querySelectorAll('[data-rename]').forEach(b => {
    b.addEventListener('click', async () => {
      const item = list.find(x => x.id === b.dataset.rename);
      const newName = prompt('이름 수정', item.name);
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed) { showToast('이름을 입력해주세요'); return; }
      item.name = trimmed;
      await DB.put(store, item);
      await reloadData();
      renderCatSubSheet(categoryId, mode);
      renderCurrentPage();
    });
  });

  sheet.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', async () => {
      const item = list.find(x => x.id === b.dataset.del);
      const used = usageCountOf(item.id);
      const msg = used > 0
        ? `이 ${isItems?'세부항목':'이름'}을 사용한 거래가 ${used}건 있습니다. 삭제해도 거래 기록은 남습니다. 계속할까요?`
        : `'${item.name}'을 삭제할까요?`;
      if (!confirm(msg)) return;
      await DB.del(store, item.id);
      await reloadData();
      renderCatSubSheet(categoryId, mode);
      renderCurrentPage();
      showToast('삭제되었습니다');
    });
  });

  sheet.querySelector('#addSubBtn').addEventListener('click', () => addSubOrPerson(sheet, categoryId, mode));
  sheet.querySelector('#newSubName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addSubOrPerson(sheet, categoryId, mode);
  });
}

async function addSubOrPerson(sheet, categoryId, mode) {
  const isItems = mode === 'items';
  const input = sheet.querySelector('#newSubName');
  const name = input.value.trim();
  if (!name) { showToast('이름을 입력해주세요'); return; }
  const store = isItems ? 'subItems' : 'persons';
  const list = isItems ? subItemsOfCategory(categoryId) : personsOfCategory(categoryId);
  if (list.find(x => x.name === name)) { showToast('이미 있는 항목이에요'); return; }
  await DB.put(store, { id: uid(), categoryId, name, order: list.length });
  await reloadData();
  renderCatSubSheet(categoryId, mode);
}

/* =========================================================
   INIT
   ========================================================= */
async function initApp() {
  await DB.open();
  await seedIfEmpty();
  await reloadData();
  renderShell();
  switchTab('home');
}

document.addEventListener('DOMContentLoaded', initApp);
