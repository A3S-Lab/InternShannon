export const WECHAT_CHANNEL_FACTORY = Symbol('WECHAT_CHANNEL_FACTORY');

export interface WechatChannelFactory {
    create(config: WechatChannelFactoryConfig): WechatChannelPort;
}

export interface WechatChannelFactoryConfig {
    token: string;
    endpoint: string;
}

export interface WechatQrCodeResult {
    qrcode: string;
    qrcodeImageUrl: string;
}

export interface WechatQrCodeStatus {
    status: string;
    botToken?: string;
    ilinkBotId?: string;
    baseUrl?: string;
    redirectHost?: string;
}

export interface WechatChannelPort {
    readonly identity?: WechatBotIdentity;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getQrCode(): Promise<WechatQrCodeResult | undefined>;
    pollQrCodeStatus(qrcode: string): Promise<WechatQrCodeStatus | undefined>;
    getQrCodeUrl(): Promise<string | undefined>;
    on<K extends keyof WechatChannelEventMap>(name: K, handler: WechatChannelEventMap[K]): unknown;
    send(to: string, content: string, contextToken?: string): Promise<void>;
}

export interface WechatBotIdentity {
    wxId: string;
    nickname: string;
    avatarUrl?: string;
}

export interface WechatChannelMessage {
    messageId: string;
    fromUser: string;
    fromNickname?: string;
    toUser: string;
    content: string;
    isGroup: boolean;
    groupId?: string;
    contextToken?: string;
}

export interface WechatChannelError {
    code: string;
    message: string;
}

export interface WechatChannelEventMap {
    message: (message: WechatChannelMessage) => void | Promise<void>;
    error: (error: WechatChannelError) => void;
    login: (identity: WechatBotIdentity) => void;
    logout: () => void;
    tokenObtained: (token: string) => void;
}
