import { createContext, type ReactNode, useContext } from "react";

/**
 * Provides the active chat session id to descendant components that don't
 * receive it as a direct prop — most importantly the embedded markdown / code
 * fence renderers (CodeHighlight → AssetProposalCard), which run several
 * levels below AgentChat and need to know which session their actions target.
 *
 * Falling outside the provider yields `undefined`; consumers should treat that
 * as "not in a chat context" and degrade to read-only rendering.
 */
const AgentSessionIdContext = createContext<string | undefined>(undefined);

export function AgentSessionIdProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  return (
    <AgentSessionIdContext.Provider value={sessionId}>{children}</AgentSessionIdContext.Provider>
  );
}

export function useAgentSessionId(): string | undefined {
  return useContext(AgentSessionIdContext);
}
