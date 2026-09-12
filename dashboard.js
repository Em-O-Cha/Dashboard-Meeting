/**
 * Em-O-Cha — Dashboard client logic.
 *
 * ⚠️ ตั้งค่าก่อนใช้งาน: แก้ CONFIG.API_URL ด้านล่างให้เป็น URL ของ Apps Script Web App
 * (DashboardApi.gs) ที่ deploy แยกต่างหากไว้ใน Google Drive
 */
var CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxjQ2iLlExID0Yqry27F-IFGlBHYEbWN6DK4Y63pv5bZhqkLdlCn3ZuedvTglTRZQBvPQ/exec'
};

var STATE = { password: '', dateFrom: '', dateTo: '' };
var lastDashboardData = null, lastTargetsData = null, lastCustomersData = null, lastSignupsData = null, lastMembersGenData = null;
var lastCustomerDetail = {};
var overviewGranularity = 'daily';
var kwState = { context: 'product', groups: [], rawList: [] };
var chartInstances = {};

var PALETTE_ = ['#2e7d32', '#a50d0c', '#1565c0', '#e65100', '#6a1b9a', '#00838f', '#ad1457', '#9e9d24', '#4527a0', '#00695c'];
var THAI_MONTHS_SHORT_ = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

var REPORT_TITLES = {
  overview: 'ยอดขายรวม (รายวัน/สัปดาห์/เดือน + AOV)',
  productGroups: 'สินค้าที่ขายได้ (จัดกลุ่มด้วย Keyword)',
  bestSellers: 'สินค้าขายดี Top 10',
  byAd: 'ยอดขายแต่ละ Ad',
  adShare: 'สัดส่วนการขายแต่ละ Ad',
  timeSlots: 'ช่วงเวลาที่ขายดี',
  targets: 'ยอดขายเทียบเป้าหมายรายเดือน',
  customers: 'ลูกค้าใหม่/ซื้อซ้ำ/ซื้อต่อเนื่อง',
  signups: 'สมาชิกใหม่รายสัปดาห์',
  membersGen: 'สมาชิก LINE แบ่งตาม Gen',
  campaigns: 'โปรโมชั่น'
};

var NAV_SECTIONS = [
  ['overview', '1. ยอดขายรวม'], ['targets', '2. เป้าหมาย'], ['productGroups', '3. สินค้าที่ขายได้'], ['bestSellers', '4. สินค้าขายดี'],
  ['byAd', '5. ยอดขายแต่ละ Ad'], ['adShare', '6. สัดส่วนการขาย'], ['timeSlots', '7. ช่วงเวลาขายดี'],
  ['customers', '8. ลูกค้าใหม่/ซื้อซ้ำ'],
  ['signups', '9. สมาชิกใหม่'], ['membersGen', '10. Gen สมาชิก'], ['campaigns', '11. โปรโมชั่น'], ['aiAll', '12. AI ภาพรวม']
];

// ==================== Utils ====================

function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }
function fmtMoney(n) { n = Number(n) || 0; return '฿' + Math.round(n).toLocaleString('th-TH'); }
function fmtNum(n) { n = Number(n) || 0; return Math.round(n).toLocaleString('th-TH'); }
function truncateLabel_(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
function toInputDate_(d) {
  var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function formatThaiDate_(iso) {
  if (!iso) return '';
  var parts = iso.split('-');
  if (parts.length < 3) return iso;
  var y = +parts[0], m = +parts[1] - 1, d = +parts[2];
  return d + ' ' + THAI_MONTHS_SHORT_[m] + ' ' + (y + 543);
}
function addDays_(iso, n) {
  var d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toInputDate_(d);
}
function formatThaiDateRange_(fromIso, toIso) {
  if (fromIso === toIso) return formatThaiDate_(fromIso);
  var fParts = fromIso.split('-'), tParts = toIso.split('-');
  var sameMonthYear = fParts[0] === tParts[0] && fParts[1] === tParts[1];
  var fromLabel = sameMonthYear
    ? (+fParts[2] + ' ' + THAI_MONTHS_SHORT_[+fParts[1] - 1])
    : formatThaiDate_(fromIso);
  return fromLabel + ' - ' + formatThaiDate_(toIso);
}
function isApiNotConfigured_() { return !CONFIG.API_URL || CONFIG.API_URL.indexOf('PASTE_YOUR') === 0; }

// ==================== API ====================

function parseApiResponse_(res) {
  return res.text().then(function (text) {
    try { return JSON.parse(text); } catch (e) { throw new Error('ระบบตอบกลับไม่ถูกต้อง (ไม่ใช่ JSON)'); }
  });
}
function apiGet(action, params) {
  params = Object.assign({}, params || {});
  params.action = action;
  params.password = STATE.password;
  var qs = Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== null; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  return fetch(CONFIG.API_URL + '?' + qs, { method: 'GET' }).then(parseApiResponse_);
}
function apiPost(action, params) {
  params = Object.assign({}, params || {});
  params.action = action;
  params.password = STATE.password;
  return fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(params) }).then(parseApiResponse_);
}

// ==================== Auth ====================

function handleLogin() {
  var pw = document.getElementById('loginPassword').value;
  if (!pw) return;
  if (isApiNotConfigured_()) { showLoginErr('ยังไม่ได้ตั้งค่า API_URL ในไฟล์ dashboard.js — ดูวิธีตั้งค่าในเอกสารที่แนบมากับไฟล์ DashboardApi.gs'); return; }
  var btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = '⏳ กำลังตรวจสอบ...';
  STATE.password = pw;
  apiGet('verifyPassword', {}).then(function (r) {
    btn.disabled = false; btn.textContent = '🔐 เข้าสู่ระบบ';
    if (r && r.success) {
      try { sessionStorage.setItem('emocha.dashboard.password', pw); } catch (e) {}
      enterApp();
    } else {
      showLoginErr((r && r.error) || 'เข้าสู่ระบบไม่สำเร็จ');
    }
  }).catch(function (e) {
    btn.disabled = false; btn.textContent = '🔐 เข้าสู่ระบบ';
    showLoginErr('เชื่อมต่อไม่สำเร็จ: ' + e.message);
  });
}
function showLoginErr(msg) {
  var el = document.getElementById('loginErr');
  el.textContent = msg; el.classList.add('show');
}
function handleLogout() {
  try { sessionStorage.removeItem('emocha.dashboard.password'); } catch (e) {}
  location.reload();
}
function enterApp() {
  document.getElementById('loginScreen').classList.add('sh');
  document.getElementById('appShell').classList.add('show');
  buildNavTabs();
  initDateRange();
}

// ==================== Date range ====================

function setPreset(preset) {
  var now = new Date();
  var from, to;
  if (preset === 'today') { from = new Date(now); to = new Date(now); }
  else if (preset === '7d') { to = new Date(now); from = new Date(now); from.setDate(from.getDate() - 6); }
  else if (preset === '30d') { to = new Date(now); from = new Date(now); from.setDate(from.getDate() - 29); }
  else if (preset === 'thisMonth') { from = new Date(now.getFullYear(), now.getMonth(), 1); to = new Date(now); }
  else if (preset === 'lastMonth') { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 0); }
  else return;
  document.getElementById('dateFromInput').value = toInputDate_(from);
  document.getElementById('dateToInput').value = toInputDate_(to);
  document.querySelectorAll('.preset-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-preset') === preset); });
  applyDateRange();
}
function initDateRange() { setPreset('thisMonth'); }
function applyDateRange() {
  STATE.dateFrom = document.getElementById('dateFromInput').value;
  STATE.dateTo = document.getElementById('dateToInput').value;
  document.getElementById('rangeSummary').textContent = (STATE.dateFrom && STATE.dateTo)
    ? (formatThaiDate_(STATE.dateFrom) + ' – ' + formatThaiDate_(STATE.dateTo)) : '';
  loadAll();
}

