/**
 * Resolves LLM credentials for a given model name from a trusted
 * server-managed configuration source (e.g. etcd-backed ConfigService in
 * trusted resolver mode). Used to enforce the rule that workflow JSON authored by
 * end users must never carry apiKey / apiHost in production.
 *
 * Trusted resolver mode: provide a resolver to WorkflowEngine. The LLM executor
 * will ignore any inline `apiKey` / `apiHost` on the node and use the
 * resolved values instead. If the resolver returns `undefined`, the
 * executor will surface a clear error rather than silently falling back
 * to whatever the workflow JSON contains.
 *
 * Library / standalone usage without a resolver: the executor continues to
 * read credentials from node data, preserving the existing behavior.
 */
export interface LLMCredentials {
    apiKey: string;
    apiHost: string;
    /**
     * The resolved model id to call. When the node left its `model` blank (the default
     * for built-in / default LLM nodes), this is the config service's `defaultModel` —
     * the ShuanOS platform default — so those nodes run on the vault-configured default
     * instead of a model hardcoded into the node or the executor.
     */
    model?: string;
    /**
     * Optional model capability flags from the trusted config, so the executor can
     * tailor the request to what the model accepts. When a flag is absent the
     * executor assumes the permissive default. The key one: reasoning models reject
     * `temperature` (HTTP 400) — `supportsTemperature: false` tells the executor to
     * omit it. The others are surfaced for future multimodal / tool-call use.
     */
    supportsTemperature?: boolean;
    supportsAttachment?: boolean;
    supportsReasoning?: boolean;
    supportsToolCall?: boolean;
}

export interface LLMCredentialResolver {
    /**
     * @param modelName the model id requested by the workflow node, or
     *   `undefined` when the node didn't specify one (in which case the
     *   resolver should fall back to its configured default).
     * @returns resolved credentials, or `undefined` if the model is not
     *   registered in the trusted configuration. In strict mode the
     *   executor will throw on `undefined`; library callers without a
     *   resolver are unaffected.
     */
    resolve(modelName: string | undefined): Promise<LLMCredentials | undefined>;
}
