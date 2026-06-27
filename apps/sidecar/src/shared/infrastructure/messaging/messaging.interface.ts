// ============================================================================
// Messaging Infrastructure Interface (stubbed)
// ============================================================================

// Types stubbed - nats package not built

export interface ISubscription {
    sid: number;
    subject: string;
    queue?: string;
    cancel(): void;
    isCancelled(): boolean;
}

export interface IMessagingService {
    getConnection(): Promise<unknown>;
    getJetStream(): Promise<unknown>;

    publish(options: unknown): Promise<void>;
    pubsub(subject: string, data: object): Promise<void>;
    request(options: unknown): Promise<unknown>;
    request$<T>(subject: string, data?: object): Promise<T>;

    subscribe(options: unknown, handler: unknown): Promise<ISubscription>;
    subscribe$(subject: string, handler: (data: unknown) => Promise<void>): Promise<ISubscription>;
    unsubscribe(subscription: ISubscription): void;

    // Health check
    isHealthy(): Promise<boolean>;
}
