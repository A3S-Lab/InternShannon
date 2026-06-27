import type { WechatBotIdentity, WechatChannelConfig, WechatChannelEventMap, WechatMessage } from './wechat-channel.types';

type EventHandlers = {
    [K in keyof WechatChannelEventMap]?: WechatChannelEventMap[K][];
};

export class WechatChannelClient {
    private readonly endpoint: string;
    private readonly token?: string;
    private readonly handlers: EventHandlers = {};
    private _identity?: WechatBotIdentity;
    private pollTimer?: ReturnType<typeof setInterval>;

    constructor(config: WechatChannelConfig) {
        this.endpoint = config.endpoint.replace(/\/+$/, '');
        this.token = config.token;
    }

    get identity(): WechatBotIdentity | undefined {
        return this._identity;
    }

    get connected(): boolean {
        return this._identity !== undefined;
    }

    async connect(): Promise<void> {
        const resp = await this.request('getconfig', {});
        if (resp?.nickname) {
            this._identity = {
                wxId: resp.wxId || '',
                nickname: resp.nickname,
                avatarUrl: resp.avatarUrl,
            };
            this.emit('login', this._identity);
        }
        this.startPolling();
    }

    async disconnect(): Promise<void> {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        if (this._identity) {
            this._identity = undefined;
            this.emit('logout');
        }
    }

    async getQrCodeUrl(): Promise<string | undefined> {
        try {
            const resp = await this.request('getqrcode', {});
            return resp?.qrCodeUrl;
        } catch {
            return undefined;
        }
    }

    async sendMessage(to: string, content: string): Promise<void> {
        await this.request('sendmessage', { to, content });
    }

    on<K extends keyof WechatChannelEventMap>(event: K, handler: WechatChannelEventMap[K]): this {
        if (!this.handlers[event]) {
            this.handlers[event] = [];
        }
        this.handlers[event]!.push(handler);
        return this;
    }

    private startPolling(): void {
        this.pollTimer = setInterval(async () => {
            try {
                const updates = await this.request('getupdates', { timeout: 5 });
                if (Array.isArray(updates?.messages)) {
                    for (const msg of updates.messages) {
                        const message: WechatMessage = {
                            messageId: msg.messageId || '',
                            fromUser: msg.fromUser || '',
                            fromNickname: msg.fromNickname,
                            toUser: msg.toUser || '',
                            content: msg.content || '',
                            isGroup: Boolean(msg.isGroup),
                            groupId: msg.groupId,
                        };
                        this.emit('message', message);
                    }
                }
            } catch {
                // Polling errors are non-fatal
            }
        }, 3000);
        if (typeof this.pollTimer === 'object' && 'unref' in this.pollTimer) {
            this.pollTimer.unref();
        }
    }

    private emit<K extends keyof WechatChannelEventMap>(event: K, ...args: Parameters<WechatChannelEventMap[K]>): void {
        const handlers = this.handlers[event];
        if (!handlers) return;
        for (const handler of handlers) {
            try {
                (handler as (...a: unknown[]) => unknown)(...args);
            } catch {
                // Swallow handler errors
            }
        }
    }

    private async request(path: string, body: Record<string, unknown>): Promise<any> {
        const url = `${this.endpoint}/${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.token) {
            headers['AuthorizationType'] = 'ilink_bot_token';
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            throw new Error(`WeChat channel API error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
}
