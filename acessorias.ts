export type ACompany = {
  idAcessorias: number; // id interno do Acessórias (renomeado para clareza)
  cnpj: string;
  nome: string;
  nomeFantasia?: string | null; // Corrigido para camelCase
  email?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  uf?: string | null;
  dados?: unknown;
};

export type AStep = {
  idAcessorias?: number;
  nome: string;
  status: string;
  realizadoEm?: string | null; // ISO
  dados?: unknown;
};

export type AProcess = {
  idAcessorias: number; // id interno do Acessórias (renomeado para clareza)
  titulo: string;
  departamento?: string | null;
  status: string;                // "Concluído" | "Em andamento" | ...
  gestor?: string | null;
  dataInicio?: string | null;   // ISO (Corrigido para camelCase)
  dataConclusao?: string | null;// ISO (Corrigido para camelCase)
  previsao?: string | null;      // ISO
  empresa?: ACompany | null;
  empresaId?: number; // Adicionado para o caso de vir apenas o ID
  steps?: AStep[]; // Adicionado para as etapas
};

export type ADelivery = {
  idAcessorias: number; // id interno do Acessórias (renomeado para clareza)
  titulo: string;
  competencia?: string | null;   // "2025-11"
  tipo?: string | null;          // REINF/EFD...
  status?: string | null;      // "PAGO" | "ISENTO" | ... (Corrigido para status, que será mapeado para situacao)
  empresa?: ACompany | null;
  empresaId?: number; // Adicionado para o caso de vir apenas o ID
  vencimento?: string | null; // Adicionado para o caso de vir vencimento (será mapeado para dataEvento)
  payload?: unknown;
};

// Renomeando para DTOs mais específicos (se necessário, mas vamos usar os tipos da API por enquanto)
export type EmpresaDTO = ACompany;
export type ProcessoDTO = AProcess;
export type EntregaDTO = ADelivery;