// ==================== Nav ====================

function buildNavTabs() {
  var wrap = document.getElementById('navTabs');
  wrap.innerHTML = NAV_SECTIONS.map(function (s) { return '<a class="navtab" href="#sec-' + s[0] + '">' + s[1] + '</a>'; }).join('');
}

// ==================== Load & render all reports ====================

var DATE_DEPENDENT_KEYS_ = ['overview', 'productGroups', 'bestSellers', 'byAd', 'adShare', 'timeSlots', 'campaigns'];

function setSectionLoading_(keys) { keys.forEach(function (k) { var el = document.getElementById(k + '-body'); if (el) el.innerHTML = '<div class="empty-note">กำลังโหลด...</div>'; }); }
function showSectionError_(keys, msg) { keys.forEach(function (k) { var el = document.getElementById(k + '-body'); if (el) el.innerHTML = '<div class="error-note">โหลดข้อมูลไม่สำเร็จ: ' + escHtml(msg || '') + '</div>'; }); }

function loadAll() {
  setSectionLoading_(DATE_DEPENDENT_KEYS_);
  setSectionLoading_(['targets']);
  setSectionLoading_(['customers']);
  setSectionLoading_(['signups']);
  setSectionLoading_(['membersGen']);

  // Fire these one at a time, not all at once — Google Apps Script Web Apps can reject
  // or return a non-JSON (HTML) error page for some requests when several hit the same
  // deployment concurrently. Loading each section only after the previous one settles
  // avoids that entirely, at the cost of a slightly slower total load.
  apiGet('getDashboardData', { dateFrom: STATE.dateFrom, dateTo: STATE.dateTo }).then(function (r) {
    if (!r || !r.success) { showSectionError_(DATE_DEPENDENT_KEYS_, r ? r.error : 'โหลดไม่สำเร็จ'); return; }
    lastDashboardData = r;
    renderOverview(r.overview, r.cancelledOrdersExcluded, r.unpaidLineShopExcluded);
    renderProductGroups(r.productGroups);
    renderBestSellers(r.productGroups);
    renderByAd(r.byAd);
    renderAdShare(r.byAd, r.productQtyByAd);
    renderTimeSlots(r.timeSlots);
    renderCampaigns(r.campaigns);
  }).catch(function (e) { showSectionError_(DATE_DEPENDENT_KEYS_, e.message); })
    .then(function () {
      return apiGet('getTargetsReport', {}).then(function (r) {
        if (!r || !r.success) { showSectionError_(['targets'], r ? r.error : ''); return; }
        lastTargetsData = r; renderTargets(r);
      }).catch(function (e) { showSectionError_(['targets'], e.message); });
    })
    .then(function () {
      return apiGet('getCustomerReport', {}).then(function (r) {
        if (!r || !r.success) { showSectionError_(['customers'], r ? r.error : ''); return; }
        lastCustomersData = r.result; renderCustomers(r.result);
      }).catch(function (e) { showSectionError_(['customers'], e.message); });
    })
    .then(function () {
      return apiGet('getSignupReport', { dateFrom: STATE.dateFrom, dateTo: STATE.dateTo }).then(function (r) {
        if (!r || !r.success) { showSectionError_(['signups'], r ? r.error : ''); return; }
        lastSignupsData = r; renderSignups(r);
      }).catch(function (e) { showSectionError_(['signups'], e.message); });
    })
    .then(function () {
      return apiGet('getMembersByGen', {}).then(function (r) {
        if (!r || !r.success) { showSectionError_(['membersGen'], r ? r.error : ''); return; }
        lastMembersGenData = r; renderMembersGen(r);
      }).catch(function (e) { showSectionError_(['membersGen'], e.message); });
    });
}

// ==================== Chart helpers ====================

function renderChart(canvasId, config) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
  chartInstances[canvasId] = new Chart(canvas.getContext('2d'), config);
}
function baseChartOptions_(scalesExtra) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom', labels: { font: { family: 'Kanit' } } } },
    scales: Object.assign({ x: { ticks: { font: { family: 'Kanit' } } } }, scalesExtra || {})
  };
}
// A small inline Chart.js plugin (no external datalabels library needed) that writes
// each bar's own value next to/above it, for charts where "how many exactly" matters
// more than reading it off the axis. Pass the dataset indexes to label so charts with
// multiple series (e.g. money + headcount) can label only the one that needs it.
function valueLabelPlugin_(datasetIndexes, formatFn) {
  return {
    id: 'valueLabels',
    afterDatasetsDraw: function (chart) {
      var ctx = chart.ctx;
      var isHorizontal = chart.options.indexAxis === 'y';
      datasetIndexes.forEach(function (di) {
        var meta = chart.getDatasetMeta(di);
        if (!meta || meta.hidden) return;
        var dataset = chart.data.datasets[di];
        meta.data.forEach(function (el, i) {
          var value = dataset.data[i];
          if (value === null || value === undefined) return;
          var label = formatFn ? formatFn(value) : String(value);
          ctx.save();
          ctx.font = "600 11px 'Kanit', sans-serif";
          ctx.fillStyle = '#302121';
          if (isHorizontal) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, el.x + 6, el.y);
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(label, el.x, el.y - 4);
          }
          ctx.restore();
        });
      });
    }
  };
}

// ==================== Report 1: Overview ====================

function renderOverview(ov, cancelledCount, unpaidLineShopCount) {
  var body = document.getElementById('overview-body');
  var prev = ov.previousPeriod;
  var noteBits = [];
  if (cancelledCount) noteBits.push('ไม่รวมออเดอร์ที่ยกเลิก ' + fmtNum(cancelledCount) + ' รายการ');
  if (unpaidLineShopCount) noteBits.push('ไม่รวมออเดอร์ Line Shop ที่ยังไม่ชำระเงิน ' + fmtNum(unpaidLineShopCount) + ' รายการ');
  var cancelledNote = noteBits.length ? ('<div class="info-note">' + noteBits.join(' · ') + ' ในทุกรายงานของแดชบอร์ดนี้</div>') : '';
  var deltaCard = '';
  if (prev) {
    deltaCard = '<div class="stat-card"><div class="label">ยอดขายช่วงก่อนหน้า (' + prev.dateFrom + ' – ' + prev.dateTo + ')</div>'
      + '<div class="value" style="font-size:16px">' + fmtMoney(prev.revenue) + '</div>'
      + (prev.revenueChangePct !== null ? '<div class="delta ' + (prev.revenueChangePct >= 0 ? 'up' : 'down') + '">' + (prev.revenueChangePct >= 0 ? '▲' : '▼') + ' ' + Math.abs(prev.revenueChangePct).toFixed(1) + '% เทียบยอดขาย</div>' : '')
      + (prev.ordersChangePct !== null ? '<div class="delta ' + (prev.ordersChangePct >= 0 ? 'up' : 'down') + '">' + (prev.ordersChangePct >= 0 ? '▲' : '▼') + ' ' + Math.abs(prev.ordersChangePct).toFixed(1) + '% เทียบออเดอร์</div>' : '')
      + '</div>';
  }
  body.innerHTML = cancelledNote
    + '<div class="stat-grid">'
    + '<div class="stat-card"><div class="label">ยอดขายรวม</div><div class="value">' + fmtMoney(ov.totalRevenue) + '</div></div>'
    + '<div class="stat-card"><div class="label">จำนวนออเดอร์</div><div class="value">' + fmtNum(ov.totalOrders) + '</div></div>'
    + '<div class="stat-card"><div class="label">มูลค่าเฉลี่ย/ออเดอร์ (AOV)</div><div class="value">' + fmtMoney(ov.aov) + '</div></div>'
    + deltaCard
    + '</div>'
    + '<div style="display:flex;gap:8px;margin-bottom:10px">'
    + '<button class="preset-btn ' + (overviewGranularity === 'daily' ? 'active' : '') + '" onclick="setOverviewGranularity(\'daily\')">รายวัน</button>'
    + '<button class="preset-btn ' + (overviewGranularity === 'weekly' ? 'active' : '') + '" onclick="setOverviewGranularity(\'weekly\')">รายสัปดาห์</button>'
    + '<button class="preset-btn ' + (overviewGranularity === 'monthly' ? 'active' : '') + '" onclick="setOverviewGranularity(\'monthly\')">รายเดือน</button>'
    + '</div>'
    + '<div class="chart-wrap"><canvas id="overviewChart"></canvas></div>';
  drawOverviewChart(ov);
}
function setOverviewGranularity(g) { overviewGranularity = g; if (lastDashboardData) renderOverview(lastDashboardData.overview, lastDashboardData.cancelledOrdersExcluded, lastDashboardData.unpaidLineShopExcluded); }
function drawOverviewChart(ov) {
  var series = ov[overviewGranularity] || [];
  var keyName = overviewGranularity === 'daily' ? 'date' : (overviewGranularity === 'weekly' ? 'week' : 'month');
  renderChart('overviewChart', {
    data: {
      labels: series.map(function (s) { return s[keyName]; }),
      datasets: [
        { type: 'line', label: 'ยอดขาย (บาท)', data: series.map(function (s) { return s.revenue; }), borderColor: '#a50d0c', backgroundColor: 'rgba(165,13,12,.08)', yAxisID: 'y', tension: .3, fill: true },
        { type: 'bar', label: 'จำนวนออเดอร์', data: series.map(function (s) { return s.orders; }), backgroundColor: 'rgba(46,125,50,.35)', yAxisID: 'y1' }
      ]
    },
    options: baseChartOptions_({
      y: { position: 'left', title: { display: true, text: 'บาท' } },
      y1: { position: 'right', title: { display: true, text: 'ออเดอร์' }, grid: { drawOnChartArea: false } }
    })
  });
}

