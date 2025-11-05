// Configuração da API
const API_BASE_URL = '/api';

// Funções auxiliares
function showLoading() {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.id = 'loadingOverlay';
    overlay.innerHTML = '<div class="spinner-border text-light loading-spinner" role="status"></div>';
    document.body.appendChild(overlay);
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.remove();
    }
}

function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3`;
    alertDiv.style.zIndex = '10000';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(alertDiv);

    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// API de Sincronização
const syncAPI = {
    async sincronizar(payload = {}) {
        const response = await fetch(`${API_BASE_URL}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error('Erro ao iniciar sincronização');
        return await response.json();
    },

    async meta() {
        const response = await fetch(`${API_BASE_URL}/meta`);
        if (!response.ok) throw new Error('Erro ao buscar meta de sincronização');
        return await response.json();
    }
};

// API de Empresas
const empresasAPI = {
    async listar(filtros = {}) {
        const params = new URLSearchParams(filtros);
        const response = await fetch(`${API_BASE_URL}/empresas?${params}`); // Rota em PT
        if (!response.ok) throw new Error('Erro ao listar empresas');
        return await response.json();
    },

    async buscar(id) {
        const response = await fetch(`${API_BASE_URL}/empresas/${id}`); // Rota em PT
        if (!response.ok) throw new Error('Erro ao buscar empresa');
        return await response.json();
    },

    async criar(dados) {
        const response = await fetch(`${API_BASE_URL}/empresas`, { // Rota em PT
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados),
        });
        if (!response.ok) throw new Error('Erro ao criar empresa');
        return await response.json();
    },

    async atualizar(id, dados) {
        const response = await fetch(`${API_BASE_URL}/empresas/${id}`, { // Rota em PT
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados),
        });
        if (!response.ok) throw new Error('Erro ao atualizar empresa');
        return await response.json();
    },

    async desativar(id) {
        const response = await fetch(`${API_BASE_URL}/empresas/${id}`, { // Rota em PT
            method: 'DELETE',
        });
        if (!response.ok) throw new Error('Erro ao desativar empresa');
        return await response.json();
    },

    async stats(id) {
        const response = await fetch(`${API_BASE_URL}/empresas/${id}/stats`); // Rota em PT
        if (!response.ok) throw new Error('Erro ao buscar estatísticas');
        return await response.json();
    },
};

// API de Processos (Adicionada)
const processosAPI = {
    async listar(filtros = {}) {
        const params = new URLSearchParams(filtros);
        const response = await fetch(`${API_BASE_URL}/processos?${params}`); // Rota em PT
        if (!response.ok) throw new Error('Erro ao listar processos');
        return await response.json();
    },
};

// API de Entregas (Adicionada)
const entregasAPI = {
    async listar(filtros = {}) {
        const params = new URLSearchParams(filtros);
        const response = await fetch(`${API_BASE_URL}/entregas?${params}`); // Rota em PT
        if (!response.ok) throw new Error('Erro ao listar entregas');
        return await response.json();
    },
};

// API de Etapas (Adicionada)
const etapasAPI = {
    async listar(filtros = {}) {
        const params = new URLSearchParams(filtros);
        const response = await fetch(`${API_BASE_URL}/etapas?${params}`); // Rota em PT
        if (!response.ok) throw new Error('Erro ao listar etapas');
        return await response.json();
    },
};

// API de Dashboard
const dashboardAPI = {
    async geral() {
        const response = await fetch(`${API_BASE_URL}/dashboard`); // Rota em PT
        if (!response.ok) throw new Error('Erro ao carregar dashboard');
        return await response.json();
    },
    async proximosVencimentos() {
        // Rota não definida no backend, mas mantida para compatibilidade com main.js
        const response = await fetch(`${API_BASE_URL}/dashboard/proximos-vencimentos`);
        if (!response.ok) throw new Error('Erro ao carregar próximos vencimentos');
        return await response.json();
    }
};

// Exportando as APIs necessárias
window.syncAPI = syncAPI;
window.empresasAPI = empresasAPI;
window.processosAPI = processosAPI;
window.entregasAPI = entregasAPI;
window.etapasAPI = etapasAPI;
window.dashboardAPI = dashboardAPI;
window.showAlert = showAlert;
window.showLoading = showLoading;
window.hideLoading = hideLoading;

// Removendo APIs não utilizadas ou que não foram corrigidas (Competências, Obrigações, Problemas)
// Se o front precisar delas, o backend precisará ser ajustado para as rotas em PT.
// Por enquanto, focamos nas rotas que foram corrigidas no backend (empresas, processos, entregas, etapas, sync, meta, dashboard).
