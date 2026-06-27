import type {
    BotIdentity,
    LarkChannelError,
    NormalizedMessage,
    SendOptions,
    StreamInput,
} from '@larksuiteoapi/node-sdk';

export type A3sLarkBotIdentity = BotIdentity;
export type A3sLarkChannelError = LarkChannelError;
export type A3sLarkMessage = NormalizedMessage;
export type A3sLarkSendOptions = SendOptions;
export type A3sLarkStreamInput = StreamInput;

export interface A3sLarkChannelCredentials {
    appId: string;
    appSecret: string;
}
