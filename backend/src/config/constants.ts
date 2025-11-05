// Constantes do Sistema de Gestão Contábil

// Regimes Tributários
export const REGIMES = {
  SN: 'Simples Nacional',
  LP: 'Lucro Presumido',
  LR: 'Lucro Real',
} as const;

// Segmentos
export const SEGMENTOS = {
  COMERCIO: 'Comercio',
  SERVICOS: 'Servicos',
  INDUSTRIA: 'Industria',
  MISTO: 'Misto',
} as const;

// Status de Competência
export const STATUS_COMPETENCIA = {
  NAO_INICIADO: 'Nao Iniciado',
  EM_ANDAMENTO: 'Em Andamento',
  PAUSADO: 'Pausado',
  CONCLUIDO: 'Concluido',
} as const;

// Status de Etapa
export const STATUS_ETAPA = {
  NAO_INICIADO: 'Nao Iniciado',
  EM_ANDAMENTO: 'Em Andamento',
  CONCLUIDO: 'Concluido',
  PULADO: 'Pulado',
} as const;

// Status de Obrigação
export const STATUS_OBRIGACAO = {
  NAO_INICIADA: 'Nao Iniciada',
  EM_PREPARACAO: 'Em Preparacao',
  PREPARADA: 'Preparada',
  ENTREGUE: 'Entregue',
  COMPROVADA: 'Comprovada',
} as const;

// Tipos de Sistema
export const SISTEMAS = {
  JETTAX: 'Jettax',
  DOMINIO: 'Dominio',
  SITTAX: 'Sittax',
  MANUAL: 'Manual',
  OUTRO: 'Outro',
} as const;

// Tipos de Problema
export const TIPOS_PROBLEMA = {
  TECNICO: 'Tecnico',
  PROCESSO: 'Processo',
  CLIENTE: 'Cliente',
  SISTEMA: 'Sistema',
  OUTRO: 'Outro',
} as const;

// Níveis de Impacto
export const IMPACTOS = {
  BAIXO: 'Baixo',
  MEDIO: 'Medio',
  ALTO: 'Alto',
  CRITICO: 'Critico',
} as const;

// Papéis de Usuário
export const PAPEIS = {
  ADMIN: 'Admin',
  GESTOR: 'Gestor',
  PREPARADOR: 'Preparador',
  ENTREGADOR: 'Entregador',
} as const;

// Sublimite Simples Nacional (em centavos)
export const SUBLIMITE_SN = 3600000 * 100; // R$ 3.6 milhões

// Dias para alertas de vencimento
export const DIAS_ALERTA = [7, 3, 1];

// Vencimentos por regime (dia do mês)
export const VENCIMENTOS = {
  SN: {
    DAS: 20,
    PIS_COFINS: 25,
    ICMS: 15, // Varia por UF
    DIFAL: 15, // Varia por UF
  },
  LP: {
    PIS_COFINS: 25,
    ICMS: 15, // Varia por UF
    IRPJ: 31, // Último dia do mês seguinte
    CSLL: 31, // Último dia do mês seguinte
    EFD_CONTRIBUICOES: 10, // 10º dia útil do 2º mês subsequente
    EFD_ICMS_IPI: 20, // Varia por UF
    REINF: 15,
    DIFAL: 15, // Varia por UF
  },
  LR: {
    PIS_COFINS: 25,
    ICMS: 15, // Varia por UF
    IRPJ: 31, // Depende do período
    CSLL: 31, // Depende do período
    EFD_CONTRIBUICOES: 10,
    EFD_ICMS_IPI: 20,
    REINF: 15,
    ECF: 31, // Último dia útil de julho
  },
} as const;

// Tipos de Obrigação
export const TIPOS_OBRIGACAO = {
  DAS: 'DAS',
  PIS_COFINS: 'PIS/COFINS',
  ICMS: 'ICMS',
  DIFAL_COMERCIALIZACAO: 'DIFAL Comercialização',
  DIFAL_CONSUMO: 'DIFAL Consumo/Imobilizado',
  IRPJ: 'IRPJ',
  IRPJ_ESTIMATIVA: 'IRPJ (Estimativa)',
  CSLL: 'CSLL',
  CSLL_ESTIMATIVA: 'CSLL (Estimativa)',
  EFD_CONTRIBUICOES: 'EFD Contribuições',
  EFD_ICMS_IPI: 'EFD ICMS/IPI',
  REINF: 'REINF',
  ECF: 'ECF',
  MIT_DCTFWEB: 'MIT/DCTFWeb (Sem Movimento)',
} as const;

