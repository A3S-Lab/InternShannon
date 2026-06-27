export class CreateSessionCommand {
    constructor(
        public readonly agentId: string | undefined,
        public readonly userId: string,
        public readonly title?: string,
        public readonly cwd?: string,
        public readonly options?: Record<string, unknown>,
    ) {}
}
