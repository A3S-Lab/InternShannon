import React from "react";
import {
	PaneviewPanelApi,
	PaneviewDndOverlayEvent,
	PaneviewApi,
	PaneviewDropEvent,
	createPaneview,
} from "../../dockview-core";
import { usePortalsLifecycle } from "../react";
import { PanePanelSection } from "./view";
import { PanelParameters } from "../types";

export interface PaneviewReadyEvent {
	api: PaneviewApi;
}

export interface IPaneviewPanelProps<T extends { [index: string]: any } = any>
	extends PanelParameters<T> {
	api: PaneviewPanelApi;
	containerApi: PaneviewApi;
	title: string;
}

export interface IPaneviewReactProps {
	onReady: (event: PaneviewReadyEvent) => void;
	components: Record<string, React.FunctionComponent<IPaneviewPanelProps>>;
	headerComponents?: Record<
		string,
		React.FunctionComponent<IPaneviewPanelProps>
	>;
	className?: string;
	disableAutoResizing?: boolean;
	disableDnd?: boolean;
	showDndOverlay?: (event: PaneviewDndOverlayEvent) => boolean;
	onDidDrop?(event: PaneviewDropEvent): void;
}

export const PaneviewReact = React.forwardRef(
	(props: IPaneviewReactProps, ref: React.ForwardedRef<HTMLDivElement>) => {
		const domRef = React.useRef<HTMLDivElement>(null);
		const paneviewRef = React.useRef<PaneviewApi | null>(null);
		const [portals, addPortal] = usePortalsLifecycle();
		const initialPropsRef = React.useRef(props);
		const initialAddPortalRef = React.useRef(addPortal);
		const { components, headerComponents, onDidDrop, showDndOverlay } = props;

		React.useImperativeHandle(ref, () => domRef.current!, []);

		React.useEffect(() => {
			const initialProps = initialPropsRef.current;
			const initialAddPortal = initialAddPortalRef.current;
			const createComponent = (
				id: string,
				_componentId: string,
				component: any,
			) =>
				new PanePanelSection(id, component, {
					addPortal: initialAddPortal,
				});

			const api = createPaneview(domRef.current!, {
				disableAutoResizing: initialProps.disableAutoResizing,
				frameworkComponents: initialProps.components,
				components: {},
				headerComponents: {},
				disableDnd: initialProps.disableDnd,
				headerframeworkComponents: initialProps.headerComponents,
				frameworkWrapper: {
					header: {
						createComponent,
					},
					body: {
						createComponent,
					},
				},
				showDndOverlay: initialProps.showDndOverlay,
			});

			const { clientWidth, clientHeight } = domRef.current!;
			api.layout(clientWidth, clientHeight);

			if (initialProps.onReady) {
				initialProps.onReady({ api });
			}

			paneviewRef.current = api;

			// Re-layout after a frame to handle cases where the container
			// dimensions aren't final during initial mount (e.g. dialog animations)
			let rafId = requestAnimationFrame(() => {
				if (domRef.current) {
					const { clientWidth: w, clientHeight: h } = domRef.current;
					if (w > 0 && h > 0 && (w !== clientWidth || h !== clientHeight)) {
						api.layout(w, h);
					}
				}
			});

			return () => {
				cancelAnimationFrame(rafId);
				api.dispose();
			};
		}, []);

		React.useEffect(() => {
			if (!paneviewRef.current) {
				return;
			}
			paneviewRef.current.updateOptions({
					frameworkComponents: components,
			});
		}, [components]);

		React.useEffect(() => {
			if (!paneviewRef.current) {
				return;
			}
			paneviewRef.current.updateOptions({
					headerframeworkComponents: headerComponents,
			});
		}, [headerComponents]);

		React.useEffect(() => {
			if (!paneviewRef.current) {
				return () => {
					//
				};
			}

			const api = paneviewRef.current;

			const disposable = api.onDidDrop((event) => {
				if (onDidDrop) {
					onDidDrop({
						...event,
						api,
					});
				}
			});

			return () => {
				disposable.dispose();
			};
		}, [onDidDrop]);

		React.useEffect(() => {
			if (!paneviewRef.current) {
				return;
			}
			paneviewRef.current.updateOptions({
					showDndOverlay,
			});
		}, [showDndOverlay]);

		return (
			<div
				className={props.className}
				style={{ height: "100%", width: "100%" }}
				ref={domRef}
			>
				{portals}
			</div>
		);
	},
);
PaneviewReact.displayName = "PaneviewComponent";
