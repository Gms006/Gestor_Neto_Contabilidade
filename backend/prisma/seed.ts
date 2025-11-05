import { PrismaClient } from '@prisma/client';
import feriadosData from '../../data/feriados-nacionais.json';
import { gerarObrigacoesSN, gerarObrigacoesPresumido } from '../src/services/obrigacoes.service';

const prisma = new PrismaClient();

async function limparBanco() {
  await prisma.mensagemLog.deleteMany();
  await prisma.conversa.deleteMany();
  await prisma.acaoLog.deleteMany();
  await prisma.timer.deleteMany();
  await prisma.problema.deleteMany();
  await prisma.obrigacao.deleteMany();
  await prisma.etapa.deleteMany();
  await prisma.competencia.deleteMany();
  await prisma.usuarioEmpresa.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.empresa.deleteMany();
  await prisma.feriadoNacional.deleteMany();
  await prisma.feriado.deleteMany();
  await prisma.configuracao.deleteMany();
}

async function criarUsuarios() {
  const admin = await prisma.usuario.create({
    data: {
      nome: 'Administrador',
      email: 'admin@gestaocontabil.test',
      senha: 'admin123',
      papel: 'Admin',
      ativo: true,
      telefone: '+550000000000',
    },
  });

  const preparador = await prisma.usuario.create({
    data: {
      nome: 'Paula Preparadora',
      email: 'preparador@testers.cloud',
      senha: 'senha123',
      papel: 'Preparador',
      ativo: true,
      telefone: '+5511999990001',
    },
  });

  const entregador = await prisma.usuario.create({
    data: {
      nome: 'Edu Entregador',
      email: 'entregador@testers.cloud',
      senha: 'senha123',
      papel: 'Entregador',
      ativo: true,
      telefone: '+5511999990002',
    },
  });

  const gestor = await prisma.usuario.create({
    data: {
      nome: 'Gi Gestora',
      email: 'gestor@testers.cloud',
      senha: 'senha123',
      papel: 'Gestor',
      ativo: true,
      telefone: '+5511999990003',
    },
  });

  return { admin, preparador, entregador, gestor };
}

async function criarEmpresas() {
  const empresaSN = await prisma.empresa.create({
    data: {
      cnpj: '12.345.678/0001-90',
      razaoSocial: 'Mercadinho Bom Preço Ltda',
      nomeFantasia: 'Mercadinho Bom Preço',
      regime: 'SN',
      segmento: 'Comercio',
      uf: 'SP',
      municipio: 'São Paulo',
      ativo: true,
    },
  });

  const empresaLP = await prisma.empresa.create({
    data: {
      cnpj: '98.765.432/0001-10',
      razaoSocial: 'Comercial Presumida S.A.',
      nomeFantasia: 'Comercial Presumida',
      regime: 'LP',
      segmento: 'Comercio',
      uf: 'MG',
      municipio: 'Belo Horizonte',
      ativo: true,
      periodicidadeIrpjCsll: 'Trimestral',
    },
  });

  return { empresaSN, empresaLP };
}

async function criarRelacoesUsuariosEmpresas(
  usuarios: Awaited<ReturnType<typeof criarUsuarios>>,
  empresas: Awaited<ReturnType<typeof criarEmpresas>>
) {
  await prisma.usuarioEmpresa.createMany({
    data: [
      { usuarioId: usuarios.preparador.id, empresaId: empresas.empresaSN.id, papel: 'Preparador' },
      { usuarioId: usuarios.preparador.id, empresaId: empresas.empresaLP.id, papel: 'Preparador' },
      { usuarioId: usuarios.entregador.id, empresaId: empresas.empresaSN.id, papel: 'Entregador' },
      { usuarioId: usuarios.entregador.id, empresaId: empresas.empresaLP.id, papel: 'Entregador' },
      { usuarioId: usuarios.gestor.id, empresaId: empresas.empresaSN.id, papel: 'Gestor' },
      { usuarioId: usuarios.gestor.id, empresaId: empresas.empresaLP.id, papel: 'Gestor' },
    ],
  });
}

