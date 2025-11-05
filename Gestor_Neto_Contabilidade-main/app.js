'''
// app.js (ESM)
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  tab: 'dashboard',
  cache: {},
  sort: {},
  page: {},
  filters: {},
  charts: {},
  pageSize: {},
  hashParams: new URLSearchParams(),
  updatingHash: false,
  localConfig: null,
};

const PAGE_SIZES = [50, 100, 200];
const PAGE_SIZE_DEFAULT = 100;
const ROW_CHUNK = 40;

async function loadJSON(path, { force = false } = {}) {
  if (!force && state.cache[path]) return state.cache[path];
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('Erro ao carregar', path, res.status);
      return [];
    }
    const data = await res.json();
    state.cache[path] = data;
    return data;
  } catch (e) {
    console.warn('Erro ao carregar', path, e);
    return [];
  }
}

function saveFilters(tab, obj) {
  localStorage.setItem(`gst.filters.${tab}`, JSON.stringify(obj));
}
function readFilters(tab) {
  const raw = localStorage.getItem(`gst.filters.${tab}`);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn('Não foi possível ler filtros salvos', err);
    return {};
  }
}
function getPageSize(tab) {
  if (!state.pageSize[tab]) {
    const stored = Number(localStorage.getItem(`gst.pageSize.${tab}`));
    state.pageSize[tab] = PAGE_SIZES.includes(stored) ? stored : PAGE_SIZE_DEFAULT;
  }
  return state.pageSize[tab];
}
function setPageSize(tab, size) {
  const safe = PAGE_SIZES.includes(size) ? size : PAGE_SIZE_DEFAULT;
  state.pageSize[tab] = safe;
  localStorage.setItem(`gst.pageSize.${tab}`, String(safe));
}

function getHashSnapshot() {
  const raw = (location.hash || '').replace(/^#/, '');
  const params = new URLSearchParams(raw);
  const tab = params.get('tab') || 'dashboard';
  params.delete('tab');
  return { tab, params };
}

function activateTab(tab) {
  state.tab = tab;
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $$('.tab').forEach((t) => {
    const target = (t.getAttribute('href') || '').replace('#tab=', '');
    const isActive = target === tab;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  const view = $(`#view-${tab}`);
  if (view) view.classList.remove('hidden');
}

function sanitizedFilters(filters = {}) {
  const obj = {};
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') obj[k] = v;
  });
  return obj;
}

function updateHash(tab, filters = {}, extras = {}) {
  const params = new URLSearchParams();
  params.set('tab', tab);
  const combined = { ...filters, ...extras };
  Object.entries(combined).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') params.set(k, v);
  });
  state.updatingHash = true;
  state.hashParams = new URLSearchParams(params.toString());
  location.hash = params.toString();
}

function compareValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const numA = Number(a);
  const numB = Number(b);
  const validNumA = !Number.isNaN(numA) && String(a).trim() !== '';
  const validNumB = !Number.isNaN(numB) && String(b).trim() !== '';
  if (validNumA && validNumB) return numA - numB;
  const strA = (a ?? '').toString();
  const strB = (b ?? '').toString();
  return strA.localeCompare(strB, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function applySort(rows, key, asc = true) {
  if (!key) return rows.slice();
  const sorted = rows.slice().sort((a, b) => {
    const valA = key === 'link' ? '' : a?.[key];
    const valB = key === 'link' ? '' : b?.[key];
    const comp = compareValues(valA, valB);
    return asc ? comp : -comp;
  });
  return sorted;
}

function paginate(arr, tab) {
  const size = getPageSize(tab);
  const total = arr.length;
  const pages = Math.max(1, Math.ceil(total / size));
  let page = state.page[tab] || 1;
  if (page > pages) page = pages;
  if (page < 1) page = 1;
  state.page[tab] = page;
  const start = (page - 1) * size;
  const slice = arr.slice(start, start + size);
  return { slice, total, page, pages, size, start };
}

function exportCSV(headers, rows, filename = 'export.csv') {
  const esc = (v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`;
  const body = rows.map((row) => headers.map((h) => esc(row[h])).join(';')).join('\n');
  const csv = [headers.join(';'), body].filter(Boolean).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function setEmptyState(selector, show) {
  const el = typeof selector === 'string' ? $(selector) : selector;
  if (!el) return;
  el.classList.toggle('hidden', !show);
}

function hasChartData(config) {
  if (!config?.data) return false;
  const datasets = Array.isArray(config.data.datasets) ? config.data.datasets : [];
  const labels = Array.isArray(config.data.labels) ? config.data.labels : [];
  if (labels.length && datasets.length === 0) return labels.length > 0;
  return datasets.some((ds) =>
    Array.isArray(ds.data) && ds.data.some((value) => {
      if (value === null || value === undefined) return false;
      const num = Number(value);
      return !Number.isNaN(num) ? num !== 0 : String(value).trim() !== '';
    }),
  );
}

function summarizeCompanyTotals(companies) {
  const totals = { entregues: 0, atrasadas: 0, proximos30: 0, futuras30: 0 };
  let hasData = false;
  (companies || []).forEach((company) => {
    const counters = company?.counters?.totals || {};
    Object.keys(totals).forEach((key) => {
      const value = Number(counters[key] ?? 0);
      if (!Number.isNaN(value) && value > 0) {
        totals[key] += value;
        hasData = true;
      }
    });
  });
  return hasData ? totals : null;
}

async function loadLocalConfig() {
  try {
    const res = await fetch('./config.local.json', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('Sem config.local.json', err);
    return null;
  }
}

async function refreshMeta(force = false) {
  const el = $('#lastUpdate');
  if (!el) return;
  try {
    const metaRaw = await loadJSON('../data/meta.json', { force });
    const meta = metaRaw && !Array.isArray(metaRaw) ? metaRaw : {};
    const stamp = meta?.build?.last_update_utc;
    if (!stamp) {
      el.textContent = 'Sem informações de atualização';
      return;
    }
    const date = new Date(stamp);
    if (Number.isNaN(date.getTime())) {
      el.textContent = `Atualizado em ${stamp}`;
      return;
    }
    el.textContent = `Atualizado em ${date.toLocaleString('pt-BR', { hour12: false })}`;
  } catch (err) {
    console.warn('Falha ao ler meta.json', err);
    el.textContent = 'Sem informações de atualização';
  }
}

function registerChart(id, config) {
  state.charts[id]?.destroy?.();
  const canvas = document.getElementById(id.replace('#', '')) || document.querySelector(id);
  if (!canvas) return;
  const parent = canvas.closest('.panel') || canvas.parentElement;
  const existingPlaceholder = parent?.querySelector('.chart-empty');
  if (existingPlaceholder) existingPlaceholder.remove();

  const hasData = hasChartData(config);
  if (!hasData) {
    canvas.classList.add('hidden');
    if (parent) {
      const placeholder = document.createElement('div');
      placeholder.className = 'empty-state chart-empty';
      placeholder.textContent = 'Sem dados suficientes para gerar o gráfico.';
      parent.appendChild(placeholder);
    }
    return;
  }

  canvas.classList.remove('hidden');
  state.charts[id] = new Chart(canvas, config);
}

function buildFilters(container, schema, tab) {
  const wrap = document.createElement('div');
  wrap.className = 'filters';
  schema.forEach((f) => {
    if (f.type === 'select') {
      const sel = document.createElement('select');
      sel.id = f.id;
      sel.className = 'input';
      sel.setAttribute('aria-label', f.label);
      const opts = [`<option value="">${f.label}</option>`].concat(
        (f.options || []).map((o) => `<option value="${o}">${o}</option>`),
      );
      sel.innerHTML = opts.join('');
      wrap.appendChild(sel);
    } else {
      const inp = document.createElement('input');
      inp.id = f.id;
      inp.placeholder = f.label;
      inp.className = 'input';
      inp.setAttribute('aria-label', f.label);
      if (f.type !== 'text') inp.type = f.type;
      wrap.appendChild(inp);
    }
  });
  const apply = document.createElement('button');
  apply.id = `btnApply-${tab}`;
  apply.type = 'button';
  apply.className = 'btn';
  apply.textContent = 'Filtrar';
  const clear = document.createElement('button');
  clear.id = `btnClear-${tab}`;
  clear.type = 'button';
  clear.className = 'btn-outline';
  clear.textContent = 'Limpar';
  const exportBtn = document.createElement('button');
  exportBtn.id = `btnExport-${tab}`;
  exportBtn.type = 'button';
  exportBtn.className = 'btn-outline';
  exportBtn.textContent = 'Exportar CSV';
  wrap.append(apply, clear, exportBtn);
  container.innerHTML = '';
  container.appendChild(wrap);
  return { apply, clear, exportBtn };
}

function badgeForStatus(status) {
  if (!status) return '';
  const norm = status.toLowerCase();
  if (norm.includes('obrig')) return `<span class="badge badge-obg">${status}</span>`;
  if (norm.includes('disp')) return `<span class="badge badge-disp">${status}</span>`;
  if (norm.includes('final')) return `<span class="badge badge-ok">${status}</span>`;
  if (norm.includes('pend')) return `<span class="badge badge-pend">${status}</span>`;
  return `<span class="badge">${status}</span>`;
}
function badgeForCategoria(cat) {
  if (!cat) return '';
  return `<span class="badge badge-obg">${cat.toUpperCase()}</span>`;
}
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function applyFilters(rows, filters) {
  if (!Array.isArray(rows)) return [];
  const q = (filters.q || '').toLowerCase();
  const otherFilters = Object.entries(filters).filter(([k]) => k !== 'q');
  return rows.filter((row) => {
    const matchesQ =
      !q ||
      Object.values(row).some((val) =>
        String(val ?? '')
          .toLowerCase()
          .includes(q),
      );
    const matchesOthers = otherFilters.every(([k, v]) => !v || String(row[k] ?? '') === String(v));
    return matchesQ && matchesOthers;
  });
}

/* ----------------------- DASHBOARD ----------------------- */
async function renderDashboard({ force = false } = {}) {
  await refreshMeta(force);
  const [proc, events, companies] = await Promise.all([
    loadJSON('../data/processes.json', { force }),
    loadJSON('../data/events.json', { force }),
    loadJSON('../data/companies_obligations.json', { force }),
  ]);

  const cards = $('#cards');
  if (!cards) return;
  cards.innerHTML = '';

  const rows = Array.isArray(proc) ? proc : [];
  setEmptyState('#empty-dashboard', rows.length === 0);
  if (rows.length === 0) return;

  const fallbackTotals = summarizeCompanyTotals(companies);
  const finalizadosMes = (proc || []).filter(
    (p) => p.status === 'FINALIZADO' && (p.conclusao || '').startsWith(new Date().toISOString().slice(0, 7)),
  ).length;
  const avg = (proc || []).length ? (proc || []).reduce((a, b) => a + (b.dias_corridos || 0), 0) / (proc || []).length : 0;
  const med = (proc || []).length
    ? (proc || [])
        .map((p) => p.dias_corridos || 0)
        .sort((a, b) => a - b)[Math.floor((proc || []).length / 2)]
    : 0;

  const ym = new Date().toISOString().slice(0, 7);
  const countBy = (categoria, status) =>
    (events || []).filter(
      (e) => e.categoria === categoria && (!status || e.status === status) && (e.competencia || '').startsWith(ym),
    ).length;

  const card = (title, value, note = '') => `
    <div class="panel">
      <div class="text-sm text-slate-500">${title}</div>
      <div class="text-2xl font-semibold">${value}</div>
      ${note ? `<div class="text-xs text-slate-500 mt-1">${note}</div>` : ''}
    </div>
  `;

  const reinfOb = countBy('efd_reinf', 'Obrigatória');
  const reinfDisp = countBy('efd_reinf', 'Dispensada');
  const efdOb = countBy('efd_contrib', 'Obrigatória');
  const efdDisp = countBy('efd_contrib', 'Dispensada');

  cards?.insertAdjacentHTML('beforeend', card('Finalizados (mês)', finalizadosMes));
  cards?.insertAdjacentHTML('beforeend', card('Lead time médio (dias)', avg || '—'));
  cards?.insertAdjacentHTML('beforeend', card('Lead time mediano (dias)', med || '—'));
  cards?.insertAdjacentHTML(
    'beforeend',
    card('REINF (obrigatórias/dispensadas no mês)', `${reinfOb} / ${reinfDisp}`),
  );
  cards?.insertAdjacentHTML(
    'beforeend',
    card('EFD Contrib (obrigatórias/dispensadas no mês)', `${efdOb} / ${efdDisp}`),
  );

  if (fallbackTotals) {
    const labels = [
      ['entregues', 'Entregues'],
      ['atrasadas', 'Atrasadas'],
      ['proximos30', 'Próx. 30 dias'],
      ['futuras30', 'Futuras 30+'],
    ];
    const grid = labels
      .map(
        ([key, label]) => `
        <div>
          <div class="text-xs text-slate-500">${label}</div>
          <div class="text-xl font-semibold">${fallbackTotals[key] ?? 0}</div>
        </div>
      `,
      )
      .join('');
    cards?.insertAdjacentHTML(
      'beforeend',
      `
        <div class="panel">
          <div class="text-sm text-slate-500 mb-2">Resumo de obrigações (companies_obligations.json)</div>
          <div class="summary-grid">${grid}</div>
        </div>
      `,
    );
  }

  const compKeys = [...new Set((events || []).map((e) => e.competencia).filter(Boolean))].sort();
  const stackSeries = (cat) => {
    const obrig = compKeys.map((c) =>
      (events || []).filter(
        (e) => e.categoria === cat && e.status === 'Obrigatória' && e.competencia === c,
      ).length,
    );
    const disp = compKeys.map((c) =>
      (events || []).filter(
        (e) => e.categoria === cat && e.status === 'Dispensada' && e.competencia === c,
      ).length,
    );
    return { labels: compKeys, obrig, disp };
  };
  const reinf = stackSeries('efd_reinf');
  const efd = stackSeries('efd_contrib');

  const difalMap = {};
  (events || [])
    .filter((e) => e.categoria === 'difal')
    .forEach((e) => {
      const key = e.subtipo || 'N/D';
      difalMap[key] = (difalMap[key] || 0) + 1;
    });

  const palette = ['#1d4ed8', '#0ea5e9', '#16a34a', '#f97316', '#0f172a'];

  const mkBar = (canvasId, labels, d1, d2) => {
    registerChart(canvasId, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Obrigatória', data: d1, backgroundColor: '#1d4ed8', stack: 'stack' },
          { label: 'Dispensada', data: d2, backgroundColor: '#f59e0b', stack: 'stack' },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
      },
    });
  };
  mkBar('#chReinf', reinf.labels, reinf.obrig, reinf.disp);
  mkBar('#chEfd', efd.labels, efd.obrig, efd.disp);

  registerChart('#chDifal', {
    type: 'doughnut',
    data: {
      labels: Object.keys(difalMap),
      datasets: [
        {
          data: Object.values(difalMap),
          backgroundColor: palette,
        },
      ],
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
  });

  const byComp = {};
  (proc || []).forEach((p) => {
    const conclusion = p.conclusao || p.data_fechamento;
    if (!conclusion) return;
    const comp = conclusion.slice(0, 7);
    const day = Number(conclusion.slice(8, 10));
    if (!Number.isFinite(day)) return;
    (byComp[comp] ||= []).push(day);
  });
  const comp2 = Object.keys(byComp).sort();
  const mean = comp2.map((c) => Math.round(byComp[c].reduce((a, b) => a + b, 0) / byComp[c].length));
  const median = comp2.map((c) => {
    const arr = [...byComp[c]].sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  });
  registerChart('#chFechamento', {
    type: 'line',
    data: {
      labels: comp2,
      datasets: [
        { label: 'Média', data: mean, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.3)', tension: 0.3 },
        { label: 'Mediana', data: median, borderColor: '#0f172a', backgroundColor: 'rgba(15,23,42,.3)', tension: 0.3 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}
/* ----------------------- OBRIGAÇÕES (EVENTOS) ----------------------- */
async function renderObrigacoes() {
  const events = await loadJSON('../data/events.json');
  const hasEvents = Array.isArray(events) && events.length > 0;
  setEmptyState('#empty-obrig', !hasEvents);
  if (!hasEvents) return;

  const tab = 'obrigacoes';
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => compareValues(a, b));

  const categorias = uniq(events.map((e) => e.categoria));
  const subtipos = uniq(events.map((e) => e.subtipo));
  const empresas = uniq(events.map((e) => e.empresa));
  const responsaveis = uniq(events.map((e) => e.responsavel));
  const status = uniq(events.map((e) => e.status));
  const competencias = uniq(events.map((e) => e.competencia));

  const filtersSchema = [
    { id: 'q', label: 'Busca livre', type: 'text' },
    { id: 'empresa', label: 'Empresa', type: 'select', options: empresas },
    { id: 'responsavel', label: 'Responsável', type: 'select', options: responsaveis },
    { id: 'status', label: 'Status', type: 'select', options: status },
    { id: 'categoria', label: 'Categoria', type: 'select', options: categorias },
    { id: 'subtipo', label: 'Subtipo', type: 'select', options: subtipos },
    { id: 'competencia', label: 'Competência', type: 'select', options: competencias },
  ];

  const { apply, clear, exportBtn } = buildFilters($('#filters-obrig'), filtersSchema, tab);
  const currentFilters = readFilters(tab);
  state.filters[tab] = currentFilters;

  filtersSchema.forEach((f) => {
    const el = $(`#${f.id}`);
    if (el && currentFilters[f.id]) el.value = currentFilters[f.id];
  });

  const filtered = applyFilters(events, currentFilters);
  const { slice, total, page, pages, size } = paginate(filtered, tab);

  renderTable(
    $('#table-obrig'),
    slice,
    [
      { key: 'empresa', label: 'Empresa', sortable: true },
      { key: 'cnpj', label: 'CNPJ' },
      { key: 'categoria', label: 'Categoria', render: badgeForCategoria },
      { key: 'subtipo', label: 'Subtipo' },
      { key: 'status', label: 'Status', render: badgeForStatus, sortable: true },
      { key: 'responsavel', label: 'Responsável' },
      { key: 'competencia', label: 'Competência', sortable: true },
      { key: 'prazo', label: 'Prazo', render: formatDate, sortable: true },
      { key: 'entrega', label: 'Entrega', render: formatDate, sortable: true },
    ],
    tab,
  );
  renderPager($('#pager-obrig'), total, page, pages, size, tab);

  apply.onclick = () => {
    const newFilters = {};
    filtersSchema.forEach((f) => {
      const el = $(`#${f.id}`);
      if (el) newFilters[f.id] = el.value;
    });
    state.filters[tab] = sanitizedFilters(newFilters);
    saveFilters(tab, state.filters[tab]);
    state.page[tab] = 1;
    updateHash(tab, state.filters[tab]);
    renderObrigacoes();
  };
  clear.onclick = () => {
    state.filters[tab] = {};
    saveFilters(tab, {});
    state.page[tab] = 1;
    updateHash(tab, {});
    renderObrigacoes();
  };
  exportBtn.onclick = () => {
    const headers = [
      'empresa',
      'cnpj',
      'categoria',
      'subtipo',
      'status',
      'responsavel',
      'competencia',
      'prazo',
      'entrega',
    ];
    exportCSV(headers, filtered, 'obrigacoes.csv');
  };
}

/* ----------------------- PROCESSOS ----------------------- */
async function renderProcessos({ force = false } = {}) {
  const data = await loadJSON('../data/processes.json', { force });
  const rows = Array.isArray(data) ? data : [];
  const tab = 'processos';
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => compareValues(a, b));

  const empresas = uniq(rows.map((r) => r.empresa));
  const status = uniq(rows.map((r) => r.status));
  const gestores = uniq(rows.map((r) => r.gestor));

  const filtersSchema = [
    { id: 'q', label: 'Busca livre', type: 'text' },
    { id: 'empresa', label: 'Empresa', type: 'select', options: empresas },
    { id: 'status', label: 'Status', type: 'select', options: status },
    { id: 'gestor', label: 'Gestor', type: 'select', options: gestores },
  ];

  const { apply, clear, exportBtn } = buildFilters($('#filters-proc'), filtersSchema, tab);
  const currentFilters = readFilters(tab);
  state.filters[tab] = currentFilters;

  filtersSchema.forEach((f) => {
    const el = $(`#${f.id}`);
    if (el && currentFilters[f.id]) el.value = currentFilters[f.id];
  });

  const filtered = applyFilters(rows, currentFilters);
  const { slice, total, page, pages, size } = paginate(filtered, tab);

  renderTable(
    $('#table-proc'),
    slice,
    [
      { key: 'proc_id', label: 'ID' },
      { key: 'empresa', label: 'Empresa', sortable: true },
      { key: 'cnpj', label: 'CNPJ' },
      { key: 'status', label: 'Status', render: badgeForStatus, sortable: true },
      { key: 'gestor', label: 'Gestor' },
      { key: 'inicio', label: 'Início', render: formatDate, sortable: true },
      { key: 'conclusao', label: 'Conclusão', render: formatDate, sortable: true },
      { key: 'dias_corridos', label: 'Dias', sortable: true },
      { key: 'ultimo_update', label: 'Última atualização' },
    ],
    tab,
  );
  renderPager($('#pager-proc'), total, page, pages, size, tab);

  apply.onclick = () => {
    const newFilters = {};
    filtersSchema.forEach((f) => {
      const el = $(`#${f.id}`);
      if (el) newFilters[f.id] = el.value;
    });
    state.filters[tab] = sanitizedFilters(newFilters);
    saveFilters(tab, state.filters[tab]);
    state.page[tab] = 1;
    updateHash(tab, state.filters[tab]);
    renderProcessos();
  };
  clear.onclick = () => {
    state.filters[tab] = {};
    saveFilters(tab, {});
    state.page[tab] = 1;
    updateHash(tab, {});
    renderProcessos();
  };
  exportBtn.onclick = () => {
    const headers = [
      'proc_id',
      'empresa',
      'cnpj',
      'status',
      'gestor',
      'inicio',
      'conclusao',
      'dias_corridos',
      'ultimo_update',
    ];
    exportCSV(headers, filtered, 'processos.csv');
  };
}

/* ----------------------- ALERTAS ----------------------- */
async function renderAlertas({ force = false } = {}) {
  const data = await loadJSON('../data/alerts.json', { force });
  const alerts = data && !Array.isArray(data) ? data : {};
  const list = $('#alerts-list');
  if (!list) return;
  list.innerHTML = '';

  const activeFilter = state.hashParams.get('alert') || 'all';

  const renderAlerts = (title, items, type) => {
    if (!items || items.length === 0) return;
    if (activeFilter === 'risco' && type === 'bloq') return;
    if (activeFilter === 'bloq' && type !== 'bloq') return;

    const html = `
      <div class="panel">
        <h3 class="panel-title">${title} (${items.length})</h3>
        <ul class="list-disc list-inside space-y-1">
          ${items
            .map(
              (item) => `
              <li>
                <span class="font-semibold">${item.empresa || 'Empresa não identificada'}</span>
                ${item.competencia ? `(Comp: ${item.competencia})` : ''}
                ${item.prazo ? `— Prazo: ${formatDate(item.prazo)}` : ''}
                ${item.responsavel ? `— Resp: ${item.responsavel}` : ''}
                ${item.status ? `— Status: ${item.status}` : ''}
              </li>
            `,
            )
            .join('')}
        </ul>
      </div>
    `;
    list.insertAdjacentHTML('beforeend', html);
  };

  renderAlerts('REINF em Risco (próximos 5 dias)', alerts.reinf_em_risco, 'risco');
  renderAlerts('EFD Contribuições em Risco (próximos 5 dias)', alerts.efd_contrib_em_risco, 'risco');
  renderAlerts('Passos Bloqueantes', alerts.bloqueantes, 'bloq');

  if (list.innerHTML === '') {
    list.innerHTML = `
      <div class="empty-state">
        <p class="text-lg font-semibold">Nenhum alerta encontrado.</p>
        <p>Parabéns, a operação está em dia!</p>
      </div>
    `;
  }

  $$('#view-alertas .chip').forEach((chip) => {
    const filter = chip.dataset.alert;
    chip.classList.toggle('active', filter === activeFilter);
    chip.onclick = () => {
      updateHash('alertas', {}, { alert: filter });
      renderAlertas();
    };
  });
}

/* ----------------------- EMPRESAS ----------------------- */
async function renderEmpresas({ force = false } = {}) {
  const data = await loadJSON('../data/companies_obligations.json', { force });
  const rows = Array.isArray(data) ? data : [];
  setEmptyState('#empty-empresas', rows.length === 0);
  if (rows.length === 0) return;

  const list = $('#cards-empresas');
  if (!list) return;
  list.innerHTML = '';

  const q = ($('#q-emp')?.value || '').toLowerCase();
  const filtered = rows.filter((r) => {
    if (!q) return true;
    const name = (r.empresa || '').toLowerCase();
    const cnpj = (r.cnpj || '').toLowerCase();
    return name.includes(q) || cnpj.includes(q);
  });

  filtered.forEach((r) => {
    const totals = r.counters?.totals || {};
    const grid = `
      <div class="summary-grid">
        <div>
          <div class="text-xs text-slate-500">Entregues</div>
          <div class="text-lg font-semibold">${totals.entregues ?? 0}</div>
        </div>
        <div>
          <div class="text-xs text-slate-500">Atrasadas</div>
          <div class="text-lg font-semibold">${totals.atrasadas ?? 0}</div>
        </div>
        <div>
          <div class="text-xs text-slate-500">Próx. 30 dias</div>
          <div class="text-lg font-semibold">${totals.proximos30 ?? 0}</div>
        </div>
        <div>
          <div class="text-xs text-slate-500">Futuras 30+</div>
          <div class="text-lg font-semibold">${totals.futuras30 ?? 0}</div>
        </div>
      </div>
    `;
    const html = `
      <div class="panel">
        <h3 class="panel-title">${r.empresa || 'Empresa sem nome'}</h3>
        <p class="text-sm text-slate-500 mb-3">${r.cnpj || 'CNPJ não informado'}</p>
        ${grid}
      </div>
    `;
    list.insertAdjacentHTML('beforeend', html);
  });

  $('#q-emp')?.addEventListener('input', () => renderEmpresas());
}

/* ----------------------- INICIALIZAÇÃO ----------------------- */
async function init() {
  state.localConfig = await loadLocalConfig();
  const { tab, params } = getHashSnapshot();
  state.hashParams = params;
  activateTab(tab);

  window.addEventListener('hashchange', () => {
    if (state.updatingHash) {
      state.updatingHash = false;
      return;
    }
    const { tab: newTab, params: newParams } = getHashSnapshot();
    state.hashParams = newParams;
    activateTab(newTab);
    renderCurrentTab();
  });

  $('#btnRefresh')?.addEventListener('click', () => {
    state.cache = {};
    renderCurrentTab({ force: true });
  });

  renderCurrentTab();
}

function renderCurrentTab(opts = {}) {
  switch (state.tab) {
    case 'dashboard':
      renderDashboard(opts);
      break;
    case 'obrigacoes':
      renderObrigacoes(opts);
      break;
    case 'processos':
      renderProcessos(opts);
      break;
    case 'alertas':
      renderAlertas(opts);
      break;
    case 'empresas':
      renderEmpresas(opts);
      break;
    default:
      renderDashboard(opts);
  }
}

init();
'''
