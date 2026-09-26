import { createContext, useContext, type ReactNode } from "react";

export interface ComposerApi {
  readonly insertText: (text: string) => void;
  readonly submitText: (text: string) => void;
  readonly isSubmitDisabled?: boolean;
}

const ComposerApiContext = createContext<ComposerApi | null>(null);

export function ComposerApiProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ComposerApi;
}) {
  return <ComposerApiContext.Provider value={value}>{children}</ComposerApiContext.Provider>;
}

export function useComposerApi(): ComposerApi {
  const ctx = useContext(ComposerApiContext);
  if (!ctx) throw new Error("useComposerApi must run inside a contributed composer accessory");
  return ctx;
}
