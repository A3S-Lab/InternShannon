import { type ReactNode, useRef } from "react";
import type { MutableRefObject } from "react";

/**
 * Route keep-alive compatibility shim.
 * The desktop layout only needs a narrow API surface here, so the
 * implementation intentionally keeps rendering as a no-op wrapper.
 */
export type KeepAliveRef = {
	current?: unknown;
};

export function useKeepAliveRef<T>(): MutableRefObject<T | undefined> {
	return useRef<T | undefined>(undefined);
}

export default function KeepAlive({
	children,
}: {
	children: ReactNode;
	/**
	 * Keep-alive props are accepted for compatibility but are no-op in this
	 * shim implementation.
	 */
	[key: string]: unknown;
}): ReactNode {
	return children;
}