// ==================== Report 2: Keyword-grouped products ====================

function renderProductGroups(list) { renderGroupTableWithChart_('productGroups', list, 'productGroupsChart'); }
function renderGroupTableWithChart_(sectionKey, list, chartId) {
  var body = document.getElementById(sectionKey + '-body');
  if (!list || !list.length) { body.innerHTML = '<div class="empty-note">ไม่มีข้อมูลในช่วงวันที่นี้</div>'; return; }
  var top = list.slice(0, 10);
  var rowsHtml = list.map(function (it, i) {
    return '<tr><td>' + (i + 1) + '</td><td>' + escHtml(it.name) + ' ' + (it.grouped ? '<span class="tag tag-grouped">จัดกลุ่มแล้ว</span>' : '<span class="tag tag-ungrouped">ยังไม่จัดกลุ่ม</span>') + '</td>'
      + '<td>' + fmtNum(it.qty) + '</td><td>' + fmtMoney(it.amount) + '</td><td>' + fmtNum(it.orderCount) + '</td></tr>';
  }).join('');
  // Chart.js's canvas-based y-axis text rendering turned out to be unfixably broken on
  // the user's real phone (confirmed on a fresh, cache-cleared load: even a 2-character
  // "#1" was the only thing that survived — real Thai names always got cut down,
  // regardless of length, container width, or canvas sizing). Numbers alone weren't
  // acceptable either (no way to tell which product is which at a glance). So on mobile,
  // skip Chart.js for this chart entirely and draw the bars as plain HTML/CSS instead —
  // ordinary text in a normal element can't suffer the same canvas measurement bug.
  // Desktop keeps the original Chart.js chart, which was never broken.
  var isMobile_ = window.innerWidth <= 640;
  if (isMobile_) {
    var maxAmount_ = Math.max.apply(null, top.map(function (it) { return it.amount; }).concat([1]));
    var hbarHtml = '<div class="hbar-list">' + top.map(function (it) {
      var pct = maxAmount_ ? Math.max(2, it.amount / maxAmount_ * 100) : 2;
      return '<div class="hbar-row">'
        + '<div class="hbar-top"><span class="hbar-label">' + escHtml(it.name) + '</span><span class="hbar-value">' + fmtMoney(it.amount) + '</span></div>'
        + '<div class="hbar-track"><div class="hbar-fill" style="width:' + pct.toFixed(1) + '%;background:' + PALETTE_[0] + '"></div></div>'
        + '</div>';
    }).join('') + '</div>';
    body.innerHTML = hbarHtml
      + '<div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>สินค้า/กลุ่ม</th><th>จำนวน</th><th>ยอดขาย</th><th>ออเดอร์</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
    return;
  }
  body.innerHTML = '<div class="chart-wrap"><canvas id="' + chartId + '"></canvas></div>'
    + '<div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>สินค้า/กลุ่ม</th><th>จำนวน</th><th>ยอดขาย</th><th>ออเดอร์</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
  renderChart(chartId, {
    type: 'bar',
    data: { labels: top.map(function (it) { return truncateLabel_(it.name, 20); }), datasets: [{ label: 'ยอดขาย', data: top.map(function (it) { return it.amount; }), backgroundColor: PALETTE_[0] }] },
    options: Object.assign(baseChartOptions_({ x: { title: { display: true, text: 'บาท' } } }), { indexAxis: 'y', plugins: { legend: { display: false } } })
  });
}

// ==================== Report 3: Best sellers ====================

function renderBestSellers(list) {
  var body = document.getElementById('bestSellers-body');
  if (!list || !list.length) { body.innerHTML = '<div class="empty-note">ไม่มีข้อมูลในช่วงวันที่นี้</div>'; return; }
  var top = list.slice(0, 10);
  var totalAmount = list.reduce(function (s, it) { return s + it.amount; }, 0);
  var medals = ['🥇', '🥈', '🥉'];
  body.innerHTML = '<div class="table-scroll"><table class="data-table"><thead><tr><th>อันดับ</th><th>สินค้า/กลุ่ม</th><th>ยอดขาย</th><th>สัดส่วน</th><th>จำนวนออเดอร์</th></tr></thead><tbody>'
    + top.map(function (it, i) {
      return '<tr><td class="rank-medal">' + (medals[i] || ('#' + (i + 1))) + '</td><td>' + escHtml(it.name) + '</td><td>' + fmtMoney(it.amount) + '</td><td>' + (totalAmount ? (it.amount / totalAmount * 100).toFixed(1) : '0') + '%</td><td>' + fmtNum(it.orderCount) + '</td></tr>';
    }).join('')
    + '</tbody></table></div>';
}

// ==================== Report 4 & 5: By Ad ====================

