import { TextDecoder } from 'node:util';

const RFC5987_UTF8_PREFIX = /^UTF-8''/i;
const UTF8_PERCENT_ENCODED = /%[0-9a-f]{2}/i;
const CJK_OR_EAST_ASIAN =
	/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/u;
const LATIN1_HIGH_BYTES = /[\u0080-\u00FF]/u;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/u;

const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function normalizeMultipartFileName(value: string | null | undefined): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	if (!value) {
		return value;
	}

	const encoded = decodeRfc5987FileName(value) ?? decodePercentEncodedFileName(value);
	if (encoded) {
		return encoded;
	}

	const latin1Decoded = decodeUtf8BytesMisreadAsLatin1(value);
	if (latin1Decoded && shouldUseLatin1DecodedName(value, latin1Decoded)) {
		return latin1Decoded;
	}

	return value;
}

/**
 * Decode percent-encoded segments inside a workspace-relative path so storage
 * keys stay UTF-8 and list/read responses return readable filenames. Returns
 * the original value when the input either has no percent sequences or fails
 * to decode cleanly (e.g. a literal "100%done.txt").
 *
 * Path separators (`/`) are preserved — frontends typically encode the file
 * name itself, not the slash, but `%2F` would still be decoded to `/` which
 * is the desired flattening (the value is later validated for traversal).
 */
export function normalizeWorkspacePath(value: string | null | undefined): string {
	if (typeof value !== 'string' || !value) {
		return value ?? '';
	}
	if (!UTF8_PERCENT_ENCODED.test(value)) {
		return value;
	}
	const decoded = decodeURIComponentSafe(value);
	if (decoded === undefined || decoded.includes('\0')) {
		return value;
	}
	return decoded;
}

function decodeRfc5987FileName(value: string): string | undefined {
	if (!RFC5987_UTF8_PREFIX.test(value)) {
		return undefined;
	}
	return decodeURIComponentSafe(value.replace(RFC5987_UTF8_PREFIX, ''));
}

function decodePercentEncodedFileName(value: string): string | undefined {
	if (!UTF8_PERCENT_ENCODED.test(value)) {
		return undefined;
	}
	return decodeURIComponentSafe(value);
}

function decodeURIComponentSafe(value: string): string | undefined {
	try {
		const decoded = decodeURIComponent(value);
		return decoded && !decoded.includes('\uFFFD') ? decoded : undefined;
	} catch {
		return undefined;
	}
}

function decodeUtf8BytesMisreadAsLatin1(value: string): string | undefined {
	try {
		return fatalUtf8Decoder.decode(Buffer.from(value, 'latin1'));
	} catch {
		return undefined;
	}
}

function shouldUseLatin1DecodedName(original: string, decoded: string): boolean {
	if (!decoded || decoded === original || decoded.includes('\uFFFD') || decoded.includes('\0')) {
		return false;
	}
	if (CJK_OR_EAST_ASIAN.test(decoded) && LATIN1_HIGH_BYTES.test(original)) {
		return true;
	}
	return CONTROL_CHARS.test(original) && !CONTROL_CHARS.test(decoded);
}
