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
    const data = await fetch(path, { cache: 'no-store' }).then((r) => r.json());
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
    const meta = await loadJSON('../data/meta.json', { force });
    const stamp = meta?.last_update_utc;
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
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
function formatCompetencia(comp) {
  if (!comp) return '';
  if (/^\d{4}-\d{2}$/.test(comp)) {
    const [y, m] = comp.split('-').map(Number);
    return `${String(m).padStart(2, '0')}/${y}`;
  }
  return comp;
}
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function daysDiff(from, to) {
  const diff = to.getTime() - from.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function fillTableRows(tbody, rows, builder) {
  tbody.innerHTML = '';
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 99;
    td.className = 'text-center text-sm text-slate-500';
    td.textContent = 'Nenhum registro encontrado';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  let i = 0;
  const step = () => {
    const frag = document.createDocumentFragment();
    for (let count = 0; i < rows.length && count < ROW_CHUNK; count += 1, i += 1) {
      frag.appendChild(builder(rows[i]));
    }
    tbody.appendChild(frag);
    if (i < rows.length) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

function syncHash(tab, extras = {}) {
  const filters = sanitizedFilters(state.filters[tab] || {});
  const sort = state.sort[tab];
  const payload = { size: getPageSize(tab), page: state.page[tab] || 1, ...extras };
  if (sort?.key) {
    payload.sort = sort.key;
    payload.dir = sort.asc ? 'asc' : 'desc';
  }
  updateHash(tab, filters, payload);
}

/* ----------------------- DASHBOARD ----------------------- */
async function renderDashboard() {
  const proc = await loadJSON('../data/processes.json');
  const events = await loadJSON('../data/events.json');
  await loadJSON('../data/kpis.json');

  const cards = $('#cards');
  if (cards) cards.innerHTML = '';
  const hoje = new Date();
  const ym = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const finalizadosMes = (proc || []).filter((p) => (p.conclusao || '').startsWith(ym)).length;

  const lt = (proc || [])
    .map((p) => Number(p.dias_corridos || p.lead_time || 0))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avg = lt.length ? Math.round(lt.reduce((a, b) => a + b, 0) / lt.length) : 0;
  const med = lt.length ? [...lt].sort((a, b) => a - b)[Math.floor(lt.length / 2)] : 0;

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

  const difalMap = {};
  (events || [])
    .filter((e) => e.categoria === 'difal')
    .forEach((e) => {
      const key = e.subtipo || 'N/D';
      difalMap[key] = (difalMap[key] || 0) + 1;
    });
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
  const tab = 'obrigacoes';
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => compareValues(a, b));

  const categorias = uniq(events.map((e) => e.categoria));
  const subtipos = uniq(events.map((e) => e.subtipo));
  const status = uniq(events.map((e) => e.status));
  const respons = uniq(events.map((e) => e.responsavel));
  const regimes = uniq(events.map((e) => e.regime));

  const schema = [
    { id: 'q', label: '🔎 Empresa, CNPJ, ProcID ou termo', type: 'text' },
    { id: 'categoria', label: 'Categoria', type: 'select', options: categorias },
    { id: 'subtipo', label: 'Subtipo', type: 'select', options: subtipos },
    { id: 'status', label: 'Status', type: 'select', options: status },
    { id: 'responsavel', label: 'Responsável', type: 'select', options: respons },
    { id: 'regime', label: 'Regime', type: 'select', options: regimes },
    { id: 'competencia', label: 'Competência', type: 'month' },
    { id: 'dataDe', label: 'Data de', type: 'date' },
    { id: 'dataAte', label: 'Data até', type: 'date' },
  ];
  const { apply, clear, exportBtn } = buildFilters($('#filters-obrig'), schema, tab);

  const savedFilters = readFilters(tab);
  const hashFilters = {};
  schema.forEach((f) => {
    if (state.hashParams?.has(f.id)) hashFilters[f.id] = state.hashParams.get(f.id);
  });
  const initial = { ...savedFilters, ...hashFilters };
  state.filters[tab] = initial;
  schema.forEach((f) => {
    const input = $(`#${f.id}`);
    if (input && initial[f.id]) input.value = initial[f.id];
  });

  const hashPage = Number(state.hashParams?.get('page'));
  if (Number.isFinite(hashPage) && hashPage > 0) state.page[tab] = hashPage;
  const hashSize = Number(state.hashParams?.get('size'));
  if (Number.isFinite(hashSize) && PAGE_SIZES.includes(hashSize)) setPageSize(tab, hashSize);
  const hashSort = state.hashParams?.get('sort');
  if (hashSort) {
    state.sort[tab] = { key: hashSort, asc: state.hashParams.get('dir') !== 'desc' };
  } else if (!state.sort[tab]) {
    state.sort[tab] = { key: 'data_evento', asc: false };
  }

  const columns = [
    { key: 'proc_id', label: 'PROC ID' },
    { key: 'empresa', label: 'EMPRESA' },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'categoria', label: 'CATEGORIA' },
    { key: 'subtipo', label: 'SUBTIPO' },
    { key: 'status', label: 'STATUS' },
    { key: 'responsavel', label: 'RESPONSÁVEL' },
    { key: 'regime', label: 'REGIME' },
    { key: 'competencia', label: 'COMPETÊNCIA' },
    { key: 'data_evento', label: 'DATA EVENTO' },
    { key: 'link', label: 'ACESSÓRIAS', sortable: false },
  ];

  const tableWrap = $('#table-obrig');
  const pager = $('#pager-obrig');

  const filterRows = () => {
    const f = state.filters[tab] || {};
    let rows = events.slice();
    const q = (f.q || '').toLowerCase();
    if (q) {
      rows = rows.filter((e) =>
        [e.empresa, e.cnpj, e.proc_id, e.categoria, e.subtipo, e.status, e.responsavel]
          .some((v) => (v || '').toLowerCase().includes(q)),
      );
    }
    ['categoria', 'subtipo', 'status', 'responsavel', 'regime'].forEach((key) => {
      if (f[key]) rows = rows.filter((e) => (e[key] || '') === f[key]);
    });
    if (f.competencia) rows = rows.filter((e) => (e.competencia || '').startsWith(f.competencia));
    if (f.dataDe) rows = rows.filter((e) => !e.data_evento || e.data_evento >= f.dataDe);
    if (f.dataAte) rows = rows.filter((e) => !e.data_evento || e.data_evento <= f.dataAte);

    const sortInfo = state.sort[tab] || { key: 'data_evento', asc: false };
    return applySort(rows, sortInfo.key, sortInfo.asc);
  };

  const buildRow = (item) => {
    const tr = document.createElement('tr');
    const link = item.proc_id ? `https://app.acessorias.com/processes/${item.proc_id}` : '';
    const values = {
      proc_id: item.proc_id || '—',
      empresa: item.empresa || '—',
      cnpj: item.cnpj || '—',
      categoria: badgeForCategoria(item.categoria || ''),
      subtipo: item.subtipo || '—',
      status: badgeForStatus(item.status || ''),
      responsavel: item.responsavel || '—',
      regime: item.regime || '—',
      competencia: formatCompetencia(item.competencia || ''),
      data_evento: formatDate(item.data_evento),
      link: link ? `<a class="text-sky-600 underline" href="${link}" target="_blank" rel="noopener">Abrir</a>` : '—',
    };
    tr.innerHTML = columns
      .map((col) => `<td>${values[col.key] ?? (item[col.key] || '—')}</td>`)
      .join('');
    return tr;
  };

  const renderTable = (rows) => {
    const { slice, total, page, pages, size, start } = paginate(rows, tab);
    state.page[tab] = page;
    tableWrap.innerHTML = '';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const sortInfo = state.sort[tab];
    columns.forEach((col) => {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.scope = 'col';
      if (col.sortable === false) {
        th.setAttribute('aria-sort', 'none');
        headRow.appendChild(th);
        return;
      }
      th.dataset.key = col.key;
      th.tabIndex = 0;
      const isActive = sortInfo?.key === col.key;
      th.setAttribute('aria-sort', isActive ? (sortInfo.asc ? 'ascending' : 'descending') : 'none');
      const toggle = () => {
        const current = state.sort[tab] || { key: col.key, asc: true };
        const asc = current.key === col.key ? !current.asc : true;
        state.sort[tab] = { key: col.key, asc };
        state.page[tab] = 1;
        const newRows = filterRows();
        renderTable(newRows);
        syncHash(tab);
      };
      th.addEventListener('click', toggle);
      th.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          toggle();
        }
      });
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);
    tableWrap.appendChild(table);
    fillTableRows(tbody, slice, buildRow);

    pager.innerHTML = '';
    const totalSpan = document.createElement('span');
    totalSpan.className = 'text-sm text-slate-600';
    totalSpan.textContent = `Exibindo ${total ? start + 1 : 0}-${start + slice.length} de ${total}`;

    const controls = document.createElement('div');
    controls.className = 'flex items-center gap-2';

    const prev = document.createElement('button');
    prev.className = 'btn-outline';
    prev.type = 'button';
    prev.textContent = '◀';
    prev.disabled = page <= 1;
    prev.addEventListener('click', () => {
      state.page[tab] = Math.max(1, page - 1);
      renderTable(filterRows());
      syncHash(tab, { page: state.page[tab] });
    });

    const next = document.createElement('button');
    next.className = 'btn-outline';
    next.type = 'button';
    next.textContent = '▶';
    next.disabled = page >= pages;
    next.addEventListener('click', () => {
      state.page[tab] = Math.min(pages, page + 1);
      renderTable(filterRows());
      syncHash(tab, { page: state.page[tab] });
    });

    const pageInfo = document.createElement('span');
    pageInfo.className = 'text-sm text-slate-600';
    pageInfo.textContent = `Página ${page}/${pages}`;

    const sizeWrap = document.createElement('label');
    sizeWrap.className = 'flex items-center gap-2 text-sm text-slate-600';
    sizeWrap.textContent = 'Itens por página';
    const select = document.createElement('select');
    select.className = 'input';
    select.id = `pageSize-${tab}`;
    PAGE_SIZES.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = String(s);
      opt.textContent = s;
      if (s === size) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      setPageSize(tab, Number(select.value));
      state.page[tab] = 1;
      renderTable(filterRows());
      syncHash(tab, { page: 1 });
    });
    sizeWrap.appendChild(select);

    controls.append(prev, pageInfo, next);
    pager.append(sizeWrap, controls, totalSpan);
  };

  apply.addEventListener('click', () => {
    const f = {};
    schema.forEach((s) => {
      const el = $(`#${s.id}`);
      f[s.id] = el ? el.value : '';
    });
    state.filters[tab] = f;
    saveFilters(tab, f);
    state.page[tab] = 1;
    const rows = filterRows();
    renderTable(rows);
    syncHash(tab, { page: 1 });
  });
  clear.addEventListener('click', () => {
    state.filters[tab] = {};
    saveFilters(tab, {});
    schema.forEach((s) => {
      const el = $(`#${s.id}`);
      if (el) el.value = '';
    });
    state.sort[tab] = { key: 'data_evento', asc: false };
    state.page[tab] = 1;
    renderTable(filterRows());
    syncHash(tab, { page: 1 });
  });
  $('#q')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply.click();
    }
  });
  exportBtn.addEventListener('click', () => {
    const rows = filterRows();
    exportCSV(
      ['proc_id', 'empresa', 'cnpj', 'categoria', 'subtipo', 'status', 'responsavel', 'regime', 'competencia', 'data_evento'],
      rows,
      'obrigacoes.csv',
    );
  });

  renderTable(filterRows());
}
/* ----------------------- PROCESSOS ----------------------- */
async function renderProcessos() {
  const proc = await loadJSON('../data/processes.json');
  const tab = 'processos';
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => compareValues(a, b));

  const gestores = uniq(proc.map((p) => p.gestor));
  const status = uniq(proc.map((p) => p.status));

  const schema = [
    { id: 'q2', label: '🔎 Empresa, CNPJ ou ProcID', type: 'text' },
    { id: 'gestor', label: 'Responsável', type: 'select', options: gestores },
    { id: 'pstatus', label: 'Status', type: 'select', options: status },
    { id: 'iniDe', label: 'Início de', type: 'date' },
    { id: 'iniAte', label: 'Início até', type: 'date' },
    { id: 'conDe', label: 'Conclusão de', type: 'date' },
    { id: 'conAte', label: 'Conclusão até', type: 'date' },
  ];
  const { apply, clear, exportBtn } = buildFilters($('#filters-proc'), schema, tab);

  const savedFilters = readFilters(tab);
  const hashFilters = {};
  schema.forEach((f) => {
    if (state.hashParams?.has(f.id)) hashFilters[f.id] = state.hashParams.get(f.id);
  });
  const initial = { ...savedFilters, ...hashFilters };
  state.filters[tab] = initial;
  schema.forEach((f) => {
    const input = $(`#${f.id}`);
    if (input && initial[f.id]) input.value = initial[f.id];
  });

  const hashPage = Number(state.hashParams?.get('page'));
  if (Number.isFinite(hashPage) && hashPage > 0) state.page[tab] = hashPage;
  const hashSize = Number(state.hashParams?.get('size'));
  if (Number.isFinite(hashSize) && PAGE_SIZES.includes(hashSize)) setPageSize(tab, hashSize);
  const hashSort = state.hashParams?.get('sort');
  if (hashSort) {
    state.sort[tab] = { key: hashSort, asc: state.hashParams.get('dir') !== 'desc' };
  } else if (!state.sort[tab]) {
    state.sort[tab] = { key: 'inicio', asc: true };
  }

  const columns = [
    { key: 'proc_id', label: 'PROC ID' },
    { key: 'empresa', label: 'EMPRESA' },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'inicio', label: 'INÍCIO' },
    { key: 'conclusao', label: 'CONCLUSÃO' },
    { key: 'dias_corridos', label: 'LEAD TIME (DIAS)' },
    { key: 'status', label: 'STATUS' },
    { key: 'gestor', label: 'RESPONSÁVEL' },
    { key: 'ultimo_update', label: 'ÚLTIMA ATUALIZAÇÃO' },
    { key: 'link', label: 'ACESSÓRIAS', sortable: false },
  ];

  const tableWrap = $('#table-proc');
  const pager = $('#pager-proc');

  const filterRows = () => {
    const f = state.filters[tab] || {};
    let rows = proc.slice();
    const q = (f.q2 || '').toLowerCase();
    if (q) {
      rows = rows.filter((p) => [p.empresa, p.cnpj, p.proc_id].some((v) => (v || '').toLowerCase().includes(q)));
    }
    if (f.gestor) rows = rows.filter((p) => (p.gestor || '') === f.gestor);
    if (f.pstatus) rows = rows.filter((p) => (p.status || '') === f.pstatus);
    if (f.iniDe) rows = rows.filter((p) => !p.inicio || p.inicio >= f.iniDe);
    if (f.iniAte) rows = rows.filter((p) => !p.inicio || p.inicio <= f.iniAte);
    if (f.conDe) rows = rows.filter((p) => !p.conclusao || p.conclusao >= f.conDe);
    if (f.conAte) rows = rows.filter((p) => !p.conclusao || p.conclusao <= f.conAte);

    const sortInfo = state.sort[tab] || { key: 'inicio', asc: true };
    return applySort(rows, sortInfo.key, sortInfo.asc);
  };

  const buildRow = (item) => {
    const tr = document.createElement('tr');
    const link = item.proc_id ? `https://app.acessorias.com/processes/${item.proc_id}` : '';
    const values = {
      proc_id: item.proc_id || '—',
      empresa: item.empresa || '—',
      cnpj: item.cnpj || '—',
      inicio: formatDate(item.inicio),
      conclusao: formatDate(item.conclusao),
      dias_corridos: item.dias_corridos || '—',
      status: badgeForStatus(item.status || ''),
      gestor: item.gestor || '—',
      ultimo_update: formatDate(item.ultimo_update),
      link: link ? `<a class="text-sky-600 underline" href="${link}" target="_blank" rel="noopener">Abrir</a>` : '—',
    };
    tr.innerHTML = columns
      .map((col) => `<td>${values[col.key] ?? (item[col.key] || '—')}</td>`)
      .join('');
    return tr;
  };

  const renderTable = (rows) => {
    const { slice, total, page, pages, size, start } = paginate(rows, tab);
    state.page[tab] = page;
    tableWrap.innerHTML = '';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const sortInfo = state.sort[tab];
    columns.forEach((col) => {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.scope = 'col';
      if (col.sortable === false) {
        th.setAttribute('aria-sort', 'none');
        headRow.appendChild(th);
        return;
      }
      th.dataset.key = col.key;
      th.tabIndex = 0;
      const isActive = sortInfo?.key === col.key;
      th.setAttribute('aria-sort', isActive ? (sortInfo.asc ? 'ascending' : 'descending') : 'none');
      const toggle = () => {
        const current = state.sort[tab] || { key: col.key, asc: true };
        const asc = current.key === col.key ? !current.asc : true;
        state.sort[tab] = { key: col.key, asc };
        state.page[tab] = 1;
        const newRows = filterRows();
        renderTable(newRows);
        syncHash(tab);
      };
      th.addEventListener('click', toggle);
      th.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          toggle();
        }
      });
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);
    tableWrap.appendChild(table);
    fillTableRows(tbody, slice, buildRow);

    pager.innerHTML = '';
    const totalSpan = document.createElement('span');
    totalSpan.className = 'text-sm text-slate-600';
    totalSpan.textContent = `Exibindo ${total ? start + 1 : 0}-${start + slice.length} de ${total}`;

    const controls = document.createElement('div');
    controls.className = 'flex items-center gap-2';

    const prev = document.createElement('button');
    prev.className = 'btn-outline';
    prev.type = 'button';
    prev.textContent = '◀';
    prev.disabled = page <= 1;
    prev.addEventListener('click', () => {
      state.page[tab] = Math.max(1, page - 1);
      renderTable(filterRows());
      syncHash(tab, { page: state.page[tab] });
    });

    const next = document.createElement('button');
    next.className = 'btn-outline';
    next.type = 'button';
    next.textContent = '▶';
    next.disabled = page >= pages;
    next.addEventListener('click', () => {
      state.page[tab] = Math.min(pages, page + 1);
      renderTable(filterRows());
      syncHash(tab, { page: state.page[tab] });
    });

    const pageInfo = document.createElement('span');
    pageInfo.className = 'text-sm text-slate-600';
    pageInfo.textContent = `Página ${page}/${pages}`;

    const sizeWrap = document.createElement('label');
    sizeWrap.className = 'flex items-center gap-2 text-sm text-slate-600';
    sizeWrap.textContent = 'Itens por página';
    const select = document.createElement('select');
    select.className = 'input';
    select.id = `pageSize-${tab}`;
    PAGE_SIZES.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = String(s);
      opt.textContent = s;
      if (s === size) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      setPageSize(tab, Number(select.value));
      state.page[tab] = 1;
      renderTable(filterRows());
      syncHash(tab, { page: 1 });
    });
    sizeWrap.appendChild(select);

    controls.append(prev, pageInfo, next);
    pager.append(sizeWrap, controls, totalSpan);
  };

  apply.addEventListener('click', () => {
    const f = {};
    schema.forEach((s) => {
      const el = $(`#${s.id}`);
      f[s.id] = el ? el.value : '';
    });
    state.filters[tab] = f;
    saveFilters(tab, f);
    state.page[tab] = 1;
    const rows = filterRows();
    renderTable(rows);
    syncHash(tab, { page: 1 });
  });
  clear.addEventListener('click', () => {
    state.filters[tab] = {};
    saveFilters(tab, {});
    schema.forEach((s) => {
      const el = $(`#${s.id}`);
      if (el) el.value = '';
    });
    state.sort[tab] = { key: 'inicio', asc: true };
    state.page[tab] = 1;
    renderTable(filterRows());
    syncHash(tab, { page: 1 });
  });
  $('#q2')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply.click();
    }
  });
  exportBtn.addEventListener('click', () => {
    const rows = filterRows();
    exportCSV(
      ['proc_id', 'empresa', 'cnpj', 'inicio', 'conclusao', 'dias_corridos', 'status', 'gestor', 'ultimo_update'],
      rows,
      'processos.csv',
    );
  });

  renderTable(filterRows());
}
/* ----------------------- ALERTAS ----------------------- */
async function renderAlertas() {
  const alerts = await loadJSON('../data/alerts.json');
  const root = $('#alerts-list');
  if (!root) return;
  const chips = $$('#view-alertas .chip');
  let mode = 'all';

  const sortByPrazo = (items = []) =>
    [...items].sort((a, b) => {
      const da = parseDate(a?.prazo);
      const db = parseDate(b?.prazo);
      if (da && db) return da - db;
      if (da) return -1;
      if (db) return 1;
      return 0;
    });

  const formatPrazo = (value) => {
    if (!value) return '';
    const date = parseDate(value);
    if (!date) return value;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const diff = daysDiff(today, utcDate);
    const label = utcDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    if (!Number.isFinite(diff)) return label;
    if (diff === 0) return `${label} · hoje`;
    if (diff > 0) return `${label} · em ${diff} dia${diff === 1 ? '' : 's'}`;
    return `${label} · há ${Math.abs(diff)} dia${Math.abs(diff) === 1 ? '' : 's'}`;
  };

  const makeCard = (title, arr, tone) => {
    if (!arr.length) return null;
    const panel = document.createElement('div');
    panel.className = 'panel';
    const heading = document.createElement('h3');
    heading.className = 'panel-title flex items-center gap-2';
    const badgeClass = tone === 'danger' ? 'badge badge-danger' : 'badge badge-warn';
    heading.innerHTML = `${title} <span class="${badgeClass}">${arr.length}</span>`;
    panel.appendChild(heading);
    const list = document.createElement('ul');
    list.className = 'divide-y divide-slate-200';
    arr.forEach((a) => {
      const li = document.createElement('li');
      li.className = 'py-2 flex flex-wrap justify-between gap-2 text-sm';
      const left = document.createElement('div');
      const empresa = a.empresa || 'Empresa não informada';
      const proc = a.proc_id ? `<span class="text-xs text-slate-500">ProcID ${a.proc_id}</span>` : '';
      left.innerHTML = `<strong>${empresa}</strong> ${proc ? `— ${proc}` : ''} ${a.competencia ? `<span class="badge">${formatCompetencia(a.competencia)}</span>` : ''}`;
      const right = document.createElement('div');
      right.className = 'text-xs text-slate-500 flex items-center gap-2';
      const prazo = formatPrazo(a.prazo);
      const link = a.proc_id
        ? `<a class="text-sky-600 underline" href="https://app.acessorias.com/processes/${a.proc_id}" target="_blank" rel="noopener">Abrir</a>`
        : '';
      right.innerHTML = `${prazo || ''}${link ? ` · ${link}` : ''}`;
      li.append(left, right);
      list.appendChild(li);
    });
    panel.appendChild(list);
    return panel;
  };

  const build = () => {
    root.innerHTML = '';
    const sn = sortByPrazo(alerts.sn_em_risco || []);
    const reinf = sortByPrazo(alerts.reinf_em_risco || []);
    const bloq = sortByPrazo(alerts.bloqueantes || []);

    if (mode === 'all' || mode === 'risco') {
      const cardSn = makeCard('SN em risco', sn, 'warn');
      const cardReinf = makeCard('REINF em risco', reinf, 'warn');
      if (cardSn) root.appendChild(cardSn);
      if (cardReinf) root.appendChild(cardReinf);
      if (!cardSn && !cardReinf) {
        const empty = document.createElement('p');
        empty.className = 'text-sm text-slate-500';
        empty.textContent = 'Nenhum alerta de risco no momento.';
        root.appendChild(empty);
      }
    }
    if (mode === 'all') {
      const cardBloq = makeCard('Passos bloqueantes', bloq, 'danger');
      if (cardBloq) root.appendChild(cardBloq);
    }
    if (mode === 'bloq') {
      const cardBloq = makeCard('Somente bloqueantes', bloq, 'danger');
      if (cardBloq) root.appendChild(cardBloq);
      if (!bloq.length) {
        const empty = document.createElement('p');
        empty.className = 'text-sm text-slate-500';
        empty.textContent = 'Nenhum bloqueio ativo.';
        root.appendChild(empty);
      }
    }
  };

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      mode = chip.dataset.alert || 'all';
      build();
    });
  });

  build();
}