function renderByAd(list) {
  var body = document.getElementById('byAd-body');
  if (!list || !list.length) { body.innerHTML = '<div class="empty-note">ไม่มีข้อมูลในช่วงวันที่นี้</div>'; return; }
  body.innerHTML = '<div class="chart-wrap"><canvas id="byAdChart"></canvas></div>'
    + '<div class="table-scroll"><table class="data-table"><thead><tr><th>Ad / ช่องทาง</th><th>ยอดขาย</th><th>ออเดอร์</th><th>AOV</th></tr></thead><tbody>'
    + list.map(function (it) { return '<tr><td>' + escHtml(it.ad) + '</td><td>' + fmtMoney(it.revenue) + '</td><td>' + fmtNum(it.orders) + '</td><td>' + fmtMoney(it.aov) + '</td></tr>'; }).join('')
    + '</tbody></table></div>';
  renderChart('byAdChart', {
    type: 'bar',
    data: { labels: list.map(function (it) { return it.ad; }), datasets: [{ label: 'ยอดขาย', data: list.map(function (it) { return it.revenue; }), backgroundColor: list.map(function (_, i) { return PALETTE_[i % PALETTE_.length]; }) }] },
    options: Object.assign(baseChartOptions_({ y: { title: { display: true, text: 'บาท' } } }), { plugins: { legend: { display: false } } })
  });
}
function renderAdShare(list, productQtyByAd) {
  var body = document.getElementById('adShare-body');
  if (!list || !list.length) { body.innerHTML = '<div class="empty-note">ไม่มีข้อมูลในช่วงวันที่นี้</div>'; return; }

  // Keep each Ad's color consistent across all 3 by-Ad charts regardless of per-chart sort order.
  var colorByAd = {};
  list.forEach(function (it, i) { colorByAd[it.ad] = PALETTE_[i % PALETTE_.length]; });

  function buildRow(title, sortKey, valueKey, pctKey, fmtValue) {
    var sorted = list.slice().sort(function (a, b) { return b[sortKey] - a[sortKey]; });
    var legendHtml = sorted.map(function (it) {
      return '<div class="share-legend-row">'
        + '<span class="share-dot" style="background:' + colorByAd[it.ad] + '"></span>'
        + '<span class="share-name">' + escHtml(it.ad) + '</span>'
        + '<span class="share-pct">' + Math.round(it[pctKey]) + '%</span>'
        + '<span class="share-value">(' + fmtValue(it[valueKey]) + ')</span>'
        + '</div>';
    }).join('');
    return '<div class="share-row">'
      + '<p class="share-title">' + escHtml(title) + '</p>'
      + '<div class="share-flex">'
      + '<div class="chart-wrap share-chart"><canvas id="adShare_' + sortKey + '"></canvas></div>'
      + '<div class="share-legend">' + legendHtml + '</div>'
      + '</div></div>';
  }

  // Product quantity mix WITHIN each Ad channel (keyword-grouped, same grouping as reports
  // 2/3/7): one doughnut per Ad — e.g. "Shopee ขายสินค้าแต่ละตัวได้กี่ชิ้น" — top 8 + "อื่นๆ".
  // % here is relative to that Ad's own total quantity, not the whole store's.
  var PRODUCT_QTY_TOP_N_ = 8;
  var adOrder = list.slice().sort(function (a, b) { return b.revenue - a.revenue; }).map(function (it) { return it.ad; });
  var perAdProductRows = [];
  (productQtyByAd || []).slice().sort(function (a, b) { return adOrder.indexOf(a.ad) - adOrder.indexOf(b.ad); }).forEach(function (adEntry, adx) {
    var groups = adEntry.products || [];
    if (!groups.length) return;
    var totalQty = groups.reduce(function (s, g) { return s + (Number(g.qty) || 0); }, 0);
    var sorted = groups.slice().sort(function (a, b) { return b.qty - a.qty; });
    var top = sorted.slice(0, PRODUCT_QTY_TOP_N_);
    var restQty = sorted.slice(PRODUCT_QTY_TOP_N_).reduce(function (s, g) { return s + (Number(g.qty) || 0); }, 0);
    var rows = top.map(function (g) { return { name: g.name, qty: g.qty, pct: totalQty ? (g.qty / totalQty * 100) : 0 }; });
    if (restQty > 0) rows.push({ name: 'อื่นๆ', qty: restQty, pct: totalQty ? (restQty / totalQty * 100) : 0 });
    var colorByName = {};
    rows.forEach(function (r, i) { colorByName[r.name] = PALETTE_[i % PALETTE_.length]; });
    perAdProductRows.push({ ad: adEntry.ad, canvasId: 'adShare_pq_' + adx, rows: rows, colorByName: colorByName });
  });
  function buildProductQtyByAdRow_(entry) {
    var legendHtml = entry.rows.map(function (r, i) {
      return '<div class="share-legend-row">'
        + '<span class="share-rank" style="background:' + entry.colorByName[r.name] + '">' + (i + 1) + '</span>'
        + '<span class="share-name">' + escHtml(r.name) + '</span>'
        + '<span class="share-pct">' + Math.round(r.pct) + '%</span>'
        + '<span class="share-value">(' + fmtNum(r.qty) + ' ชิ้น)</span>'
        + '</div>';
    }).join('');
    return '<div class="share-row">'
      + '<p class="share-title">สัดส่วนจำนวนชิ้นของสินค้าแต่ละตัว — ' + escHtml(entry.ad) + ' (Top ' + PRODUCT_QTY_TOP_N_ + ' + อื่นๆ)</p>'
      + '<div class="share-flex">'
      + '<div class="chart-wrap share-chart"><canvas id="' + entry.canvasId + '"></canvas></div>'
      + '<div class="share-legend">' + legendHtml + '</div>'
      + '</div></div>';
  }

  body.innerHTML = buildRow('ยอดขาย (บาท)', 'revenue', 'revenue', 'revenueSharePct', fmtMoney)
    + buildRow('จำนวนรายการสั่งซื้อ', 'orders', 'orders', 'orderSharePct', function (n) { return fmtNum(n) + ' ออเดอร์'; })
    + buildRow('สัดส่วนจำนวนชิ้น', 'qty', 'qty', 'qtySharePct', function (n) { return fmtNum(n) + ' ชิ้น'; })
    + perAdProductRows.map(buildProductQtyByAdRow_).join('');

  function drawDoughnut(sortKey, valueKey) {
    var sorted = list.slice().sort(function (a, b) { return b[sortKey] - a[sortKey]; });
    renderChart('adShare_' + sortKey, {
      type: 'doughnut',
      data: { labels: sorted.map(function (it) { return it.ad; }), datasets: [{ data: sorted.map(function (it) { return it[valueKey]; }), backgroundColor: sorted.map(function (it) { return colorByAd[it.ad]; }) }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }
  drawDoughnut('revenue', 'revenue');
  drawDoughnut('orders', 'orders');
  drawDoughnut('qty', 'qty');
  perAdProductRows.forEach(function (entry) {
    renderChart(entry.canvasId, {
      type: 'doughnut',
      data: { labels: entry.rows.map(function (r) { return r.name; }), datasets: [{ data: entry.rows.map(function (r) { return r.qty; }), backgroundColor: entry.rows.map(function (r) { return entry.colorByName[r.name]; }) }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  });
}

// ==================== Report 6: Time slots ====================

function renderTimeSlots(ts) {
  var body = document.getElementById('timeSlots-body');
  if (!ts || !ts.heatmap || !ts.heatmap.length) { body.innerHTML = '<div class="empty-note">ไม่มีข้อมูลในช่วงวันที่นี้</div>'; return; }
  var maxRevenue = Math.max.apply(null, ts.heatmap.map(function (c) { return c.revenue; }).concat([1]));
  var byDow = {};
  ts.heatmap.forEach(function (c) { if (!byDow[c.dow]) byDow[c.dow] = []; byDow[c.dow][c.hour] = c; });

  var topSlots = ts.heatmap.filter(function (c) { return c.revenue > 0; })
    .sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 3);
  var medals = ['🥇', '🥈', '🥉'];
  var topSlotsHtml = topSlots.length
    ? '<div class="stat-grid">' + topSlots.map(function (c, i) {
        return '<div class="stat-card"><div class="label">' + medals[i] + ' ' + escHtml(c.dowLabel) + ' เวลา ' + c.hour + ':00 น.</div>'
          + '<div class="value" style="font-size:17px">' + fmtMoney(c.revenue) + '</div>'
          + '<div class="delta" style="color:var(--g6)">' + fmtNum(c.orders) + ' ออเดอร์</div></div>';
      }).join('') + '</div>'
    : '';

  var hoursHeader = '<tr><td></td>' + Array.from({ length: 24 }, function (_, h) { return '<th>' + h + '</th>'; }).join('') + '</tr>';
  var rows = ts.dowLabels.map(function (label, dow) {
    var cells = (byDow[dow] || []).map(function (c) {
      var alpha = c && maxRevenue ? Math.max(.06, c.revenue / maxRevenue) : .06;
      var title = label + ' ' + (c ? c.hour : '') + ':00 — ยอดขาย ' + fmtMoney(c ? c.revenue : 0) + ' (' + fmtNum(c ? c.orders : 0) + ' ออเดอร์)';
      return '<td style="background:rgba(46,125,50,' + alpha.toFixed(2) + ')" title="' + escAttr(title) + '"></td>';
    }).join('');
    return '<tr><td class="dowlabel">' + escHtml(label) + '</td>' + cells + '</tr>';
  }).join('');
  body.innerHTML = topSlotsHtml
    + '<p class="heatmap-scroll-hint">← เลื่อนดูช่วงเวลาอื่น (ตารางกว้างกว่าจอมือถือ)</p>'
    + '<div class="heatmap-wrap"><table class="heatmap">' + hoursHeader + rows + '</table></div>'
    + '<p style="font-size:11px;color:var(--g6);margin-top:8px">สีเข้ม = ยอดขายสูง (เอาเมาส์ชี้ที่ช่องเพื่อดูตัวเลข) · แกนนอน = ชั่วโมง (0-23) · แกนตั้ง = วันในสัปดาห์</p>'
    + '<div class="chart-wrap" style="margin-top:16px"><canvas id="hourlyChart"></canvas></div>';
  renderChart('hourlyChart', {
    type: 'bar',
    data: { labels: ts.hourly.map(function (h) { return h.hour + ':00'; }), datasets: [{ label: 'ยอดขายตามชั่วโมง', data: ts.hourly.map(function (h) { return h.revenue; }), backgroundColor: PALETTE_[1] }] },
    options: Object.assign(baseChartOptions_({ y: { title: { display: true, text: 'บาท' } } }), { plugins: { legend: { display: false } } })
  });
}

// ==================== Report 8: Targets ====================

function renderTargets(data) {
  var body = document.getElementById('targets-body');
  var months = data.months || [];
  if (!months.length) { body.innerHTML = '<div class="empty-note">' + escHtml(data.note || 'ไม่มีข้อมูลเป้าหมาย') + '</div>'; return; }
  body.innerHTML = '<div class="chart-wrap"><canvas id="targetsChart"></canvas></div>'
    + '<div class="table-scroll"><table class="data-table"><thead><tr><th>เดือน</th><th>เป้าหมาย</th><th>ยอดขายจริง</th><th>% ที่ทำได้</th><th>ออเดอร์</th></tr></thead><tbody>'
    + months.map(function (m) {
      var pctText = m.pct === null ? (m.noTarget ? '<span class="tag tag-ungrouped">ยังไม่ตั้งเป้า</span>' : '-') : m.pct.toFixed(1) + '%';
      return '<tr><td>' + escHtml(m.month) + '</td><td>' + fmtMoney(m.targetTotal) + '</td><td>' + fmtMoney(m.actualTotal) + '</td><td>' + pctText + '</td><td>' + fmtNum(m.actualOrders) + '</td></tr>';
    }).join('')
    + '</tbody></table></div>';
  renderChart('targetsChart', {
    type: 'bar',
    data: {
      labels: months.map(function (m) { return m.month; }),
      datasets: [
        { label: 'เป้าหมาย', data: months.map(function (m) { return m.targetTotal; }), backgroundColor: 'rgba(165,13,12,.35)' },
        { label: 'ยอดขายจริง', data: months.map(function (m) { return m.actualTotal; }), backgroundColor: 'rgba(46,125,50,.65)' }
      ]
    },
    options: baseChartOptions_({ y: { title: { display: true, text: 'บาท' } } })
  });
}

// ==================== Report 9: Customers ====================

function renderCustomers(result) {
  var body = document.getElementById('customers-body');
  var monthly = (result && result.monthly) || [];
  lastCustomerDetail = (result && result.detail) || {};
  if (!monthly.length) { body.innerHTML = '<div class="empty-note">ยังไม่มีข้อมูลลูกค้า</div>'; return; }
  body.innerHTML = (result.note ? '<div class="info-note">' + escHtml(result.note) + '</div>' : '')
    + '<div class="chart-wrap"><canvas id="customersChart"></canvas></div>'
    + '<div class="table-scroll"><table class="data-table"><thead><tr><th>เดือน</th><th>ลูกค้า Active</th><th>ลูกค้าใหม่</th><th>ซื้อซ้ำในเดือนเดียวกัน</th><th>ซื้อต่อเนื่องจากเดือนก่อน</th><th>ออเดอร์รวม</th><th></th></tr></thead><tbody>'
    + monthly.map(function (m) { return '<tr><td>' + escHtml(m.month) + '</td><td>' + fmtNum(m.totalActiveCustomers) + '</td><td>' + fmtNum(m.newCustomers) + '</td><td>' + fmtNum(m.repeatSameMonth) + '</td><td>' + fmtNum(m.continuingFromPrevMonth) + '</td><td>' + fmtNum(m.totalOrders) + '</td><td><button class="btn btn-outline btn-sm" onclick="openCustomerDetail(\'' + m.month + '\')">ดูคนซื้อซ้ำ</button></td></tr>'; }).join('')
    + '</tbody></table></div>';
  renderChart('customersChart', {
    type: 'bar',
    data: {
      labels: monthly.map(function (m) { return m.month; }),
      datasets: [
        { label: 'ลูกค้าใหม่', data: monthly.map(function (m) { return m.newCustomers; }), backgroundColor: PALETTE_[0] },
        { label: 'ซื้อซ้ำในเดือนเดียวกัน', data: monthly.map(function (m) { return m.repeatSameMonth; }), backgroundColor: PALETTE_[1] },
        { label: 'ซื้อต่อเนื่องจากเดือนก่อน', data: monthly.map(function (m) { return m.continuingFromPrevMonth; }), backgroundColor: PALETTE_[2] }
      ]
    },
    options: baseChartOptions_({ y: { title: { display: true, text: 'จำนวนลูกค้า' } } })
  });
}

function openCustomerDetail(month) {
  document.getElementById('customerDetailModal').classList.add('show');
  document.getElementById('customerDetailTitle').textContent = 'ลูกค้าที่ซื้อซ้ำ — เดือน ' + month;
  var d = lastCustomerDetail[month] || { newCustomers: [], repeatSameMonth: [], continuingFromPrevMonth: [] };
  function buildSection(title, list) {
    if (!list.length) return '<div class="cd-section"><div class="cd-section-title">' + escHtml(title) + ' (0 คน)</div><div class="empty-note" style="padding:10px 0">ไม่มี</div></div>';
    var rows = list.map(function (c) {
      var ordersHtml = c.orders.map(function (o) {
        var productsLine = (o.products && o.products.length) ? ('<div class="cd-order-products">' + escHtml(o.products.join(', ')) + '</div>') : '';
        return '<div class="cd-order">#' + escHtml(o.orderId) + ' · ' + escHtml(o.date) + ' · ' + fmtMoney(o.amount) + (o.ad ? ' · ' + escHtml(o.ad) : '') + productsLine + '</div>';
      }).join('');
      return '<div class="cd-customer"><div class="cd-customer-label">' + escHtml(c.label) + ' <span class="tag tag-grouped">' + c.orderCount + ' ออเดอร์</span></div>' + ordersHtml + '</div>';
    }).join('');
    return '<div class="cd-section"><div class="cd-section-title">' + escHtml(title) + ' (' + list.length + ' คน)</div>' + rows + '</div>';
  }
  document.getElementById('customerDetailBody').innerHTML = buildSection('ซื้อซ้ำในเดือนเดียวกัน', d.repeatSameMonth)
    + buildSection('ซื้อต่อเนื่องจากเดือนก่อน', d.continuingFromPrevMonth);
}
function closeCustomerDetail() { document.getElementById('customerDetailModal').classList.remove('show'); }

// ==================== Report 10: Signups ====================

function renderSignups(data) {
  var body = document.getElementById('signups-body');
  var weeks = data.weeks || [];
  var wp = data.welcomePromo || {};
  body.innerHTML = '<div class="stat-grid">'
    + '<div class="stat-card"><div class="label">สมาชิกใหม่ในช่วงนี้</div><div class="value">' + fmtNum(data.totalNewMembers) + '</div></div>'
    + '<div class="stat-card"><div class="label">สิทธิ์ต้อนรับ: ยังไม่หมดอายุ/ยังไม่ใช้</div><div class="value">' + fmtNum(wp.stillActive) + '</div></div>'
    + '<div class="stat-card"><div class="label">สิทธิ์ต้อนรับ: ใช้แล้ว/หมดอายุแล้ว</div><div class="value">' + fmtNum(wp.usedOrExpired) + '</div></div>'
    + '</div>'
    + (wp.note ? '<div class="info-note">' + escHtml(wp.note) + '</div>' : '')
    + (weeks.length ? '<div class="chart-wrap"><canvas id="signupsChart"></canvas></div>' : '<div class="empty-note">ไม่มีสมาชิกใหม่ในช่วงวันที่นี้</div>');
  if (weeks.length) {
    // Label each bar with the actual date span of data it holds — the week's Mon-Sun
    // range clipped to the selected date filter, not just the week's start date, so a
    // filter narrower than a full week (e.g. 7-11 ก.ย.) reads as "7 ก.ย. - 11 ก.ย." not
    // a bare "week of 7 ก.ย." that looks like it only covers a single day.
    var weekLabels = weeks.map(function (w) {
      var weekEnd = addDays_(w.weekStart, 6);
      var rangeFrom = (STATE.dateFrom && STATE.dateFrom > w.weekStart) ? STATE.dateFrom : w.weekStart;
      var rangeTo = (STATE.dateTo && STATE.dateTo < weekEnd) ? STATE.dateTo : weekEnd;
      return formatThaiDateRange_(rangeFrom, rangeTo);
    });
    renderChart('signupsChart', {
      type: 'bar',
      data: { labels: weekLabels, datasets: [{ label: 'สมาชิกใหม่', data: weeks.map(function (w) { return w.newMembers; }), backgroundColor: PALETTE_[3] }] },
      options: Object.assign(baseChartOptions_({ y: { title: { display: true, text: 'คน' } } }), { plugins: { legend: { display: false } } }),
      plugins: [valueLabelPlugin_([0], function (v) { return fmtNum(v); })]
    });
  }
}

// ==================== Report 10: Members by generation ====================

function renderMembersGen(data) {
  var body = document.getElementById('membersGen-body');
  var gens = (data && data.gens) || [];
  if (!gens.length) { body.innerHTML = '<div class="empty-note">' + escHtml((data && data.note) || 'ไม่มีข้อมูล Gen ของสมาชิก') + '</div>'; return; }
  var noteHtml = (data.noBirthdateCount > 0)
    ? '<div class="info-note">มีสมาชิก ' + fmtNum(data.noBirthdateCount) + ' คน (จากทั้งหมด ' + fmtNum(data.totalMembers) + ' คน) ที่ไม่มีข้อมูลวันเกิดในชีต เลยไม่ถูกจัดกลุ่ม Gen — ตัวเลขด้านล่างนับเฉพาะคนที่มีวันเกิดเท่านั้น</div>'
    : '';
  body.innerHTML = noteHtml
    + '<div class="chart-wrap"><canvas id="membersGenChart"></canvas></div>'
    + '<div class="table-scroll"><table class="data-table"><thead><tr><th>Gen</th><th>ช่วงปีเกิด</th><th>จำนวนที่สมัคร</th><th>จำนวนที่ซื้อ</th><th>ยอดซื้อสะสมรวม</th></tr></thead><tbody>'
    + gens.map(function (g) { return '<tr><td>' + escHtml(g.label) + '</td><td>' + escHtml(g.yearsLabel) + '</td><td>' + fmtNum(g.count) + '</td><td>' + fmtNum(g.purchasedCount) + '</td><td>' + fmtMoney(g.totalSpend) + '</td></tr>'; }).join('')
    + '</tbody></table></div>';
  renderChart('membersGenChart', {
    type: 'bar',
    data: {
      labels: gens.map(function (g) { return g.label; }),
      datasets: [
        { label: 'ยอดซื้อสะสม (บาท)', data: gens.map(function (g) { return g.totalSpend; }), backgroundColor: PALETTE_[0], yAxisID: 'y' },
        { label: 'จำนวนที่สมัคร (คน)', data: gens.map(function (g) { return g.count; }), backgroundColor: PALETTE_[2], yAxisID: 'y1' }
      ]
    },
    options: baseChartOptions_({
      y: { position: 'left', title: { display: true, text: 'บาท' } },
      y1: { position: 'right', title: { display: true, text: 'คน' }, grid: { drawOnChartArea: false } }
    }),
    plugins: [valueLabelPlugin_([1], function (v) { return fmtNum(v); })]
  });
}

// ==================== Report 11: Campaigns ====================

function renderCampaigns(list) {
  var body = document.getElementById('campaigns-body');
  if (!list || !list.length) { body.innerHTML = '<div class="empty-note">ไม่มีข้อมูลในช่วงวันที่นี้</div>'; return; }
  var rowsHtml = list.map(function (it, i) { return '<tr><td>' + (i + 1) + '</td><td>' + escHtml(it.campaign) + '</td><td>' + fmtMoney(it.revenue) + '</td><td>' + fmtNum(it.orders) + '</td></tr>'; }).join('');
  var tableHtml = '<div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>แคมเปญ/โปรโมชั่น</th><th>ยอดขาย</th><th>จำนวนออเดอร์</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
  // See renderGroupTableWithChart_ above for why mobile draws plain HTML/CSS bars
  // instead of a Chart.js canvas — the same y-axis text bug applies here.
  if (window.innerWidth <= 640) {
    var maxRevenue_ = Math.max.apply(null, list.map(function (it) { return it.revenue; }).concat([1]));
    var hbarHtml = '<div class="hbar-list">' + list.map(function (it) {
      var pct = maxRevenue_ ? Math.max(2, it.revenue / maxRevenue_ * 100) : 2;
      return '<div class="hbar-row">'
        + '<div class="hbar-top"><span class="hbar-label">' + escHtml(it.campaign) + '</span><span class="hbar-value">' + fmtMoney(it.revenue) + '</span></div>'
        + '<div class="hbar-track"><div class="hbar-fill" style="width:' + pct.toFixed(1) + '%;background:' + PALETTE_[4] + '"></div></div>'
        + '</div>';
    }).join('') + '</div>';
    body.innerHTML = hbarHtml + tableHtml;
    return;
  }
  body.innerHTML = '<div class="chart-wrap"><canvas id="campaignsChart"></canvas></div>' + tableHtml;
  renderChart('campaignsChart', {
    type: 'bar',
    data: { labels: list.map(function (it) { return truncateLabel_(it.campaign, 20); }), datasets: [{ label: 'ยอดขาย', data: list.map(function (it) { return it.revenue; }), backgroundColor: PALETTE_[4] }] },
    options: Object.assign(baseChartOptions_({ x: { title: { display: true, text: 'บาท' } } }), { indexAxis: 'y', plugins: { legend: { display: false } } })
  });
}

// ==================== Report 12: AI analysis ====================

function buildAiHtml_(analysis) {
  var h = '<div class="ai-summary">' + escHtml(analysis.summary || '') + '</div>';
  if (analysis.insights && analysis.insights.length) {
    h += '<div class="ai-block-title">🔍 ข้อสังเกต/แนวโน้ม</div><ul class="ai-list">' + analysis.insights.map(function (x) { return '<li>' + escHtml(x) + '</li>'; }).join('') + '</ul>';
  }
  if (analysis.risks && analysis.risks.length) {
    h += '<div class="ai-block-title">⚠️ ความเสี่ยง</div><ul class="ai-list">' + analysis.risks.map(function (x) { return '<li>' + escHtml(x) + '</li>'; }).join('') + '</ul>';
  }
  if (analysis.recommendations && analysis.recommendations.length) {
    h += '<div class="ai-block-title">🧭 แนวทางดำเนินการ (' + analysis.recommendations.length + ' แนวทาง)</div>';
    h += analysis.recommendations.map(function (r) {
      return '<div class="ai-reco"><b>' + escHtml(r.title || '') + '</b><div class="rationale">' + escHtml(r.rationale || '') + '</div>'
        + (r.steps && r.steps.length ? '<ul class="steps">' + r.steps.map(function (s) { return '<li>' + escHtml(s) + '</li>'; }).join('') + '</ul>' : '')
        + (r.tradeoffs ? '<div class="tradeoffs">' + escHtml(r.tradeoffs) + '</div>' : '')
        + '</div>';
    }).join('');
  }
  return h;
}
function formatSavedAt_(ts) {
  var d = new Date(ts);
  return formatThaiDate_(toInputDate_(d)) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' น.';
}
function aiStorageKey_(key) { return 'emocha.ai.' + key; }
function saveAiResult_(key, analysis, direction) {
  try { localStorage.setItem(aiStorageKey_(key), JSON.stringify({ analysis: analysis, direction: direction || '', savedAt: Date.now() })); } catch (e) {}
}
function restoreAiPanels_() {
  Object.keys(REPORT_TITLES).forEach(function (key) {
    var raw; try { raw = localStorage.getItem(aiStorageKey_(key)); } catch (e) { raw = null; }
    if (!raw) return;
    try {
      var saved = JSON.parse(raw);
      if (saved && saved.analysis) {
        renderAiPanel('ai-' + key, saved.analysis, saved.savedAt);
        var dirEl = document.getElementById('ai-dir-' + key);
        if (dirEl && saved.direction) dirEl.value = saved.direction;
      }
    } catch (e) {}
  });
  var rawAll; try { rawAll = localStorage.getItem(aiStorageKey_('aiAll')); } catch (e) { rawAll = null; }
  if (!rawAll) return;
  try {
    var savedAll = JSON.parse(rawAll);
    if (savedAll && savedAll.analysis) {
      var note = '<div class="ai-saved-note">🕓 บันทึกไว้เมื่อ ' + escHtml(formatSavedAt_(savedAll.savedAt)) + ' — จะแสดงค้างไว้จนกว่าจะกดวิเคราะห์ใหม่</div>';
      var html = note + buildAiHtml_(savedAll.analysis);
      document.getElementById('ai-aiAll').innerHTML = html;
      document.getElementById('ai-aiAll').classList.add('show');
      var dirAllEl = document.getElementById('ai-dir-aiAll');
      if (dirAllEl && savedAll.direction) dirAllEl.value = savedAll.direction;
    }
  } catch (e) {}
}
function renderAiPanel(panelId, analysis, savedAt) {
  var el = document.getElementById(panelId);
  var note = savedAt ? '<div class="ai-saved-note">🕓 บันทึกไว้เมื่อ ' + escHtml(formatSavedAt_(savedAt)) + ' — จะแสดงค้างไว้จนกว่าจะกดวิเคราะห์ใหม่</div>' : '';
  el.innerHTML = '<div class="ai-panel-hd">🤖 ผลวิเคราะห์จาก AI</div>' + note + buildAiHtml_(analysis);
  el.classList.add('show');
}
function getReportDataFor_(key) {
  if (key === 'targets') return lastTargetsData;
  if (key === 'customers') return lastCustomersData;
  if (key === 'signups') return lastSignupsData;
  if (key === 'membersGen') return lastMembersGenData;
  if (!lastDashboardData) return null;
  switch (key) {
    case 'overview': return lastDashboardData.overview;
    case 'productGroups': return lastDashboardData.productGroups;
    case 'bestSellers': return (lastDashboardData.productGroups || []).slice(0, 10);
    case 'byAd': return lastDashboardData.byAd;
    case 'adShare': return lastDashboardData.byAd;
    case 'timeSlots': return lastDashboardData.timeSlots;
    case 'campaigns': return lastDashboardData.campaigns;
  }
  return null;
}
function runAiAnalyze(key, btnEl) {
  var data = getReportDataFor_(key);
  if (!data) { alert('ยังไม่มีข้อมูลรายงานนี้ กรุณารอโหลดข้อมูลให้เสร็จก่อน'); return; }
  var dirEl = document.getElementById('ai-dir-' + key);
  var direction = dirEl ? dirEl.value.trim() : '';
  var panel = document.getElementById('ai-' + key);
  panel.classList.add('show');
  panel.innerHTML = '<div class="ai-loading">🤖 กำลังวิเคราะห์ด้วย AI...</div>';
  btnEl.disabled = true;
  apiPost('aiAnalyze', { reportKey: key, reportTitle: REPORT_TITLES[key] || key, reportData: JSON.stringify(data), dateFrom: STATE.dateFrom, dateTo: STATE.dateTo, direction: direction })
    .then(function (r) {
      btnEl.disabled = false;
      if (r && r.success) { renderAiPanel('ai-' + key, r.analysis); saveAiResult_(key, r.analysis, direction); }
      else panel.innerHTML = '<div class="error-note">วิเคราะห์ไม่สำเร็จ: ' + escHtml(r ? r.error : '') + '</div>';
    })
    .catch(function (e) { btnEl.disabled = false; panel.innerHTML = '<div class="error-note">เรียก AI ไม่สำเร็จ: ' + escHtml(e.message) + '</div>'; });
}
function openOverallAI() {
  document.getElementById('overallAiModal').classList.add('show');
  var modalBody = document.getElementById('overallAiBody');
  modalBody.innerHTML = '<div class="ai-loading">🤖 กำลังวิเคราะห์ข้อมูลทั้งหมด... อาจใช้เวลาสักครู่</div>';
  var dirEl = document.getElementById('ai-dir-aiAll');
  var direction = dirEl ? dirEl.value.trim() : '';
  var bundle = {
    dateFrom: STATE.dateFrom, dateTo: STATE.dateTo,
    overview: lastDashboardData && lastDashboardData.overview,
    productGroups: lastDashboardData && (lastDashboardData.productGroups || []).slice(0, 20),
    byAd: lastDashboardData && lastDashboardData.byAd,
    timeSlots: lastDashboardData && lastDashboardData.timeSlots,
    campaigns: lastDashboardData && lastDashboardData.campaigns,
    targets: lastTargetsData,
    customers: lastCustomersData,
    signups: lastSignupsData,
    membersGen: lastMembersGenData
  };
  apiPost('aiAnalyzeAll', { bundle: JSON.stringify(bundle), dateFrom: STATE.dateFrom, dateTo: STATE.dateTo, direction: direction })
    .then(function (r) {
      var html = (r && r.success) ? buildAiHtml_(r.analysis) : '<div class="error-note">วิเคราะห์ไม่สำเร็จ: ' + escHtml(r ? r.error : '') + '</div>';
      modalBody.innerHTML = html;
      document.getElementById('ai-aiAll').innerHTML = html;
      document.getElementById('ai-aiAll').classList.add('show');
      document.getElementById('aiAll-body').innerHTML = '';
      if (r && r.success) saveAiResult_('aiAll', r.analysis, direction);
    })
    .catch(function (e) {
      var html = '<div class="error-note">เรียก AI ไม่สำเร็จ: ' + escHtml(e.message) + '</div>';
      modalBody.innerHTML = html;
    });
}
function closeOverallAI() { document.getElementById('overallAiModal').classList.remove('show'); }

// ==================== Keyword group manager ====================

function openKeywordManager(ctx) {
  document.getElementById('keywordModal').classList.add('show');
  switchKeywordContext(ctx || 'product');
}
function closeKeywordManager() { document.getElementById('keywordModal').classList.remove('show'); }
function switchKeywordContext(ctx) {
  kwState.context = ctx;
  document.querySelectorAll('.kw-tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-ctx') === ctx); });
  loadKeywordGroups();
}
function loadKeywordGroups() {
  document.getElementById('kwGroupsList').innerHTML = '<div class="empty-note">กำลังโหลด...</div>';
  document.getElementById('kwRawList').innerHTML = '';
  document.getElementById('kwSaveStatus').textContent = '';
  apiGet('getKeywordGroups', { context: kwState.context, dateFrom: STATE.dateFrom, dateTo: STATE.dateTo })
    .then(function (r) {
      if (!r || !r.success) { document.getElementById('kwGroupsList').innerHTML = '<div class="error-note">โหลดไม่สำเร็จ: ' + escHtml(r ? r.error : '') + '</div>'; return; }
      kwState.groups = r.groups || [];
      kwState.rawList = r.rawProductNames || [];
      renderKeywordGroups();
      renderKeywordRawList();
    })
    .catch(function (e) { document.getElementById('kwGroupsList').innerHTML = '<div class="error-note">' + escHtml(e.message) + '</div>'; });
}
function matchGroupClient_(g, name) { return (g.keywords || []).some(function (k) { return k && String(name).indexOf(k) !== -1; }); }
function renderKeywordGroups() {
  var wrap = document.getElementById('kwGroupsList');
  if (!kwState.groups.length) { wrap.innerHTML = '<div class="empty-note">ยังไม่มีกลุ่ม กด "+ เพิ่มกลุ่มใหม่" เพื่อเริ่มต้น</div>'; return; }
  wrap.innerHTML = kwState.groups.map(function (g, idx) {
    var count = kwState.rawList.filter(function (r) { return matchGroupClient_(g, r.name); }).length;
    return '<div class="kw-group-row">'
      + '<input class="gname" data-idx="' + idx + '" value="' + escAttr(g.name) + '" placeholder="ชื่อกลุ่ม">'
      + '<textarea class="gkw" data-idx="' + idx + '" placeholder="keyword1, keyword2, ...">' + escHtml((g.keywords || []).join(', ')) + '</textarea>'
      + '<div class="row-actions"><span class="preview-count">จับคู่ได้ ' + count + ' รายการ</span><button class="kw-del-btn" data-idx="' + idx + '">ลบกลุ่ม</button></div>'
      + '</div>';
  }).join('');
  wrap.querySelectorAll('.gname').forEach(function (inp) { inp.addEventListener('input', function () { kwState.groups[+this.dataset.idx].name = this.value; }); });
  wrap.querySelectorAll('.gkw').forEach(function (ta) {
    ta.addEventListener('input', function () { kwState.groups[+this.dataset.idx].keywords = this.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean); });
  });
  wrap.querySelectorAll('.kw-del-btn').forEach(function (btn) { btn.addEventListener('click', function () { removeKeywordGroup(+this.dataset.idx); }); });
}
function addKeywordGroup() { kwState.groups.push({ name: 'กลุ่มใหม่', keywords: [] }); renderKeywordGroups(); }
function removeKeywordGroup(idx) { kwState.groups.splice(idx, 1); renderKeywordGroups(); }
function renderKeywordRawList() {
  var q = (document.getElementById('kwSearch').value || '').trim().toLowerCase();
  var list = kwState.rawList.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) !== -1; });
  var wrap = document.getElementById('kwRawList');
  if (!list.length) { wrap.innerHTML = '<div class="empty-note">ไม่พบสินค้าในช่วงวันที่นี้</div>'; return; }
  var optionsHtml = '<option value="__new__">+ สร้างกลุ่มใหม่จากชื่อนี้</option>' + kwState.groups.map(function (g, idx) { return '<option value="' + idx + '">' + escAttr(g.name) + '</option>'; }).join('');
  wrap.innerHTML = list.map(function (r, i) {
    var matched = r.matchedGroup;
    return '<div class="kw-raw-item">'
      + '<div class="nm" title="' + escAttr(r.name) + '">' + escHtml(r.name) + '</div>'
      + '<div class="amt">' + fmtMoney(r.amount) + '</div>'
      + (matched ? '<span class="tag tag-grouped">' + escHtml(matched) + '</span>' : '<span class="tag tag-ungrouped">ยังไม่จัดกลุ่ม</span>')
      + '<select class="kw-target-select" id="kwtsel_' + i + '">' + optionsHtml + '</select>'
      + '<button class="kw-quickadd" data-i="' + i + '" data-name="' + escAttr(r.name) + '">ใช้</button>'
      + '</div>';
  }).join('');
  wrap.querySelectorAll('.kw-quickadd').forEach(function (btn) { btn.addEventListener('click', function () { quickAddKeyword(+this.dataset.i, this.dataset.name); }); });
}
function quickAddKeyword(i, name) {
  var sel = document.getElementById('kwtsel_' + i);
  var val = sel.value;
  if (val === '__new__') {
    kwState.groups.push({ name: name, keywords: [name] });
  } else {
    var g = kwState.groups[+val];
    if (g.keywords.indexOf(name) === -1) g.keywords.push(name);
  }
  renderKeywordGroups();
  renderKeywordRawList();
}
function saveKeywordGroups() {
  var btn = document.getElementById('kwSaveBtn');
  var status = document.getElementById('kwSaveStatus');
  btn.disabled = true; status.textContent = 'กำลังบันทึก...';
  var groups = kwState.groups.filter(function (g) { return g.name && g.name.trim(); });
  apiPost('saveKeywordGroups', { context: kwState.context, groups: JSON.stringify(groups) })
    .then(function (r) {
      btn.disabled = false;
      if (r && r.success) { status.textContent = '✅ บันทึกแล้ว (' + r.saved + ' กลุ่ม) — กด "แสดงผล" ที่ช่วงวันที่ด้านบนเพื่อให้รายงานอัปเดต'; }
      else { status.textContent = '❌ บันทึกไม่สำเร็จ: ' + (r ? r.error : ''); }
    })
    .catch(function (e) { btn.disabled = false; status.textContent = '❌ ' + e.message; });
}

