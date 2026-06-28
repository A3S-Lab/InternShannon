export const KERNEL_MESSAGE_RUN_SERVICE = Symbol('KERNEL_MESSAGE_RUN_SERVICE');

export interface KernelMessageRunInput {
    sessionId: string;
    content: string;
    images?: { mediaType: string; data: string }[];
    model?: string;
    emit: (message: unknown) => void;
}

export interface IKernelMessageRunService {
    run(input: KernelMessageRunInput): Promise<void>;
}
