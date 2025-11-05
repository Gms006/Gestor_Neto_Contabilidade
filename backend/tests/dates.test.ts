import { ajustarVencimento } from '../src/utils/dates';

describe('ajustarVencimento', () => {
  it('antecipa para o dia útil anterior para obrigações federais', () => {
    const base = new Date('2025-03-30T00:00:00Z'); // Domingo
    const ajustada = ajustarVencimento(base, 'Federal');
    expect(ajustada.getUTCDay()).toBe(5); // Sexta-feira
    expect(ajustada.getUTCDate()).toBe(28);
  });

  it('posterga para o dia útil seguinte para obrigações estaduais', () => {
    const base = new Date('2025-03-30T00:00:00Z'); // Domingo
    const ajustada = ajustarVencimento(base, 'Estadual');
    expect(ajustada.getUTCDay()).toBe(1); // Segunda-feira
    expect(ajustada.getUTCDate()).toBe(31);
  });

  it('considera feriados nacionais fixos', () => {
    const base = new Date('2025-01-01T00:00:00Z'); // Confraternização
    const ajustada = ajustarVencimento(base, 'Federal');
    expect(ajustada.getUTCDate()).toBe(31);
    expect(ajustada.getUTCMonth()).toBe(11); // Dezembro do ano anterior
  });
});