// ==================== Init ====================

document.addEventListener('DOMContentLoaded', function () {
  if (isApiNotConfigured_()) {
    var hint = document.querySelector('.login-hint');
    if (hint) hint.innerHTML = '⚠️ ยังไม่ได้ตั้งค่า API_URL ในไฟล์ dashboard.js — กรุณาดูวิธีตั้งค่าในเอกสารที่แนบมากับไฟล์ DashboardApi.gs ก่อนใช้งาน';
  }
  document.getElementById('loginPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') handleLogin(); });
  document.querySelectorAll('.preset-btn[data-preset]').forEach(function (btn) { btn.addEventListener('click', function () { setPreset(btn.getAttribute('data-preset')); }); });
  document.querySelectorAll('.ai-btn').forEach(function (btn) {
    var key = btn.getAttribute('data-report');
    var group = document.createElement('div');
    group.className = 'ai-btn-group';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'ai-direction-input';
    input.id = 'ai-dir-' + key;
    input.placeholder = 'บอกทิศทางที่ต้องการให้ AI เน้น (ไม่ใส่ก็ได้)';
    btn.parentNode.insertBefore(group, btn);
    group.appendChild(input);
    group.appendChild(btn);
    btn.addEventListener('click', function () { runAiAnalyze(key, btn); });
  });
  restoreAiPanels_();

  var savedPw = null;
  try { savedPw = sessionStorage.getItem('emocha.dashboard.password'); } catch (e) {}
  if (savedPw && !isApiNotConfigured_()) {
    STATE.password = savedPw;
    apiGet('verifyPassword', {}).then(function (r) { if (r && r.success) enterApp(); }).catch(function () {});
  }
});
