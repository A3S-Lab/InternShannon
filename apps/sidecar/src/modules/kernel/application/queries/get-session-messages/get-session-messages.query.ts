export class GetSessionMessagesQuery {
    constructor(
        public readonly sessionId: string,
        public readonly limit?: number,
        public readonly offset?: number,
    ) {}
}