async function criarCompetencias(empresas: Awaited<ReturnType<typeof criarEmpresas>>) {
  const competencias = await prisma.$transaction([
    prisma.competencia.create({
      data: {
        empresaId: empresas.empresaSN.id,
        mesAno: '2025-02',
        status: 'Em Andamento',
        dataInicio: new Date('2025-03-01'),
        houveMovimento: true,
      },
    }),
    prisma.competencia.create({
      data: {
        empresaId: empresas.empresaSN.id,
        mesAno: '2025-01',
        status: 'Concluido',
        dataInicio: new Date('2025-02-01'),
        dataConclusao: new Date('2025-02-20'),
        tempoTotalMin: 210,
        houveMovimento: true,
      },
    }),
    prisma.competencia.create({
      data: {
        empresaId: empresas.empresaLP.id,
        mesAno: '2025-02',
        status: 'Em Andamento',
        dataInicio: new Date('2025-03-01'),
        houveMovimento: true,
      },
    }),
  ]);

  return {
    competenciaSnAtual: competencias[0],
    competenciaSnAnterior: competencias[1],
    competenciaLpAtual: competencias[2],
  };
}

async function criarEtapas(competencias: Awaited<ReturnType<typeof criarCompetencias>>) {
  await prisma.etapa.createMany({
    data: [
      {
        competenciaId: competencias.competenciaSnAtual.id,
        nome: 'Captura Empresa',
        tipo: 'Manual',
        ordem: 1,
        status: 'Concluido',
        duracaoMin: 10,
        manualFlag: true,
      },
      {
        competenciaId: competencias.competenciaSnAtual.id,
        nome: 'Download NFs - Jettax',
        sistema: 'Jettax',
        tipo: 'Sistema',
        ordem: 2,
        status: 'Em Andamento',
        duracaoMin: 30,
      },
      {
        competenciaId: competencias.competenciaLpAtual.id,
        nome: 'Coleta/Importação',
        sistema: 'Domínio',
        tipo: 'Sistema',
        ordem: 1,
        status: 'Em Andamento',
        duracaoMin: 40,
        manualFlag: false,
      },
    ],
  });
}

async function criarObrigacoes(
  empresas: Awaited<ReturnType<typeof criarEmpresas>>,
  competencias: Awaited<ReturnType<typeof criarCompetencias>>,
  usuarios: Awaited<ReturnType<typeof criarUsuarios>>
) {
  await gerarObrigacoesSN({
    empresaId: empresas.empresaSN.id,
    competenciaId: competencias.competenciaSnAtual.id,
    mesAno: competencias.competenciaSnAtual.mesAno,
    houveMovimento: true,
    houveCompraInterestadual: true,
    difalTipo: 'comercializacao',
    justificativas: ['Compra interestadual para revenda'],
  });

  await gerarObrigacoesPresumido({
    empresaId: empresas.empresaLP.id,
    competenciaId: competencias.competenciaLpAtual.id,
    mesAno: competencias.competenciaLpAtual.mesAno,
    pisCofinsDebito: false,
    pisCofinsMotivo: 'Isenção específica do regime',
    icmsDevido: true,
    icmsGuiaGerada: false,
    icmsJustificativa: 'Guia aguardando aprovação do cliente',
    difalUso: 'consumo',
    reinf: true,
    distribuicaoLucros: { houve: true, valor: 12500 },
    temFolha: false,
    faturouMesAnterior: true,
    periodicidadeIrpjCsll: 'Trimestral',
  });

  const obrigacoes = await prisma.obrigacao.findMany({
    where: {
      competenciaId: { in: [competencias.competenciaSnAtual.id, competencias.competenciaLpAtual.id] },
    },
  });

  for (const obrigacao of obrigacoes) {
    await prisma.obrigacao.update({
      where: { id: obrigacao.id },
      data: {
        preparadorId: usuarios.preparador.id,
        entregadorId: usuarios.entregador.id,
      },
    });
  }
}