/* ----------------------- EMPRESAS ----------------------- */
async function renderEmpresas() {
  const events = await loadJSON('../data/events.json');
  const proc = await loadJSON('../data/processes.json');
  const box = $('#cards-empresas');
  const q = $('#q-emp');
  if (!box || !q) return;

  const byEmp = {};
  events.forEach((e) => {
    const key = e.empresa || '(Sem nome)';
    (byEmp[key] ||= { empresa: key, cnpj: e.cnpj, events: [], procs: [] }).events.push(e);
  });
  proc.forEach((p) => {
    const key = p.empresa || '(Sem nome)';
    (byEmp[key] ||= { empresa: key, cnpj: p.cnpj, events: [], procs: [] }).procs.push(p);
  });

  const companies = Object.values(byEmp).sort((a, b) => compareValues(a.empresa || '', b.empresa || ''));

  const computeKpi = (c) => {
    const comps = [...new Set((c.events || []).map((e) => e.competencia).filter(Boolean))].sort();
    const last3 = new Set(comps.slice(-3));
    const count = (cat, status) =>
      (c.events || []).filter(
        (e) => e.categoria === cat && (!status || e.status === status) && last3.has(e.competencia),
      ).length;
    const difal = (c.events || []).some((e) => e.categoria === 'difal');
    const fora = (c.events || []).some((e) => e.categoria === 'fora_das');
    const finalizados = (c.procs || []).filter((p) => p.conclusao).length;
    const lt = (c.procs || [])
      .map((p) => Number(p.dias_corridos || p.lead_time || 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    const avg = lt.length ? Math.round(lt.reduce((a, b) => a + b, 0) / lt.length) : 0;
    return {
      reinf: `${count('efd_reinf', 'Obrigatória')} / ${count('efd_reinf', 'Dispensada')}`,
      efd: `${count('efd_contrib', 'Obrigatória')} / ${count('efd_contrib', 'Dispensada')}`,
      difal,
      fora,
      finalizados,
      avg,
    };
  };

  const renderList = (list) => {
    if (!list.length) {
      box.innerHTML = '<p class="text-sm text-slate-500">Nenhuma empresa encontrada.</p>';
      return;
    }
    box.innerHTML = list
      .map((c) => {
        const kpi = computeKpi(c);
        const timeline = [...(c.events || [])]
          .sort((a, b) => ((b.data_evento || b.competencia || '') || '').localeCompare((a.data_evento || a.competencia || '') || ''))
          .slice(0, 10)
          .map((e) => {
            const badge = e.status ? badgeForStatus(e.status) : '';
            const when = formatCompetencia(e.competencia) || formatDate(e.data_evento) || '—';
            const procLink = e.proc_id
              ? `<a class="text-sky-600 underline" href="https://app.acessorias.com/processes/${e.proc_id}" target="_blank" rel="noopener">Abrir</a>`
              : '';
            return `<li class="text-xs flex flex-wrap gap-2 items-center"><span class="badge">${when}</span> ${e.categoria || ''} ${badge}${procLink ? ` · ${procLink}` : ''}</li>`;
          })
          .join('');
        const firstProc = c.procs?.find((p) => p.proc_id)?.proc_id;
        const link = firstProc
          ? `<a class="btn-outline" href="https://app.acessorias.com/processes/${firstProc}" target="_blank" rel="noopener">Abrir no Acessórias</a>`
          : '<span class="text-xs text-slate-400">Sem ProcID disponível</span>';
        return `
          <div class="panel">
            <div class="flex items-center justify-between mb-3 gap-2">
              <div>
                <div class="font-semibold">${c.empresa}</div>
                <div class="text-xs text-slate-500">${c.cnpj || ''}</div>
              </div>
              ${link}
            </div>
            <div class="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
              <div><div class="text-slate-500">REINF (ob/disp)</div><div class="font-semibold">${kpi.reinf}</div></div>
              <div><div class="text-slate-500">EFD (ob/disp)</div><div class="font-semibold">${kpi.efd}</div></div>
              <div><div class="text-slate-500">DIFAL</div><div class="font-semibold">${kpi.difal ? 'Ativo' : '—'}</div></div>
              <div><div class="text-slate-500">Fora do DAS</div><div class="font-semibold">${kpi.fora ? 'Sim' : '—'}</div></div>
              <div><div class="text-slate-500">Processos concluídos</div><div class="font-semibold">${kpi.finalizados}</div></div>
              <div><div class="text-slate-500">Lead time médio</div><div class="font-semibold">${kpi.avg} dias</div></div>
            </div>
            <details class="mt-3">
              <summary class="cursor-pointer text-sm">Timeline (últimos 10 eventos)</summary>
              <ul class="mt-2 space-y-1">${timeline || '<li class="text-xs text-slate-400">Sem eventos recentes.</li>'}</ul>
            </details>
          </div>
        `;
      })
      .join('');
  };

  q.addEventListener('input', () => {
    const term = (q.value || '').toLowerCase();
    const filtered = companies.filter((c) =>
      (c.empresa || '').toLowerCase().includes(term) || (c.cnpj || '').toLowerCase().includes(term),
    );
    renderList(filtered);
  });

  renderList(companies);
}
async function renderTab(tab) {
  if (tab === 'dashboard') await renderDashboard();
  if (tab === 'obrigacoes') await renderObrigacoes();
  if (tab === 'processos') await renderProcessos();
  if (tab === 'alertas') await renderAlertas();
  if (tab === 'empresas') await renderEmpresas();
}

function bindTabs() {
  $$('.tab').forEach((tabEl) => {
    tabEl.addEventListener('click', (ev) => {
      ev.preventDefault();
      const tab = (tabEl.getAttribute('href') || '').replace('#tab=', '') || 'dashboard';
      if (!state.filters[tab]) state.filters[tab] = readFilters(tab) || {};
      syncHash(tab);
      activateTab(tab);
      renderTab(tab);
    });
  });
  $('#btnRefresh')?.addEventListener('click', () => {
    const btn = $('#btnRefresh');
    if (!btn) return;
    if (btn.dataset.loading === '1') return;
    btn.dataset.loading = '1';
    const original = btn.textContent;
    btn.textContent = '⏳ Atualizando...';
    btn.disabled = true;
    (async () => {
      try {
        if (state.localConfig?.update_url) {
          const res = await fetch(state.localConfig.update_url, { method: 'POST' });
          if (!res.ok) throw new Error(`Falha ao chamar update (${res.status})`);
        }
        state.cache = {};
        await renderTab(state.tab);
        await refreshMeta(true);
      } catch (err) {
        console.error('Falha ao atualizar dados', err);
        alert('Não foi possível atualizar os dados. Verifique o serviço local.');
      } finally {
        btn.dataset.loading = '0';
        btn.disabled = false;
        btn.textContent = original;
      }
    })();
  });
  window.addEventListener('hashchange', () => {
    if (state.updatingHash) {
      state.updatingHash = false;
      return;
    }
    applyFromHash();
  });
}

async function applyFromHash() {
  const { tab, params } = getHashSnapshot();
  state.hashParams = params;
  activateTab(tab);
  await renderTab(tab);
}

(async function start() {
  state.localConfig = await loadLocalConfig();
  await refreshMeta();
  bindTabs();
  if (!location.hash) {
    history.replaceState(null, '', '#tab=dashboard');
  }
  await applyFromHash();
})();
