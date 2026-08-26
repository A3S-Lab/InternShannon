export interface EditorLoadIdentityInput {
	path?: string;
	contentVersion?: string;
	externalContentVersion?: string;
}

export function createEditorLoadIdentity({
	path,
	contentVersion,
	externalContentVersion,
}: EditorLoadIdentityInput): string {
	return [path ?? "", contentVersion ?? "", externalContentVersion ?? ""].join(
		"\u0000",
	);
}

export function hasPendingEditorSave(
	localDirty: boolean,
	panelDirty: boolean | undefined,
): boolean {
	return localDirty || panelDirty === true;
}

export function hasEditorBufferChanged(
	currentContent: string,
	lastPersistedContent: string,
): boolean {
	return currentContent !== lastPersistedContent;
}
