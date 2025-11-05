import { addDays, differenceInCalendarDays, subDays } from 'date-fns';
import feriadosData from '../../../data/feriados-nacionais.json';

type FeriadoNacionalJson = {
  nome: string;
  data: string;
};

export type Esfera = 'Federal' | 'Estadual' | 'Municipal';

type FeriadoFixo = {
  nome: string;
  mes: number;
  dia: number;
};

const feriadosNacionais = (feriadosData.feriadosNacionais || []) as FeriadoNacionalJson[];

const feriadosFixos: FeriadoFixo[] = feriadosNacionais
  .filter((feriado) => feriado.data && feriado.data !== 'variavel')
  .map((feriado) => ({
    nome: feriado.nome,
    mes: Number(String(feriado.data).split('-')[0]),
    dia: Number(String(feriado.data).split('-')[1]),
  }));

function isFimDeSemana(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function isFeriado(date: Date) {
  return feriadosFixos.some((feriado) => {
    return feriado.mes === date.getUTCMonth() + 1 && feriado.dia === date.getUTCDate();
  });
}

function isDiaUtil(date: Date) {
  return !isFimDeSemana(date) && !isFeriado(date);
}

export function ajustarVencimento(base: Date, esfera: Esfera): Date {
  let ajustada = new Date(base.getTime());

  if (esfera === 'Federal') {
    while (!isDiaUtil(ajustada)) {
      ajustada = subDays(ajustada, 1);
    }
  } else {
    while (!isDiaUtil(ajustada)) {
      ajustada = addDays(ajustada, 1);
    }
  }

  return ajustada;
}

export function calcularDiasParaVencimento(vencimento: Date, referencia: Date = new Date()) {
  return differenceInCalendarDays(vencimento, referencia);
}

export function parseCompetencia(mesAno: string) {
  const sanitized = mesAno.trim();
  const [anoStr, mesStr] = sanitized.includes('-')
    ? sanitized.split('-')
    : sanitized.split('/').reverse();
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  if (!ano || !mes || mes < 1 || mes > 12) {
    throw new Error('Competência inválida. Use o formato MM/AAAA ou AAAA-MM.');
  }
  return { ano, mes };
}

export function criarDataCompetencia(mesAno: string, dia: number, offsetMeses = 1): Date {
  const { ano, mes } = parseCompetencia(mesAno);
  const base = new Date(Date.UTC(ano, mes - 1 + offsetMeses, dia));
  return new Date(base.getTime());
}

export function formatarResumoData(date: Date) {
  return date.toISOString().split('T')[0];
}
