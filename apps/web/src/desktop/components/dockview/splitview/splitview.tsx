import React from "react";
import {
	SplitviewApi,
	SplitviewPanelApi,
	Orientation,
	createSplitview,
} from "../../dockview-core";
import { usePortalsLifecycle } from "../react";
import { PanelParameters } from "../types";
import { ReactPanelView } from "./view";

export interface SplitviewReadyEvent {
	api: SplitviewApi;
}

export interface ISplitviewPanelProps<T extends { [index: string]: any } = any>
	extends PanelParameters<T> {
	api: SplitviewPanelApi;
	containerApi: SplitviewApi;
}

export interface ISplitviewReactProps {
	orientation?: Orientation;
	onReady: (event: SplitviewReadyEvent) => void;
	components: Record<string, React.FunctionComponent<ISplitviewPanelProps>>;
	proportionalLayout?: boolean;
	hideBorders?: boolean;
	className?: string;
	disableAutoResizing?: boolean;
}

export const SplitviewReact = React.forwardRef(
	(props: ISplitviewReactProps, ref: React.ForwardedRef<HTMLDivElement>) => {
		const domRef = React.useRef<HTMLDivElement>(null);
		const splitviewRef = React.useRef<SplitviewApi | null>(null);
		const [portals, addPortal] = usePortalsLifecycle();
		const initialPropsRef = React.useRef(props);
		const initialAddPortalRef = React.useRef(addPortal);
		const { components } = props;

		React.useImperativeHandle(ref, () => domRef.current!, []);

		React.useEffect(() => {
			const initialProps = initialPropsRef.current;
			const initialAddPortal = initialAddPortalRef.current;
			const api = createSplitview(domRef.current!, {
				disableAutoResizing: initialProps.disableAutoResizing,
				orientation: initialProps.orientation ?? Orientation.HORIZONTAL,
				frameworkComponents: initialProps.components,
				frameworkWrapper: {
					createComponent: (id: string, componentId, component: any) => {
						return new ReactPanelView(id, componentId, component, {
							addPortal: initialAddPortal,
						});
					},
				},
				proportionalLayout:
					typeof initialProps.proportionalLayout === "boolean"
						? initialProps.proportionalLayout
						: true,
				styles: initialProps.hideBorders
					? { separatorBorder: "transparent" }
					: undefined,
			});

			const { clientWidth, clientHeight } = domRef.current!;
			api.layout(clientWidth, clientHeight);

			if (initialProps.onReady) {
				initialProps.onReady({ api });
			}

			splitviewRef.current = api;

			return () => {
				api.dispose();
			};
		}, []);

		React.useEffect(() => {
			if (!splitviewRef.current) {
				return;
			}
			splitviewRef.current.updateOptions({
					frameworkComponents: components,
			});
		}, [components]);

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
SplitviewReact.displayName = "SplitviewComponent";
