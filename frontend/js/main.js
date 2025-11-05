// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    carregarDashboard();
    carregarCompetenciasPendentes();
    carregarProximosVencimentos();
    verificarUsuarioLogado();

    // Adiciona listener para o botão de sincronização
    const syncButton = document.getElementById('btnSync');
    if (syncButton) {
        syncButton.addEventListener('click', iniciarSincronizacao);
    }
});

// Verificar usuário logado
function verificarUsuarioLogado() {
    const usuario = localStorage.getItem('usuario');
    if (usuario) {
        const usuarioObj = JSON.parse(usuario);
        document.getElementById('usuarioNome').textContent = usuarioObj.nome;
    } else {
        document.getElementById('usuarioNome').textContent = 'Visitante';
    }
}

// Função de Sincronização
async function iniciarSincronizacao() {
    try {
        showLoading();
        showAlert('Iniciando sincronização com a API Acessórias...', 'info');
        
        // POST /api/sync
        const result = await syncAPI.sincronizar({ full: false }); // Sincronização incremental
        
        showAlert(`Sincronização concluída! Empresas: ${result.companies}, Processos: ${result.processes}, Entregas: ${result.deliveries}`, 'success');
        
        // Recarregar dados após a sincronização
        await carregarDashboard();
        await carregarCompetenciasPendentes();
        await carregarProximosVencimentos();

    } catch (error) {
        console.error('Erro ao sincronizar:', error);
        showAlert('Erro ao sincronizar dados. Verifique o console para detalhes.', 'danger');
    } finally {
        hideLoading();
    }
}

// Carregar dashboard
async function carregarDashboard() {
    try {
        // Usando a rota /api/dashboard corrigida no backend
        const dados = await dashboardAPI.geral();

        // Estes IDs podem precisar de ajuste dependendo do HTML, mas seguindo o padrão
        document.getElementById('totalEmpresas').textContent = dados.empresas?.ativas ?? 'N/A';
        document.getElementById('competenciasAndamento').textContent = dados.competencias?.emAndamento ?? 'N/A';
        document.getElementById('obrigacoesRisco').textContent = dados.obrigacoes?.emRisco ?? 'N/A';
        document.getElementById('competenciasConcluidas').textContent = dados.competencias?.concluidas ?? 'N/A';
    } catch (error) {
        console.error('Erro ao carregar dashboard:', error);
        showAlert('Erro ao carregar dados do dashboard', 'danger');
    }
}

// Carregar competências pendentes (Ajustado para usar a rota /api/processos)
async function carregarCompetenciasPendentes() {
    try {
        // Assumindo que "competências pendentes" são "processos em andamento"
        const processos = await processosAPI.listar({ status: 'Em andamento' }); // Filtro de status
        const tbody = document.getElementById('tabelaPendentes');

        if (processos.rows.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted">
                        <i class="bi bi-check-circle fs-1"></i><br>
                        Nenhum processo pendente
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = processos.rows.map(proc => {
            const proximaEtapa = proc.etapas[0] || { nome: 'Nenhuma' };
            return `
                <tr onclick="abrirProcesso('${proc.id}')">
                    <td>
                        <strong>${proc.empresa.nomeFantasia || proc.empresa.nome}</strong><br>
                        <small class="text-muted">${proc.empresa.cnpj}</small>
                    </td>
                    <td><span class="badge bg-primary">${proc.departamento || 'Geral'}</span></td>
                    <td>${proc.titulo}</td>
                    <td>${getStatusBadge(proc.status)}</td>
                    <td>${proximaEtapa.nome}</td>
                    <td>
                        <button class="btn btn-sm btn-success" onclick="event.stopPropagation(); abrirProcesso('${proc.id}')">
                            <i class="bi bi-eye"></i> Ver
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Erro ao carregar pendentes:', error);
        document.getElementById('tabelaPendentes').innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-danger">
                    Erro ao carregar processos pendentes
                </td>
            </tr>
        `;
    }
}

// Carregar próximos vencimentos (Ajustado para usar a rota /api/entregas)
async function carregarProximosVencimentos() {
    try {
        // Assumindo que "próximos vencimentos" são "entregas"
        const entregas = await entregasAPI.listar({ orderBy: 'dataEvento', order: 'asc' }); // Filtro de ordenação
        const tbody = document.getElementById('tabelaVencimentos');

        if (entregas.rows.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center text-muted">
                        <i class="bi bi-check-circle fs-1"></i><br>
                        Nenhuma entrega próxima
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = entregas.rows.map(ent => {
            const dataEvento = new Date(ent.dataEvento);
            const hoje = new Date();
            const diffTime = Math.abs(dataEvento.getTime() - hoje.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            const diasClass = diffDays <= 1 ? 'text-danger fw-bold' : 
                              diffDays <= 3 ? 'text-warning fw-bold' : '';
            
            return `
                <tr>
                    <td>
                        <strong>${ent.empresa.nomeFantasia || ent.empresa.nome}</strong><br>
                        <small class="text-muted">${ent.competencia}</small>
                    </td>
                    <td>${ent.tipo}</td>
                    <td><span class="badge bg-info">${ent.situacao}</span></td>
                    <td>${dataEvento.toLocaleDateString('pt-BR')}</td>
                    <td class="${diasClass}">${diffDays} dias</td>
                    <td>${getStatusBadge(ent.situacao)}</td>
                    <td>${ent.gestor || '-'}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Erro ao carregar vencimentos:', error);
        document.getElementById('tabelaVencimentos').innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-danger">
                    Erro ao carregar entregas
                </td>
            </tr>
        `;
    }
}

// Funções auxiliares (manter)
function getStatusBadge(status) {
    let badgeClass = 'bg-secondary';
    if (status && typeof status === 'string') {
        const lowerStatus = status.toLowerCase();
        if (lowerStatus.includes('concluído') || lowerStatus.includes('pago') || lowerStatus.includes('ok')) {
            badgeClass = 'bg-success';
        } else if (lowerStatus.includes('andamento') || lowerStatus.includes('pendente')) {
            badgeClass = 'bg-warning text-dark';
        } else if (lowerStatus.includes('atraso') || lowerStatus.includes('risco')) {
            badgeClass = 'bg-danger';
        }
    }
    return `<span class="badge ${badgeClass}">${status || 'N/A'}</span>`;
}

function formatarData(dataISO) {
    if (!dataISO) return '-';
    return new Date(dataISO).toLocaleDateString('pt-BR');
}

// Ações rápidas (manter)
function novaEmpresa() {
    window.location.href = 'empresas.html?acao=nova';
}

function novaCompetencia() {
    window.location.href = 'competencias.html?acao=nova';
}

function retomarPendentes() {
    window.location.href = 'competencias.html?filtro=pendentes';
}

function verRelatorios() {
    window.location.href = 'relatorios.html';
}

// Abrir processo (substitui abrirCompetencia)
function abrirProcesso(id) {
    window.location.href = `processo-detalhes.html?id=${id}`;
}

// Retomar processo (substitui retomarCompetencia)
async function retomarProcesso(id) {
    // Ação de retomar não está clara no novo contexto, mantendo apenas a navegação
    abrirProcesso(id);
}

// Atualizar dados periodicamente
setInterval(() => {
    carregarDashboard();
    carregarCompetenciasPendentes();
    carregarProximosVencimentos();
}, 60000); // Atualizar a cada 1 minuto
