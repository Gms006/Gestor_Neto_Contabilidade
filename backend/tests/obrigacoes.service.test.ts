jest.mock('../src/config/database', () => {
  const store: any[] = [];

  const findIndex = (competenciaId: string, tipo: string) =>
    store.findIndex((item) => item.competenciaId === competenciaId && item.tipo === tipo);

  const prismaMock = {
    obrigacao: {
      findFirst: jest.fn(async ({ where }: any) => {
        const index = findIndex(where.competenciaId, where.tipo);
        return index >= 0 ? store[index] : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = store.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error('Obrigação não encontrada');
        store[index] = { ...store[index], ...data };
        return store[index];
      }),
      create: jest.fn(async ({ data }: any) => {
        const created = { id: `ob-${store.length + 1}`, ...data };
        store.push(created);
        return created;
      }),
      findMany: jest.fn(async () => store),
    },
  } as any;

  prismaMock.__store = store;
  prismaMock.__reset = () => {
    store.splice(0, store.length);
    prismaMock.obrigacao.findFirst.mockClear();
    prismaMock.obrigacao.update.mockClear();
    prismaMock.obrigacao.create.mockClear();
    prismaMock.obrigacao.findMany.mockClear();
  };

  return { __esModule: true, default: prismaMock };
});

import prisma from '../src/config/database';
import { gerarObrigacoesSN, gerarObrigacoesPresumido } from '../src/services/obrigacoes.service';
import { TIPOS_OBRIGACAO } from '../src/config/constants';

describe('obrigacoes.service', () => {
  beforeEach(() => {
    (prisma as any).__reset();
  });

  it('gera obrigações do Simples Nacional com DIFAL quando informado', async () => {
    await gerarObrigacoesSN({
      empresaId: 'empresa-sn',
      competenciaId: 'comp-sn',
      mesAno: '2025-02',
      houveMovimento: true,
      houveCompraInterestadual: true,
      difalTipo: 'ambos',
    });

    const store = (prisma as any).__store as any[];
    const tipos = store.map((item) => item.tipo);
    expect(tipos).toEqual(
      expect.arrayContaining([
        TIPOS_OBRIGACAO.DAS,
        TIPOS_OBRIGACAO.PIS_COFINS,
        TIPOS_OBRIGACAO.ICMS,
        TIPOS_OBRIGACAO.DIFAL_CONSUMO,
        TIPOS_OBRIGACAO.DIFAL_COMERCIALIZACAO,
      ])
    );
  });

  it('lança erro quando informa DIFAL sem tipo', async () => {
    await expect(
      gerarObrigacoesSN({
        empresaId: 'empresa-sn',
        competenciaId: 'comp-sn',
        mesAno: '2025-02',
        houveMovimento: true,
        houveCompraInterestadual: true,
      })
    ).rejects.toThrow('Informe o tipo de DIFAL');
  });

  it('gera MIT/DCTFWeb para LP sem folha e com faturamento anterior', async () => {
    await gerarObrigacoesPresumido({
      empresaId: 'empresa-lp',
      competenciaId: 'comp-lp',
      mesAno: '2025-02',
      pisCofinsDebito: false,
      pisCofinsMotivo: 'Isenção municipal',
      icmsDevido: false,
      icmsGuiaGerada: false,
      difalUso: 'nenhum',
      reinf: false,
      temFolha: false,
      faturouMesAnterior: true,
      periodicidadeIrpjCsll: 'Trimestral',
    });

    const store = (prisma as any).__store as any[];
    const encontrouMit = store.some((item) => item.tipo === TIPOS_OBRIGACAO.MIT_DCTFWEB);
    expect(encontrouMit).toBe(true);
  });
});
