import { createLarkChannel, LoggerLevel, type LarkChannel, type LarkChannelOptions } from '@larksuiteoapi/node-sdk';

export type A3sLarkChannel = Pick<
    LarkChannel,
    | 'botIdentity'
    | 'connect'
    | 'disconnect'
    | 'getConnectionStatus'
    | 'getPolicy'
    | 'on'
    | 'send'
    | 'stream'
    | 'updateCard'
    | 'updatePolicy'
>;

export interface A3sLarkChannelConfig {
    appId: string;
    appSecret: string;
    requireMention?: boolean;
    dmMode?: NonNullable<LarkChannelOptions['policy']>['dmMode'];
    source?: string;
    handshakeTimeoutMs?: number;
    streamInitialText?: string;
}

export function createA3sLarkChannel(config: A3sLarkChannelConfig): A3sLarkChannel {
    return createLarkChannel({
        appId: config.appId,
        appSecret: config.appSecret,
        source: config.source ?? 'a3s-os',
        loggerLevel: LoggerLevel.info,
        handshakeTimeoutMs: config.handshakeTimeoutMs ?? 15_000,
        outbound: {
            streamInitialText: config.streamInitialText ?? '思考中...',
        },
        policy: {
            requireMention: config.requireMention ?? true,
            dmMode: config.dmMode ?? 'open',
        },
        safety: {
            chatQueue: {
                enabled: true,
            },
        },
    });
}
