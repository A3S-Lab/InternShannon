export interface WechatChannelConfig {
    endpoint: string;
    token?: string;
}

export interface WechatBotIdentity {
    wxId: string;
    nickname: string;
    avatarUrl?: string;
}

export interface WechatMessage {
    messageId: string;
    fromUser: string;
    fromNickname?: string;
    toUser: string;
    content: string;
    isGroup: boolean;
    groupId?: string;
}

export interface WechatChannelEventMap {
    message: (message: WechatMessage) => void | Promise<void>;
    error: (error: { code: string; message: string }) => void;
    login: (identity: WechatBotIdentity) => void;
    logout: () => void;
}