async function criarProblemas(competencias: Awaited<ReturnType<typeof criarCompetencias>>, empresas: Awaited<ReturnType<typeof criarEmpresas>>) {
  await prisma.problema.createMany({
    data: [
      {
        empresaId: empresas.empresaSN.id,
        competenciaId: competencias.competenciaSnAtual.id,
        local: 'Domínio',
        tipo: 'Sistema',
        categoria: 'Lentidão',
        descricao: 'Domínio instável durante importação de notas.',
        impacto: 'Medio',
        status: 'Aberto',
        tempoEsperaMin: 45,
      },
      {
        empresaId: empresas.empresaLP.id,
        competenciaId: competencias.competenciaLpAtual.id,
        local: 'Cliente',
        tipo: 'Processo',
        categoria: 'Documentação',
        descricao: 'Cliente atrasou envio da guia de ICMS assinada.',
        impacto: 'Alto',
        status: 'Em Analise',
        tempoTotalMin: 120,
      },
    ],
  });
}

async function criarFeriados() {
  const anoBase = new Date().getFullYear();
  const feriadosFixos = (feriadosData.feriadosNacionais || [])
    .filter((feriado) => feriado.data && feriado.data !== 'variavel')
    .map((feriado) => {
      const [mes, dia] = (feriado.data as string).split('-');
      return {
        data: new Date(Date.UTC(anoBase, Number(mes) - 1, Number(dia))),
        nome: feriado.nome as string,
      };
    });

  if (feriadosFixos.length) {
    await prisma.feriadoNacional.createMany({ data: feriadosFixos });
  }
}

async function criarConfiguracoes() {
  await prisma.configuracao.createMany({
    data: [
      { chave: 'APP_NOME', valor: 'Gestão Contábil Bot', descricao: 'Nome da aplicação' },
      { chave: 'LEMBRETES_WHATSAPP', valor: 'true', descricao: 'Habilita lembretes via WhatsApp' },
    ],
  });
}

async function criarConversasExemplo(
  usuarios: Awaited<ReturnType<typeof criarUsuarios>>,
  empresas: Awaited<ReturnType<typeof criarEmpresas>>,
  competencias: Awaited<ReturnType<typeof criarCompetencias>>
) {
  const estadoSn = {
    stage: 'SN_CONCLUSAO',
    fluxo: 'SN',
    data: {
      sn: {
        empresaId: empresas.empresaSN.id,
        competenciaId: competencias.competenciaSnAtual.id,
        mesAno: competencias.competenciaSnAtual.mesAno,
        houveMovimento: true,
        houveDifal: true,
        difalTipo: 'comercializacao',
      },
    },
    history: ['CAPTURAR_EMPRESA', 'SN_CAPTURAR_COMPETENCIA', 'SN_MOVIMENTO'],
    pending: null,
  };

  await prisma.conversa.create({
    data: {
      phone: usuarios.preparador.telefone!,
      empresaId: empresas.empresaSN.id,
      competenciaId: competencias.competenciaSnAtual.id,
      etapaAtual: 'SN_CONCLUSAO',
      estadoJson: JSON.stringify(estadoSn),
    },
  });
}

async function resumo() {
  console.log('\n📊 Resumo do seed:');
  console.log(`   - Usuários: ${await prisma.usuario.count()}`);
  console.log(`   - Empresas: ${await prisma.empresa.count()}`);
  console.log(`   - Competências: ${await prisma.competencia.count()}`);
  console.log(`   - Obrigações: ${await prisma.obrigacao.count()}`);
  console.log(`   - Problemas: ${await prisma.problema.count()}`);
  console.log(`   - Conversas: ${await prisma.conversa.count()}`);
  console.log(`   - Feriados nacionais: ${await prisma.feriadoNacional.count()}`);
}

async function main() {
  console.log('🌱 Iniciando seed do banco...');
  await limparBanco();

  const usuarios = await criarUsuarios();
  const empresas = await criarEmpresas();
  await criarRelacoesUsuariosEmpresas(usuarios, empresas);
  const competencias = await criarCompetencias(empresas);
  await criarEtapas(competencias);
  await criarObrigacoes(empresas, competencias, usuarios);
  await criarProblemas(competencias, empresas);
  await criarFeriados();
  await criarConfiguracoes();
  await criarConversasExemplo(usuarios, empresas, competencias);

  await resumo();
  console.log('✅ Seed concluído.');
}

main()
  .catch((error) => {
    console.error('❌ Erro no seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
