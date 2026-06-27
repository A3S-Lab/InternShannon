/**
 * Workspace Storage Interface
 * Abstracts file system operations for workspace management.
 * Implementation: LocalFileStorage for the desktop sidecar.
 */
export interface WsDirEntry {
	name: string;
	isDirectory: boolean;
	isFile: boolean;
	size?: number;
	mtimeMs?: number;
	modifiedAt?: string;
	extension?: string;
	isBinary?: boolean;
}

export interface WorkspaceReadiness {
	workspaceRoot: string;
	rootExists: boolean;
	agentsExists: boolean;
	sessionsExists: boolean;
	needsRepair: boolean;
	platform: string;
	isWindows: boolean;
}

export interface WorkspaceUpload {
	uploadId: string;
	ownerId: string;
	fileName: string;
	relativePath?: string;
	path: string;
	workspaceRoot: string;
	mimeType?: string;
	size: number;
	sha256: string;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export const WORKSPACE_STORAGE = Symbol('WORKSPACE_STORAGE');

export type WorkspaceStorageKind = 'local' | 's3';

export interface IWorkspaceStorage {
	readonly storageKind?: WorkspaceStorageKind;

	/**
	 * Get the default workspace root for the active storage provider.
	 * Cloud providers return remote URIs; desktop providers may return local paths.
	 */
	getDefaultRoot(): Promise<string>;

	/**
	 * Inspect workspace readiness (directories exist, permissions OK)
	 */
	inspectReadiness(workspaceRoot?: string): Promise<WorkspaceReadiness>;

	/**
	 * Ensure workspace is ready (create dirs if missing)
	 */
	ensureReadiness(workspaceRoot?: string): Promise<WorkspaceReadiness>;

	/**
	 * Initialize an agent workspace directory with default subdirs
	 * @param workspacePath - path to the agent workspace dir
	 */
	initAgent(workspacePath: string): Promise<void>;

	/**
	 * Create directory and all parent dirs (recursive)
	 */
	mkdir(path: string): Promise<void>;

	/**
	 * Write text file
	 */
	writeFile(path: string, content: string): Promise<void>;

	/**
	 * Read text file
	 */
	readFile(path: string): Promise<string>;

	/**
	 * Check if file/dir exists
	 */
	exists(path: string): Promise<boolean>;

	/**
	 * Get file/directory metadata without reading content or listing directory
	 * @throws Error if path does not exist
	 */
	stat(path: string): Promise<WsDirEntry>;

	/**
	 * Remove file or directory (recursive)
	 */
	remove(path: string): Promise<void>;

	/**
	 * List directory entries
	 */
	readDir(path: string): Promise<WsDirEntry[]>;

	/**
	 * Rename/move file or directory
	 */
	rename(src: string, dest: string): Promise<void>;

	/**
	 * Copy file
	 */
	copyFile(src: string, dest: string): Promise<void>;

	/**
	 * Read binary file
	 */
	readBinaryFile(path: string): Promise<Buffer>;

	/**
	 * Write binary file
	 */
	writeBinaryFile(path: string, data: Buffer): Promise<void>;

	/**
	 * Probe whether the underlying storage backend is reachable, with a short
	 * timeout and optional retries. Implementations that target remote
	 * networked storage implementations MUST implement this so callers can
	 * fail loud at startup if the endpoint is unreachable. Local-filesystem
	 * implementations may leave this undefined.
	 *
	 * @throws when the storage backend is not reachable after all retries.
	 */
	probeReachability?(opts?: { timeoutMs?: number; retries?: number }): Promise<void>;

	/**
	 * Search for text in files
	 */
	searchInFiles(
		rootPath: string,
		query: string,
		options?: {
			caseSensitive?: boolean;
			useRegex?: boolean;
			matchWholeWord?: boolean;
			includePattern?: string;
			excludePattern?: string;
			maxResults?: number;
		}
	): Promise<SearchResult[]>;

	/**
	 * Replace text in files
	 */
	replaceInFiles(
		rootPath: string,
		query: string,
		replacement: string,
		options?: {
			caseSensitive?: boolean;
			useRegex?: boolean;
			matchWholeWord?: boolean;
			includePattern?: string;
			excludePattern?: string;
			filePaths?: string[];
		}
	): Promise<ReplaceResult>;
}

export interface SearchMatch {
	line: number;
	column: number;
	text: string;
	matchStart: number;
	matchEnd: number;
}

export interface SearchResult {
	path: string;
	matches: SearchMatch[];
}

export interface ReplaceResult {
	filesModified: number;
	totalReplacements: number;
	files: Array<{
		path: string;
		replacements: number;
	}>;
}
