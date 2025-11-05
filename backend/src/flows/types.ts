import { Conversa } from '@prisma/client';

export type PendingCommand =
  | { type: 'problema'; descricao?: string }
  | { type: 'observacao'; texto?: string }
  | { type: 'desabafo'; texto?: string };

export interface EngineState {
  stage: string;
  fluxo?: 'SN' | 'LP';
  data: Record<string, any>;
  history: string[];
  pending?: PendingCommand | null;
}

export interface FlowContext {
  conversa: Conversa;
  text: string;
  state: EngineState;
}

export interface FlowResult {
  messages: string[];
  state: EngineState;
  conversa?: Conversa;
}

export function moveToStage(state: EngineState, nextStage: string): EngineState {
  const history = [...(state.history || [])];
  if (state.stage && history[history.length - 1] !== state.stage) {
    history.push(state.stage);
  }
  return { ...state, stage: nextStage, history };
}

export function resetHistory(state: EngineState): EngineState {
  return { ...state, history: [] };
}
