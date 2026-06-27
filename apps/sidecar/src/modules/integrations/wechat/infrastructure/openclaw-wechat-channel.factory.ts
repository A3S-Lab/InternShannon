import { randomBytes, randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
    WechatBotIdentity,
    WechatChannelEventMap,
    WechatChannelFactory,
    WechatChannelFactoryConfig,
    WechatChannelPort,
    WechatQrCodeResult,
    WechatQrCodeStatus,
} from '../domain';

const ILINK_BOT_PATH = '/ilink/bot';
const CHANNEL_VERSION = '2.4.3';
const BOT_AGENT = 'SafeClaw';
const APP_CLIENT_VERSION = 132099; // 2.4.3 encoded as (2<<16)|(4<<8)|3

type EventHandlers = {
    [K in keyof WechatChannelEventMap]?: WechatChannelEventMap[K][];
};

function randomUin(): string {
    const num = randomInt(0, 0xFFFFFFFF);
    return Buffer.from(String(num)).toString('base64');
}

function randomClientId(): string {
    return `safeclaw-${randomBytes(8).toString('hex')}`;
}

class ILinkWechatChannel implements WechatChannelPort {
    private readonly logger = new Logger(ILinkWechatChannel.name);
    private readonly token: string;
    private readonly endpoint: string;
    private readonly handlers: EventHandlers = {};
    private _identity?: WechatBotIdentity;
    private pollTimer?: NodeJS.Timeout;
    private pollFailures = 0;
    private getUpdatesBuf = '';
    private stopped = false;

    constructor(config: WechatChannelFactoryConfig) {
        this.token = config.token;
        this.endpoint = config.endpoint.replace(/\/+$/, '');
    }

    get identity(): WechatBotIdentity | undefined {
        return this._identity;
    }