// Esferas
export const ESFERAS = {
  FEDERAL: 'Federal',
  ESTADUAL: 'Estadual',
  MUNICIPAL: 'Municipal',
} as const;

// UFs do Brasil
export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

// Fluxos de trabalho por regime
export const FLUXOS = {
  SN: [
    { ordem: 1, nome: 'Captura Empresa', sistema: null, tipo: 'Manual' },
    { ordem: 2, nome: 'Captura Competência', sistema: null, tipo: 'Manual' },
    { ordem: 3, nome: 'Confirma Movimento', sistema: null, tipo: 'Manual' },
    { ordem: 4, nome: 'Download NFs', sistema: 'Jettax', tipo: 'Sistema' },
    { ordem: 5, nome: 'Importação e Conferência', sistema: 'Dominio', tipo: 'Sistema' },
    { ordem: 6, nome: 'Apuração', sistema: 'Sittax', tipo: 'Sistema' },
    { ordem: 7, nome: 'Confronto Sittax x Domínio', sistema: null, tipo: 'Manual' },
    { ordem: 8, nome: 'Verificação Sublimite', sistema: null, tipo: 'Manual' },
    { ordem: 9, nome: 'Verificação DIFAL', sistema: null, tipo: 'Manual' },
    { ordem: 10, nome: 'Geração de Obrigações', sistema: null, tipo: 'Sistema' },
  ],
  LP: [
    { ordem: 1, nome: 'Captura Empresa', sistema: null, tipo: 'Manual' },
    { ordem: 2, nome: 'Captura Competência', sistema: null, tipo: 'Manual' },
    { ordem: 3, nome: 'Coleta e Importação', sistema: null, tipo: 'Misto' },
    { ordem: 4, nome: 'Conferência', sistema: null, tipo: 'Manual' },
    { ordem: 5, nome: 'PIS/COFINS', sistema: null, tipo: 'Sistema' },
    { ordem: 6, nome: 'ICMS', sistema: null, tipo: 'Sistema' },
    { ordem: 7, nome: 'DIFAL Consumo', sistema: null, tipo: 'Manual' },
    { ordem: 8, nome: 'REINF', sistema: null, tipo: 'Sistema' },
    { ordem: 9, nome: 'IRPJ/CSLL', sistema: null, tipo: 'Sistema' },
    { ordem: 10, nome: 'Geração de Obrigações', sistema: null, tipo: 'Sistema' },
  ],
  LR: [
    { ordem: 1, nome: 'Captura Empresa', sistema: null, tipo: 'Manual' },
    { ordem: 2, nome: 'Captura Competência', sistema: null, tipo: 'Manual' },
    { ordem: 3, nome: 'Coleta e Importação', sistema: null, tipo: 'Misto' },
    { ordem: 4, nome: 'Conferência', sistema: null, tipo: 'Manual' },
    { ordem: 5, nome: 'PIS/COFINS', sistema: null, tipo: 'Sistema' },
    { ordem: 6, nome: 'ICMS', sistema: null, tipo: 'Sistema' },
    { ordem: 7, nome: 'DIFAL Consumo', sistema: null, tipo: 'Manual' },
    { ordem: 8, nome: 'REINF', sistema: null, tipo: 'Sistema' },
    { ordem: 9, nome: 'IRPJ/CSLL', sistema: null, tipo: 'Sistema' },
    { ordem: 10, nome: 'ECF', sistema: null, tipo: 'Sistema' },
    { ordem: 11, nome: 'Geração de Obrigações', sistema: null, tipo: 'Sistema' },
  ],
} as const;

export default {
  REGIMES,
  SEGMENTOS,
  STATUS_COMPETENCIA,
  STATUS_ETAPA,
  STATUS_OBRIGACAO,
  SISTEMAS,
  TIPOS_PROBLEMA,
  IMPACTOS,
  PAPEIS,
  SUBLIMITE_SN,
  DIAS_ALERTA,
  VENCIMENTOS,
  TIPOS_OBRIGACAO,
  ESFERAS,
  UFS,
  FLUXOS,
};
