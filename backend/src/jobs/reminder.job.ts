import cron from 'node-cron';
import prisma from '../config/database';
import { DIAS_ALERTA, STATUS_OBRIGACAO } from '../config/constants';
import whatsappService from '../services/whatsapp.service';

// Função para verificar obrigações próximas do vencimento
async function verificarObrigacoesVencimento() {
  console.log('🔔 Verificando obrigações próximas do vencimento...');

  try {
    const hoje = new Date();

    // Atualizar dias para vencimento de todas as obrigações
    const obrigacoes = await prisma.obrigacao.findMany({
      where: {
        status: {
          notIn: ['Entregue', 'Comprovada'],
        },
      },
      include: {
        competencia: {
          include: {
            empresa: {
              select: { razaoSocial: true, nomeFantasia: true },
            },
          },
        },
        preparador: {
          select: { nome: true, email: true, telefone: true },
        },
        entregador: {
          select: { nome: true, email: true, telefone: true },
        },
      },
    });

    let alertasGerados = 0;

    for (const obrigacao of obrigacoes) {
      const diasParaVenc = Math.ceil(
        (obrigacao.vencimentoFinal.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Atualizar dias para vencimento
      const emRisco = diasParaVenc <= 3 &&
        !['Preparada', 'Entregue', 'Comprovada'].includes(obrigacao.status);
      const emCimaPrazo = diasParaVenc < 0;

      await prisma.obrigacao.update({
        where: { id: obrigacao.id },
        data: {
          diasParaVenc,
          emRisco,
          emCimaPrazo,
        },
      });

      // Gerar alertas para dias específicos
      if (DIAS_ALERTA.includes(diasParaVenc)) {
        const telefone = obrigacao.preparador?.telefone;
        if (telefone) {
          const mensagem =
            `Lembrete: ${obrigacao.tipo} da ${obrigacao.competencia.empresa.razaoSocial} ` +
            `vence em ${diasParaVenc} dia(s). Status atual: ${obrigacao.status}.`;
          try {
            await whatsappService.sendText(telefone, mensagem, `reminder-${obrigacao.id}-${diasParaVenc}`);
            alertasGerados++;
          } catch (error) {
            console.error('Erro ao enviar lembrete WhatsApp:', error);
          }
        }
      }

      // Alerta crítico para vencimentos atrasados
      if (diasParaVenc < 0) {
        console.log(
          `🚨 CRÍTICO: ${obrigacao.tipo} - ${obrigacao.competencia.empresa.razaoSocial} VENCIDA há ${Math.abs(diasParaVenc)} dias!`
        );
        const telefone = obrigacao.preparador?.telefone;
        if (telefone) {
          try {
            await whatsappService.sendText(
              telefone,
              `Atenção! ${obrigacao.tipo} está vencida há ${Math.abs(diasParaVenc)} dia(s).`,
              `overdue-${obrigacao.id}`
            );
          } catch (error) {
            console.error('Erro ao enviar alerta crítico:', error);
          }
        }
        alertasGerados++;
      }

      if (
        obrigacao.status === STATUS_OBRIGACAO.PREPARADA &&
        obrigacao.entregador?.telefone &&
        !(obrigacao.observacoes || '').includes('[notificado_entregador]')
      ) {
        try {
          await whatsappService.sendText(
            obrigacao.entregador.telefone,
            `Obrigação ${obrigacao.tipo} pronta para entrega. Vencimento: ${obrigacao.vencimentoFinal.toLocaleDateString('pt-BR')}.`,
            `ready-${obrigacao.id}`
          );
          await prisma.obrigacao.update({
            where: { id: obrigacao.id },
            data: {
              observacoes: `${obrigacao.observacoes || ''} [notificado_entregador]`.trim(),
            },
          });
        } catch (error) {
          console.error('Erro ao notificar entregador:', error);
        }
      }
    }

    console.log(`✅ Verificação concluída. ${alertasGerados} alertas gerados.`);
  } catch (error) {
    console.error('❌ Erro ao verificar obrigações:', error);
  }
}

// Função para verificar competências paradas
async function verificarCompetenciasParadas() {
  console.log('🔍 Verificando competências paradas...');

  try {
    const umDiaAtras = new Date();
    umDiaAtras.setDate(umDiaAtras.getDate() - 1);

    const competenciasParadas = await prisma.competencia.findMany({
      where: {
        status: 'Em Andamento',
        updatedAt: {
          lt: umDiaAtras,
        },
      },
      include: {
        empresa: {
          select: { razaoSocial: true, nomeFantasia: true },
        },
        etapas: {
          where: {
            status: 'Em Andamento',
          },
          orderBy: { ordem: 'asc' },
          take: 1,
        },
      },
    });

    if (competenciasParadas.length > 0) {
      console.log(`⚠️  ${competenciasParadas.length} competências paradas há mais de 1 dia:`);

      competenciasParadas.forEach((comp) => {
        console.log(
          `   - ${comp.empresa.razaoSocial} (${comp.mesAno}) - Etapa: ${comp.etapas[0]?.nome || 'N/A'}`
        );
      });
    } else {
      console.log('✅ Nenhuma competência parada encontrada.');
    }
  } catch (error) {
    console.error('❌ Erro ao verificar competências paradas:', error);
  }
}

// Função para verificar etapas puladas
async function verificarEtapasPuladas() {
  console.log('🔄 Verificando etapas puladas...');

  try {
    const etapasPuladas = await prisma.etapa.findMany({
      where: {
        status: 'Pulado',
      },
      include: {
        competencia: {
          include: {
            empresa: {
              select: { razaoSocial: true, nomeFantasia: true },
            },
          },
        },
      },
    });

    if (etapasPuladas.length > 0) {
      console.log(`📋 ${etapasPuladas.length} etapas puladas pendentes:`);

      etapasPuladas.forEach((etapa) => {
        console.log(
          `   - ${etapa.competencia.empresa.razaoSocial} (${etapa.competencia.mesAno}) - ${etapa.nome}`
        );
      });
    } else {
      console.log('✅ Nenhuma etapa pulada encontrada.');
    }
  } catch (error) {
    console.error('❌ Erro ao verificar etapas puladas:', error);
  }
}

// Função para gerar resumo diário
async function gerarResumoDiario() {
  console.log('\n📊 ===== RESUMO DIÁRIO =====');

  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);

    const [
      competenciasEmAndamento,
      obrigacoesVencemHoje,
      obrigacoesEmRisco,
      problemasAbertos,
      etapasConcluidasHoje,
    ] = await Promise.all([
      prisma.competencia.count({
        where: { status: 'Em Andamento' },
      }),
      prisma.obrigacao.count({
        where: {
          vencimentoFinal: {
            gte: hoje,
            lt: amanha,
          },
          status: { notIn: ['Entregue', 'Comprovada'] },
        },
      }),
      prisma.obrigacao.count({
        where: {
          emRisco: true,
          status: { notIn: ['Entregue', 'Comprovada'] },
        },
      }),
      prisma.problema.count({
        where: { status: 'Aberto' },
      }),
      prisma.etapa.count({
        where: {
          fimAt: {
            gte: hoje,
            lt: amanha,
          },
          status: 'Concluido',
        },
      }),
    ]);

    console.log(`📅 Data: ${hoje.toLocaleDateString('pt-BR')}`);
    console.log(`📝 Competências em andamento: ${competenciasEmAndamento}`);
    console.log(`⏰ Obrigações vencem hoje: ${obrigacoesVencemHoje}`);
    console.log(`⚠️  Obrigações em risco: ${obrigacoesEmRisco}`);
    console.log(`🐛 Problemas abertos: ${problemasAbertos}`);
    console.log(`✅ Etapas concluídas hoje: ${etapasConcluidasHoje}`);
    console.log('============================\n');
  } catch (error) {
    console.error('❌ Erro ao gerar resumo diário:', error);
  }
}

// Iniciar jobs agendados
export function startCronJobs() {
  // Verificar obrigações a cada hora
  cron.schedule('0 * * * *', () => {
    verificarObrigacoesVencimento();
  });

  // Verificar competências paradas às 9h e 15h
  cron.schedule('0 9,15 * * *', () => {
    verificarCompetenciasParadas();
  });

  // Verificar etapas puladas às 10h
  cron.schedule('0 10 * * *', () => {
    verificarEtapasPuladas();
  });

  // Gerar resumo diário às 8h
  cron.schedule('0 8 * * *', () => {
    gerarResumoDiario();
  });

  console.log('✅ Jobs agendados iniciados com sucesso!');
  console.log('   - Verificação de obrigações: a cada hora');
  console.log('   - Verificação de competências paradas: 9h e 15h');
  console.log('   - Verificação de etapas puladas: 10h');
  console.log('   - Resumo diário: 8h');
}

// Exportar funções para uso manual
export {
  verificarObrigacoesVencimento,
  verificarCompetenciasParadas,
  verificarEtapasPuladas,
  gerarResumoDiario,
};