    async connect(): Promise<void> {
        this.stopped = false;
        if (!this.token) return;
        try {
            await this.postJson(`${ILINK_BOT_PATH}/msg/notifystart`, { base_info: this.baseInfo() });
            this._identity = { wxId: '', nickname: '', avatarUrl: undefined };
            this.emit('login', this._identity);
            this.schedulePoll(500);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.emit('error', { code: 'CONNECT_FAILED', message });
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        this.stopped = true;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
        if (this._identity && this.token) {
            try {
                await this.postJson(`${ILINK_BOT_PATH}/msg/notifystop`, { base_info: this.baseInfo() });
            } catch { /* best effort */ }
        }
        if (this._identity) {
            this._identity = undefined;
            this.emit('logout');
        }
    }

    async getQrCode(): Promise<WechatQrCodeResult | undefined> {
        try {
            const url = `${this.endpoint}${ILINK_BOT_PATH}/get_bot_qrcode?bot_type=3`;
            const resp = await this.fetchGet(url);
            if (resp?.qrcode) {
                return {
                    qrcode: resp.qrcode,
                    qrcodeImageUrl: resp.qrcode_img_content || '',
                };
            }
            return undefined;
        } catch (error) {
            this.logger.warn(`Failed to get QR code: ${error instanceof Error ? error.message : error}`);
            return undefined;
        }
    }

    async pollQrCodeStatus(qrcode: string): Promise<WechatQrCodeStatus | undefined> {
        try {
            const url = `${this.endpoint}${ILINK_BOT_PATH}/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
            const headers: Record<string, string> = { 'iLink-App-ClientVersion': '1' };
            const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(40_000) });
            if (!response.ok) return undefined;
            const resp = await response.json() as any;
            if (!resp) return undefined;
            const result: WechatQrCodeStatus = { status: resp.status || 'unknown' };
            if (resp.bot_token) result.botToken = resp.bot_token;
            if (resp.ilink_bot_id) result.ilinkBotId = resp.ilink_bot_id;
            if (resp.baseurl) result.baseUrl = resp.baseurl;
            if (resp.redirect_host) result.redirectHost = resp.redirect_host;
            return result;
        } catch {
            return undefined;
        }
    }

    async getQrCodeUrl(): Promise<string | undefined> {
        const result = await this.getQrCode();
        return result?.qrcodeImageUrl || undefined;
    }

    on<K extends keyof WechatChannelEventMap>(name: K, handler: WechatChannelEventMap[K]): void {
        if (!this.handlers[name]) {
            this.handlers[name] = [];
        }
        this.handlers[name]!.push(handler);
    }

    async send(to: string, content: string, contextToken?: string): Promise<void> {
        await this.postJson(`${ILINK_BOT_PATH}/sendmessage`, {
            msg: {
                to_user_id: to,
                from_user_id: '',
                client_id: randomClientId(),
                message_type: 2,
                message_state: 2,
                context_token: contextToken || '',
                item_list: [{ type: 1, text_item: { text: content } }],
            },
            base_info: this.baseInfo(),
        });
    }

    private schedulePoll(delayMs: number): void {
        if (this.stopped) return;
        this.pollTimer = setTimeout(async () => {
            if (this.stopped) return;
            try {
                const resp = await this.postJson(`${ILINK_BOT_PATH}/getupdates`, {
                    get_updates_buf: this.getUpdatesBuf,
                    base_info: this.baseInfo(),
                });
                if (resp?.errcode === -14) {
                    this.emit('error', { code: 'SESSION_EXPIRED', message: 'iLink session expired, re-login required' });
                    this.emit('logout');
                    this._identity = undefined;
                    return;
                }
                if (resp?.get_updates_buf) {
                    this.getUpdatesBuf = resp.get_updates_buf;
                }
                if (Array.isArray(resp?.msgs)) {
                    for (const msg of resp.msgs) {
                        if (msg.message_type !== 1) continue;
                        const textItem = msg.item_list?.find((item: any) => item.type === 1);
                        if (!textItem?.text_item?.text) continue;
                        this.emit('message', {
                            messageId: String(msg.message_id || msg.client_id || ''),
                            fromUser: msg.from_user_id || '',
                            toUser: msg.to_user_id || '',
                            content: textItem.text_item.text,
                            isGroup: Boolean(msg.group_id),
                            groupId: msg.group_id,
                            contextToken: msg.context_token,
                        });
                    }
                }
                this.pollFailures = 0;
                this.schedulePoll(500);
            } catch (error) {
                this.pollFailures = Math.min(this.pollFailures + 1, 6);
                const backoff = Math.min(3000 * 2 ** this.pollFailures, 60_000);
                this.logger.debug(`Poll error (retry in ${backoff}ms): ${error instanceof Error ? error.message : error}`);
                this.schedulePoll(backoff);
            }
        }, delayMs);
        (this.pollTimer as NodeJS.Timeout).unref?.();
    }

    private baseInfo() {
        return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT };
    }

    private authHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'iLink-App-Id': 'bot',
            'iLink-App-ClientVersion': String(APP_CLIENT_VERSION),
        };
        if (this.token) {
            headers['AuthorizationType'] = 'ilink_bot_token';
            headers['Authorization'] = `Bearer ${this.token}`;
            headers['X-WECHAT-UIN'] = randomUin();
        }
        return headers;
    }

    private async postJson(path: string, body: Record<string, unknown>, requireAuth = true): Promise<any> {
        if (requireAuth && !this.token) {
            throw new Error('No bot token available');
        }
        const url = `${this.endpoint}${path}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(40_000),
        });
        if (!response.ok) {
            throw new Error(`iLink API error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    private async fetchGet(url: string): Promise<any> {
        const headers: Record<string, string> = {
            'iLink-App-Id': 'bot',
            'iLink-App-ClientVersion': String(APP_CLIENT_VERSION),
        };
        const response = await fetch(url, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(40_000),
        });
        if (!response.ok) {
            throw new Error(`iLink API error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    private emit<K extends keyof WechatChannelEventMap>(name: K, ...args: Parameters<WechatChannelEventMap[K]>): void {
        const handlers = this.handlers[name];
        if (!handlers) return;
        for (const handler of handlers) {
            try {
                (handler as (...a: unknown[]) => unknown)(...args);
            } catch (error) {
                this.logger.debug(`Event handler error: ${error instanceof Error ? error.message : error}`);
            }
        }
    }
}

@Injectable()
export class OpenClawWechatChannelFactory implements WechatChannelFactory {
    create(config: WechatChannelFactoryConfig): WechatChannelPort {
        return new ILinkWechatChannel(config);
    }
}
