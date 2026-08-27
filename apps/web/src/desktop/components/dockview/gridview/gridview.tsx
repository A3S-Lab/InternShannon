import React from "react";
import {
	GridviewPanelApi,
	Orientation,
	GridviewApi,
	createGridview,
} from "../../dockview-core";
import { ReactGridPanelView } from "./view";
import { usePortalsLifecycle } from "../react";
import { PanelParameters } from "../types";
export interface GridviewReadyEvent {
	api: GridviewApi;
}

export interface IGridviewPanelProps<T extends { [index: string]: any } = any>
	extends PanelParameters<T> {
	api: GridviewPanelApi;
	containerApi: GridviewApi;
}

export interface IGridviewReactProps {
	orientation?: Orientation;
	onReady: (event: GridviewReadyEvent) => void;
	components: Record<string, React.FunctionComponent<IGridviewPanelProps>>;
	hideBorders?: boolean;
	className?: string;
	proportionalLayout?: boolean;
	disableAutoResizing?: boolean;
}

export const GridviewReact = React.forwardRef(
	(props: IGridviewReactProps, ref: React.ForwardedRef<HTMLDivElement>) => {
		const domRef = React.useRef<HTMLDivElement>(null);
		const gridviewRef = React.useRef<GridviewApi | null>(null);
		const [portals, addPortal] = usePortalsLifecycle();
		const initialPropsRef = React.useRef(props);
		const initialAddPortalRef = React.useRef(addPortal);
		const { components } = props;

		React.useImperativeHandle(ref, () => domRef.current!, []);

		React.useEffect(() => {
			if (!domRef.current) {
				return () => {
					// noop
				};
			}
			const initialProps = initialPropsRef.current;
			const initialAddPortal = initialAddPortalRef.current;

			const api = createGridview(domRef.current, {
				disableAutoResizing: initialProps.disableAutoResizing,
				proportionalLayout:
					typeof initialProps.proportionalLayout === "boolean"
						? initialProps.proportionalLayout
						: true,
				orientation: initialProps.orientation ?? Orientation.HORIZONTAL,
				frameworkComponents: initialProps.components,
				frameworkComponentFactory: {
					createComponent: (id: string, componentId, component) => {
						return new ReactGridPanelView(id, componentId, component, {
							addPortal: initialAddPortal,
						});
					},
				},
				styles: initialProps.hideBorders
					? { separatorBorder: "transparent" }
					: undefined,
			});

			const { clientWidth, clientHeight } = domRef.current;
			api.layout(clientWidth, clientHeight);

			if (initialProps.onReady) {
				initialProps.onReady({ api });
			}

			gridviewRef.current = api;

			return () => {
				api.dispose();
			};
		}, []);

		React.useEffect(() => {
			if (!gridviewRef.current) {
				return;
			}
			gridviewRef.current.updateOptions({
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
GridviewReact.displayName = "GridviewComponent";
