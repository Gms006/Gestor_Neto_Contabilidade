// src/types/acessorias.ts
export type AnyJson = string|number|boolean|null|AnyJson[]|{[k:string]:AnyJson};

export interface Company {
  id?: number|string; empresaId?: number|string;
  cnpj?: string; nome?: string; razaoSocial?: string;
  [k: string]: AnyJson;
}

export interface Process {
  id: number|string; empresaId?: number|string;
  titulo?: string; status?: string; progress?: number;
  dataInicio?: string; dataFim?: string;
  [k: string]: AnyJson;
}

export interface Delivery {
  id: number|string; processoId?: number|string;
  descricao?: string; status?: string; data?: string;
  [k: string]: AnyJson;
}

export type ACompany = Company;
export type AProcess = Process;
export type ADelivery = Delivery;
