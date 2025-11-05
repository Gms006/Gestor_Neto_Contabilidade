const API = {
  async resumo() {
    const res = await fetch("/api/dashboard");
    if (!res.ok) throw new Error('Erro ao carregar resumo');
    return res.json();
  },
  async obrigacoesEmRisco() {
    // Rota não implementada no backend corrigido, usando placeholder
    return { rows: [] };
  },
  async obrigacoesEmCimaPrazo() {
    // Rota não implementada no backend corrigido, usando placeholder
    return { rows: [] };
  },
  async problemasPareto() {
    // Rota não implementada no backend corrigido, usando placeholder
    return [];
  },
  async conversasRecentes() {
    // Rota não implementada no backend corrigido, usando placeholder
    return [];
  },
};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Adiciona listener para o botão de sincronização
    const syncButton = document.getElementById('btnSync');
    if (syncButton) {
        syncButton.addEventListener('click', iniciarSincronizacao);
    }

    await carregarResumo();
    await Promise.all([
      preencherTabela('tabelaRisco', await API.obrigacoesEmRisco()),
      preencherTabela('tabelaCimaPrazo', await API.obrigacoesEmCimaPrazo()),
      preencherProblemas(await API.problemasPareto()),
      preencherConversas(await API.conversasRecentes()),
    ]);
    document.getElementById('dadosAtualizados').textContent = `Atualizado em ${new Date().toLocaleString('pt-BR')}`;
  } catch (error) {
    console.error(error);
  }
});

// Função de Sincronização (copiada de main.js)
async function iniciarSincronizacao() {
    try {
        showLoading();
        showAlert('Iniciando sincronização com a API Acessórias...', 'info');
        
        // POST /api/sync
        const result = await syncAPI.sincronizar({ full: false }); // Sincronização incremental
        
        showAlert(`Sincronização concluída! Empresas: ${result.companies}, Processos: ${result.processes}, Entregas: ${result.deliveries}`, 'success');
        
        // Recarregar dados após a sincronização
        await carregarResumo();
        await Promise.all([
            preencherTabela('tabelaRisco', await API.obrigacoesEmRisco()),
            preencherTabela('tabelaCimaPrazo', await API.obrigacoesEmCimaPrazo()),
            preencherProblemas(await API.problemasPareto()),
            preencherConversas(await API.conversasRecentes()),
        ]);
        document.getElementById('dadosAtualizados').textContent = `Atualizado em ${new Date().toLocaleString('pt-BR')}`;

    } catch (error) {
        console.error('Erro ao sincronizar:', error);
        showAlert('Erro ao sincronizar dados. Verifique o console para detalhes.', 'danger');
    } finally {
        hideLoading();
    }
}

async function carregarResumo() {
  const dados = await API.resumo();
  // Ajuste para lidar com o placeholder do dashboard
  const empresasAtivas = dados.dashboard?.empresas?.ativas ?? 0;
  const competenciasEmAndamento = dados.dashboard?.competencias?.emAndamento ?? 0;
  const obrigacoesEmRisco = dados.dashboard?.obrigacoes?.emRisco ?? 0;
  const problemasAbertos = dados.dashboard?.problemas?.abertos ?? 0;

  const cards = [
    {
      titulo: 'Empresas ativas',
      valor: empresasAtivas,
      icone: 'bi-buildings',
      classe: 'bg-primary text-white',
    },
    {
      titulo: 'Competências em andamento',
      valor: competenciasEmAndamento,
      icone: 'bi-hourglass-split',
      classe: 'bg-warning',
    },
    {
      titulo: 'Obrigações em risco',
      valor: obrigacoesEmRisco,
      icone: 'bi-exclamation-triangle',
      classe: 'bg-danger text-white',
    },
    {
      titulo: 'Problemas abertos',
      valor: problemasAbertos,
      icone: 'bi-bug',
      classe: 'bg-secondary text-white',
    },
  ];

  const container = document.getElementById('cardsResumo');
  container.innerHTML = cards
    .map(
      (card) => `
        <div class="col-md-3">
          <div class="card ${card.classe} shadow-sm">
            <div class="card-body text-center">
              <i class="bi ${card.icone} fs-2"></i>
              <h3 class="mt-2 mb-1">${card.valor}</h3>
              <p class="mb-0">${card.titulo}</p>
            </div>
          </div>
        </div>
      `
    )
    .join('');
}

function preencherTabela(elementId, result) {
  const obrigacoes = result.rows || [];
  const tbody = document.getElementById(elementId);
  if (!obrigacoes.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Nenhum registro encontrado</td></tr>`;
    return;
  }

  tbody.innerHTML = obrigacoes
    .map((ob) => {
      const empresa = ob.competencia?.empresa?.razaoSocial || 'Empresa';
      const regime = ob.competencia?.empresa?.regime || '-';
      const vencimento = new Date(ob.vencimentoFinal).toLocaleDateString('pt-BR');
      const dias = ob.diasParaVenc ?? '-';
      return `
        <tr>
          <td>${empresa}</td>
          <td>${regime}</td>
          <td>${ob.tipo}</td>
          <td>${vencimento}</td>
          <td>${dias}</td>
          <td>${ob.status}</td>
        </tr>
      `;
    })
    .join('');
}

function preencherProblemas(problemas) {
  const tbody = document.getElementById('tabelaProblemas');
  if (!problemas.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">Nenhum problema registrado</td></tr>`;
    return;
  }

  tbody.innerHTML = problemas
    .map((p) => `
      <tr>
        <td>${p.tipo}</td>
        <td>${p._count.tipo}</td>
      </tr>
    `)
    .join('');
}

function preencherConversas(conversas) {
  const tbody = document.getElementById('tabelaConversas');
  if (!conversas.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Nenhuma conversa registrada</td></tr>`;
    return;
  }

  tbody.innerHTML = conversas
    .map((item) => {
      const log = item.ultimaMensagem;
      let preview = log.payload;
      try {
        const parsed = JSON.parse(log.payload);
        preview = JSON.stringify(parsed);
      } catch (error) {
        preview = log.payload;
      }
      const resumo = preview.slice(0, 80);
      const data = new Date(log.createdAt).toLocaleString('pt-BR');
      return `
        <tr>
          <td>${item.phone}</td>
          <td>${log.direction}</td>
          <td><code>${resumo}...</code></td>
          <td>${data}</td>
        </tr>
      `;
    })
    .join('');
}
