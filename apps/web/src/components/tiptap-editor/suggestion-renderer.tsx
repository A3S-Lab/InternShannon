import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
/**
 * Renders the suggestion popup using React portal.
 * Used by both @mention and /slash-command extensions.
 */
import type React from "react";
import { type Root, createRoot } from "react-dom/client";
import MentionList, {
	type MentionListRef,
	type SuggestionItem,
} from "./mention-list";

/** Max popup height — must match max-h-64 (256px) in MentionList */
const POPUP_MAX_HEIGHT = 260;
const GAP = 4;

// Track containers that already have a React root to prevent double-mount
const containerRoots = new WeakMap<HTMLDivElement, Root>();

function positionContainer(container: HTMLDivElement, rect: DOMRect | null) {
	if (!rect) return;

	const spaceBelow = window.innerHeight - rect.bottom;
	const spaceAbove = rect.top;

	// Flip above if not enough room below
	if (spaceBelow < POPUP_MAX_HEIGHT + GAP && spaceAbove > spaceBelow) {
		container.style.top = "";
		container.style.bottom = `${window.innerHeight - rect.top + GAP}px`;
	} else {
		container.style.bottom = "";
		container.style.top = `${rect.bottom + GAP}px`;
	}

	// Clamp left so popup doesn't overflow right edge
	const popupWidth = 288; // w-72 = 18rem = 288px
	const left = Math.min(rect.left, window.innerWidth - popupWidth - 8);
	container.style.left = `${Math.max(8, left)}px`;
}

export function createSuggestionRenderer(
	getItems: (query: string) => SuggestionItem[],
	onSelect?: () => void,
	onFolderClick?: (item: SuggestionItem) => void,
	onOpen?: () => void,
	suggestionOpenRef?: React.MutableRefObject<boolean>,
	enableSearch?: boolean,
	workspaceDirRef?: React.MutableRefObject<string>,
): Pick<SuggestionOptions<SuggestionItem>, "items" | "render"> {
	return {
		items: ({ query }) => getItems(query),
		render: () => {
			let component: MentionListRef | null = null;
			let container: HTMLDivElement | null = null;
			let root: Root | null = null;
			let currentQuery = "";
			let updateScheduled = false;
			let currentCommandFn: ((item: SuggestionItem) => void) | null = null;

			// Wrapped command that calls the current command function
			const wrappedCommand = (item: SuggestionItem) => {
				onSelect?.();
				// Capture command fn synchronously before onExit can null it
				const cmdFn = currentCommandFn;
				if (!cmdFn) return;
				// queueMicrotask: runs after current sync code, before paint.
				// Gives TipTap suggestion plugin time to settle before we modify editor state.
				queueMicrotask(() => {
					try {
						cmdFn(item);
					} catch (err) {
						console.error("[SuggestionRenderer] command error:", err);
					}
				});
			};

			// Wrapped folder click handler that triggers re-render
			const wrappedFolderClick = (item: SuggestionItem) => {
				if (!root || !container || !onFolderClick) return;
				onFolderClick(item);

				if (updateScheduled) return;
				updateScheduled = true;
				requestAnimationFrame(() => {
					updateScheduled = false;
					if (!root || !container) return;
					root.render(
						<MentionList
							ref={(ref) => {
								component = ref;
							}}
							items={getItems(currentQuery)}
							command={wrappedCommand}
							onFolderClick={wrappedFolderClick}
							enableSearch={enableSearch}
							onClose={destroy}
							workspaceDir={workspaceDirRef?.current}
						/>,
					);
				});
			};

			return {
				onStart: (props: SuggestionProps<SuggestionItem>) => {
					// Mark suggestion menu as open
					if (suggestionOpenRef) {
						suggestionOpenRef.current = true;
					}

					// Trigger refresh callback when panel opens
					currentQuery = props.query || "";
					currentCommandFn = props.command;

					// Destroy any existing root first (handles rapid re-trigger)
					destroy();

					container = document.createElement("div");
					container.style.position = "fixed";
					container.style.zIndex = "9999";

					positionContainer(container, props.clientRect?.() ?? null);
					document.body.appendChild(container);

					// Guard against double-root: if the container already has a root, remove it
					const existingRoot = containerRoots.get(container);
					if (existingRoot) {
						existingRoot.unmount();
						container.remove();
						container = document.createElement("div");
						container.style.position = "fixed";
						container.style.zIndex = "9999";
						positionContainer(container, props.clientRect?.() ?? null);
						document.body.appendChild(container);
					}

					root = createRoot(container);
					containerRoots.set(container, root);

					// Initial render with current items
					root.render(
						<MentionList
							ref={(ref) => {
								component = ref;
							}}
							items={props.items}
							command={wrappedCommand}
							onFolderClick={wrappedFolderClick}
							enableSearch={enableSearch}
							onClose={destroy}
							workspaceDir={workspaceDirRef?.current}
						/>,
					);

					// Call onOpen and wait for it to complete, then re-render
					if (onOpen) {
						Promise.resolve(onOpen()).then(() => {
							if (!root || !container) return;
							requestAnimationFrame(() => {
								if (!root || !container) return;
								root.render(
									<MentionList
										ref={(ref) => {
											component = ref;
										}}
										items={getItems(currentQuery)}
										command={wrappedCommand}
										onFolderClick={wrappedFolderClick}
										enableSearch={enableSearch}
										onClose={destroy}
										workspaceDir={workspaceDirRef?.current}
									/>,
								);
							});
						});
					}
				},

				onUpdate: (props: SuggestionProps<SuggestionItem>) => {
					if (!root || !container) return;

					currentQuery = props.query || "";
					currentCommandFn = props.command;

					positionContainer(container, props.clientRect?.() ?? null);

					root.render(
						<MentionList
							ref={(ref) => {
								component = ref;
							}}
							items={props.items}
							command={wrappedCommand}
							onFolderClick={wrappedFolderClick}
							enableSearch={enableSearch}
							onClose={destroy}
							workspaceDir={workspaceDirRef?.current}
						/>,
					);
				},

				onKeyDown: (props: { event: KeyboardEvent }) => {
					if (props.event.key === "Escape") {
						destroy();
						return true;
					}
					// If component is ready, delegate to it
					if (component) {
						return component.onKeyDown(props);
					}
					// If component is not ready yet but we have items, intercept Enter/Tab
					// to prevent submitting the form before the suggestion is selected
					if (props.event.key === "Enter" || props.event.key === "Tab") {
						return true;
					}
					return false;
				},

				onExit: () => {
					// Mark suggestion menu as closed
					if (suggestionOpenRef) {
						suggestionOpenRef.current = false;
					}
					// Reset command fn so stale calls are ignored
					currentCommandFn = null;
					destroy();
				},
			};

			function destroy() {
				if (!root || !container) return;
				const r = root;
				const c = container;
				root = null;
				container = null;
				r.unmount();
				c.remove();
				containerRoots.delete(c);
			}
		},
	};
}
