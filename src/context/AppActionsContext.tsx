import { createContext, useContext } from "react";

interface AppActions {
  prepareNoteCreation: () => void;
  selectNote: (id: string) => void | Promise<void>;
  noteCreated: (id: string) => void;
  openPdf: () => void | Promise<void>;
  openWebSummary: () => void;
}

const AppActionsContext = createContext<AppActions | null>(null);

export const AppActionsProvider = AppActionsContext.Provider;

export function useAppActions() {
  const actions = useContext(AppActionsContext);
  if (!actions) {
    throw new Error("useAppActions must be used within AppActionsProvider");
  }
  return actions;
}
