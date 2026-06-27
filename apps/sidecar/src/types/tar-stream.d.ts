declare module 'tar-stream' {
    import { Readable } from 'node:stream';

    interface PackEntryHeader {
        name: string;
        mode?: number;
        size?: number;
        type?: 'file' | 'directory' | 'symlink';
    }

    export interface Pack extends Readable {
        entry(header: PackEntryHeader, content: Buffer | string): void;
        finalize(): void;
    }

    export function pack(): Pack;
}
