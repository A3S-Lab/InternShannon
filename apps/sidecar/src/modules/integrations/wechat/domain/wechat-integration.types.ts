export interface WechatIntegrationConfig {
    enabled: boolean;
    endpoint: string;
    token: string;
}

export interface WechatChannelStatus {
    enabled: boolean;
    connected: boolean;
    configReady?: boolean;
    boundAccount?: string;
    qrCodeUrl?: string;
    qrcode?: string;
    state?: string;
    lastError?: string;
    receivedMessageCount?: number;
    handledMessageCount?: number;
    lastMessageAt?: string;
    lastReplyAt?: string;
    lastMessageError?: string;
    updatedAt?: string;
}
