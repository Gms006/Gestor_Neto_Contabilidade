// Variáveis globais
let allEvents = [];
let allProcesses = [];
let allKpis = {};
let allAlerts = {};

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    renderDashboard();
    renderObrigacoes();
    renderProcessos();
    renderAlertas();
    populateEmpresaSelect();
    updateLastUpdate();
});

// Carregar dados
async function loadData() {
    try {
        const [events, processes, kpis, alerts] = await Promise.all([
            fetch('../data/events.json').then(r => r.json()),
            fetch('../data/processes.json').then(r => r.json()),
            fetch('../data/kpis.json').then(r => r.json()),
            fetch('../data/alerts.json').then(r => r.json())
        ]);

        allEvents = events;
        allProcesses = processes;
        allKpis = kpis;
        allAlerts = alerts;

        console.log('Dados carregados:', {
            events: events.length,
            processes: processes.length
        });
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        alert('Erro ao carregar dados. Verifique se os arquivos JSON foram gerados.');
    }
}

// Navegação entre páginas
function showPage(pageName) {
    // Remove active de todos os botões e páginas
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    // Ativa página e botão selecionado
    document.getElementById(`page-${pageName}`).classList.add('active');
    document.querySelector(`[data-page="${pageName}"]`).classList.add('active');
}

// ===== DASHBOARD =====
function renderDashboard() {
    // KPIs
    document.getElementById('kpi-finalizados').textContent = 
        allKpis.produtividade?.finalizados_total || 0;
    
    document.getElementById('kpi-tempo-medio').textContent = 
        Math.round(allKpis.produtividade?.tempo_medio || 0);
    
    document.getElementById('kpi-sn-risco').textContent = 
        allAlerts.sn_em_risco?.length || 0;
    
    document.getElementById('kpi-reinf-risco').textContent = 
        allAlerts.reinf_em_risco?.length || 0;

    // Gráficos
    renderChartCompetencia();
    renderChartDifal();
    renderChartForaDas();
    renderRankingResponsaveis();
}

function renderChartCompetencia() {
    const ctx = document.getElementById('chart-competencia');
    const data = allKpis.entregas_por_competencia || {};
    
    const competencias = Object.keys(data).sort();
    const datasets = [
        {
            label: 'REINF Obrigatória',
            data: competencias.map(c => data[c].reinf_obrig || 0),
            backgroundColor: '#3B82F6'
        },
        {
            label: 'REINF Dispensada',
            data: competencias.map(c => data[c].reinf_disp || 0),
            backgroundColor: '#93C5FD'
        },
        {
            label: 'EFD Obrigatória',
            data: competencias.map(c => data[c].efd_obrig || 0),
            backgroundColor: '#10B981'
        },
        {
            label: 'EFD Dispensada',
            data: competencias.map(c => data[c].efd_disp || 0),
            backgroundColor: '#6EE7B7'
        }
    ];

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: competencias,
            datasets: datasets
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            },
            scales: {
                x: { stacked: false },
                y: { stacked: false, beginAtZero: true }
            }
        }
    });
}

