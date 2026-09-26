import { createContext, useContext, type ReactNode } from "react";

export interface TurnState {
  readonly turnId: string;
  readonly agentId: string;
  readonly status?: "streaming" | "completed" | "failed";
  readonly getContent: () => string;
}

const TurnStateContext = createContext<TurnState | null>(null);

export function TurnStateProvider({ children, value }: { children: ReactNode; value: TurnState }) {
  return <TurnStateContext.Provider value={value}>{children}</TurnStateContext.Provider>;
}

export function useTurnState(): TurnState {
  const ctx = useContext(TurnStateContext);
  if (!ctx) throw new Error("useTurnState must run inside a contributed turn action");
  return ctx;
}