function renderChartDifal() {
    const ctx = document.getElementById('chart-difal');
    const data = allKpis.difal_por_tipo || {};
    
    const labels = Object.keys(data);
    const values = Object.values(data);
    
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels.map(l => l.replace('_', ' ').toUpperCase()),
            datasets: [{
                data: values,
                backgroundColor: ['#F59E0B', '#EF4444', '#8B5CF6']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function renderChartForaDas() {
    const ctx = document.getElementById('chart-fora-das');
    const data = allKpis.fora_das_por_tipo || {};
    
    const labels = Object.keys(data);
    const values = Object.values(data);
    
    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: ['#EC4899', '#8B5CF6', '#06B6D4']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function renderRankingResponsaveis() {
    const container = document.getElementById('ranking-responsaveis');
    const ranking = allKpis.produtividade?.ranking_por_responsavel || {};
    
    const sorted = Object.entries(ranking)
        .sort((a, b) => b[1].finalizados - a[1].finalizados)
        .slice(0, 5);
    
    if (sorted.length === 0) {
        container.innerHTML = '<p class="empty-state">Nenhum dado disponível</p>';
        return;
    }
    
    container.innerHTML = sorted.map(([resp, stats], idx) => `
        <div class="ranking-item">
            <span class="ranking-position">#${idx + 1}</span>
            <span class="ranking-name">${resp}</span>
            <span class="ranking-value">${stats.finalizados} (${Math.round(stats.tempo_medio)}d)</span>
        </div>
    `).join('');
}

// ===== OBRIGAÇÕES =====
function renderObrigacoes() {
    const tbody = document.getElementById('tbody-obrigacoes');
    
    // Popula competências no filtro
    const competencias = [...new Set(allEvents.map(e => e.competencia).filter(Boolean))].sort().reverse();
    const selectComp = document.getElementById('filter-competencia');
    selectComp.innerHTML = '<option value="">Todas Competências</option>' +
        competencias.map(c => `<option value="${c}">${c}</option>`).join('');
    
    renderObrigacoesTable(allEvents);
}

function renderObrigacoesTable(events) {
    const tbody = document.getElementById('tbody-obrigacoes');
    
    if (events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Nenhuma obrigação encontrada</td></tr>';
        return;
    }
    
    tbody.innerHTML = events.map(event => `
        <tr>
            <td>${event.proc_id}</td>
            <td>${event.empresa || '-'}</td>
            <td>${event.cnpj || '-'}</td>
            <td>${getCategoryBadge(event.categoria)}</td>
            <td>${event.subtipo || '-'}</td>
            <td>${getStatusBadge(event.status)}</td>
            <td>${event.responsavel || '-'}</td>
            <td>${event.competencia || '-'}</td>
            <td>${formatDate(event.data_evento)}</td>
            <td>${getSourceBadge(event.source)}</td>
        </tr>
    `).join('');
}

function applyFilters() {
    const categoria = document.getElementById('filter-categoria').value;
    const status = document.getElementById('filter-status').value;
    const competencia = document.getElementById('filter-competencia').value;
    const empresa = document.getElementById('filter-empresa').value.toLowerCase();
    
    const filtered = allEvents.filter(event => {
        if (categoria && event.categoria !== categoria) return false;
        if (status && event.status !== status) return false;
        if (competencia && event.competencia !== competencia) return false;
        if (empresa && !event.empresa?.toLowerCase().includes(empresa)) return false;
        return true;
    });
    
    renderObrigacoesTable(filtered);
}

// ===== PROCESSOS =====
function renderProcessos() {
    const tbody = document.getElementById('tbody-processos');
    const finalizados = allProcesses.filter(p => p.conclusao);
    
    if (finalizados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Nenhum processo finalizado</td></tr>';
        return;
    }
    
    tbody.innerHTML = finalizados.map(proc => `
        <tr>
            <td>${proc.proc_id}</td>
            <td>${proc.empresa || '-'}</td>
            <td>${proc.cnpj || '-'}</td>
            <td>${proc.competencia || '-'}</td>
            <td>${formatDate(proc.inicio)}</td>
            <td>${formatDate(proc.conclusao)}</td>
            <td>${proc.dias_corridos || '-'}</td>
            <td>${proc.responsavel_final || '-'}</td>
            <td><span class="badge badge-success">Concluído</span></td>
        </tr>
    `).join('');
}

// ===== ALERTAS =====
function renderAlertas() {
    renderAlertasSN();
    renderAlertasReinf();
    renderAlertasBloqueantes();
    renderAlertasDivergencias();
    renderAlertasNaoMapeados();
}

function renderAlertasSN() {
    const container = document.getElementById('alertas-sn');
    const alertas = allAlerts.sn_em_risco || [];
    
    if (alertas.length === 0) {
        container.innerHTML = '<p class="text-green-600">✓ Nenhum alerta de Simples Nacional</p>';
        return;
    }
    
    container.innerHTML = alertas.map(a => `
        <div class="alert-item warning">
            <strong>Proc ${a.proc_id}</strong> - ${a.empresa}<br>
            Competência: ${a.competencia} | Prazo: ${formatDate(a.prazo)} | 
            <span class="font-bold">Faltam ${a.dias_para_prazo} dias</span>
        </div>
    `).join('');
}

function renderAlertasReinf() {
    const container = document.getElementById('alertas-reinf');
    const alertas = allAlerts.reinf_em_risco || [];
    
    if (alertas.length === 0) {
        container.innerHTML = '<p class="text-green-600">✓ Nenhum alerta de REINF</p>';
        return;
    }
    
    container.innerHTML = alertas.map(a => `
        <div class="alert-item warning">
            <strong>Proc ${a.proc_id}</strong> - ${a.empresa}<br>
            Competência: ${a.competencia} | Prazo: ${formatDate(a.prazo)} | 
            <span class="font-bold">Faltam ${a.dias_para_prazo} dias</span>
        </div>
    `).join('');
}

function renderAlertasBloqueantes() {
    const container = document.getElementById('alertas-bloqueantes');
    const alertas = allAlerts.bloqueantes || [];
    
    if (alertas.length === 0) {
        container.innerHTML = '<p class="text-green-600">✓ Nenhum passo bloqueante</p>';
        return;
    }
    
    container.innerHTML = alertas.map(a => `
        <div class="alert-item danger">
            <strong>Proc ${a.proc_id}</strong><br>
            Passo: ${a.passo} | Responsável: ${a.responsavel || '-'} | 
            Prazo: ${formatDate(a.prazo) || '-'}
        </div>
    `).join('');
}

function renderAlertasDivergencias() {
    const container = document.getElementById('alertas-divergencias');
    const alertas = allAlerts.divergencias || [];
    
    if (alertas.length === 0) {
        container.innerHTML = '<p class="text-green-600">✓ Nenhuma divergência</p>';
        return;
    }
    
    container.innerHTML = alertas.map(a => `
        <div class="alert-item">
            <strong>Proc ${a.proc_id}</strong><br>
            Categoria: ${a.categoria} ${a.subtipo ? `(${a.subtipo})` : ''}<br>
            API: <span class="badge badge-info">${a.api_status}</span> | 
            E-mail: <span class="badge badge-warning">${a.email_status}</span>
        </div>
    `).join('');
}

function renderAlertasNaoMapeados() {
    const container = document.getElementById('alertas-nao-mapeados');
    const alertas = allAlerts.nao_mapeados_api || [];
    
    if (alertas.length === 0) {
        container.innerHTML = '<p class="text-green-600">✓ Todos eventos mapeados</p>';
        return;
    }
    
    container.innerHTML = alertas.map(a => `
        <div class="alert-item">
            <strong>Proc ${a.proc_id}</strong><br>
            ${a.detalhe}<br>
            Categoria: ${a.categoria} ${a.subtipo ? `(${a.subtipo})` : ''}
        </div>
    `).join('');
}

// ===== EMPRESAS =====
function populateEmpresaSelect() {
    const select = document.getElementById('select-empresa');
    const empresas = [...new Set(allProcesses.map(p => p.empresa).filter(Boolean))].sort();
    
    select.innerHTML = '<option value="">Escolha uma empresa...</option>' +
        empresas.map(e => `<option value="${e}">${e}</option>`).join('');
}

function loadEmpresaDetail() {
    const empresaNome = document.getElementById('select-empresa').value;
    
    if (!empresaNome) {
        document.getElementById('empresa-detail').classList.add('hidden');
        return;
    }
    
    document.getElementById('empresa-detail').classList.remove('hidden');
    
    // Info da empresa
    const proc = allProcesses.find(p => p.empresa === empresaNome);
    document.getElementById('empresa-nome').textContent = empresaNome;
    document.getElementById('empresa-cnpj').textContent = `CNPJ: ${proc?.cnpj || '-'}`;
    
    // Timeline
    const eventos = allEvents.filter(e => e.empresa === empresaNome)
        .sort((a, b) => (b.data_evento || '').localeCompare(a.data_evento || ''));
    
    const timeline = document.getElementById('empresa-timeline');
    
    if (eventos.length === 0) {
        timeline.innerHTML = '<p class="empty-state">Nenhum evento encontrado</p>';
        return;
    }
    
    timeline.innerHTML = eventos.map(e => `
        <div class="timeline-item">
            <div class="text-sm text-gray-500">${formatDate(e.data_evento)}</div>
            <div class="font-semibold">${getCategoryName(e.categoria)}</div>
            <div class="text-sm">
                ${e.subtipo ? `${e.subtipo} - ` : ''}
                ${getStatusBadge(e.status)}
            </div>
            ${e.responsavel ? `<div class="text-sm text-gray-600">Resp: ${e.responsavel}</div>` : ''}
        </div>
    `).join('');
}

// ===== EXPORTAR CSV =====
function exportCSV(type) {
    let data, filename, headers;
    
    if (type === 'obrigacoes') {
        data = allEvents;
        filename = 'obrigacoes.csv';
        headers = ['proc_id', 'empresa', 'cnpj', 'categoria', 'subtipo', 'status', 
                   'responsavel', 'competencia', 'data_evento', 'source'];
    } else if (type === 'processos') {
        data = allProcesses.filter(p => p.conclusao);
        filename = 'processos_finalizados.csv';
        headers = ['proc_id', 'empresa', 'cnpj', 'competencia', 'inicio', 'conclusao', 
                   'dias_corridos', 'responsavel_final', 'status'];
    }
    
    const csv = [
        headers.join(','),
        ...data.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

// ===== FUNÇÕES AUXILIARES =====
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR');
}

function getCategoryBadge(cat) {
    const names = {
        'efd_reinf': 'EFD-Reinf',
        'efd_contrib': 'EFD Contrib',
        'difal': 'DIFAL',
        'fora_das': 'Fora do DAS',
        'finalizacao': 'Finalização'
    };
    return `<span class="badge badge-info">${names[cat] || cat}</span>`;
}

function getCategoryName(cat) {
    const names = {
        'efd_reinf': 'EFD-Reinf',
        'efd_contrib': 'EFD Contribuições',
        'difal': 'DIFAL',
        'fora_das': 'Fora do DAS',
        'finalizacao': 'Finalização'
    };
    return names[cat] || cat;
}

function getStatusBadge(status) {
    if (!status) return '-';
    
    const classes = {
        'Obrigatória': 'badge-danger',
        'Dispensada': 'badge-success',
        'Finalizado': 'badge-success',
        'OK': 'badge-success'
    };
    
    const cls = classes[status] || 'badge-secondary';
    return `<span class="badge ${cls}">${status}</span>`;
}

function getSourceBadge(source) {
    return source === 'api' 
        ? '<span class="badge badge-info">API</span>'
        : '<span class="badge badge-warning">Email</span>';
}

function updateLastUpdate() {
    const now = new Date().toLocaleString('pt-BR');
    document.getElementById('last-update').textContent = now;
}
