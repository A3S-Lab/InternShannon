import React from "react";
import {
	DockviewWillDropEvent,
	DockviewApi,
	DockviewGroupPanel,
	IHeaderActionsRenderer,
	DockviewDidDropEvent,
	IWatermarkPanelProps,
	IDockviewHeaderActionsProps,
	IDockviewPanelHeaderProps,
	IDockviewPanelProps,
	DockviewOptions,
	PROPERTY_KEYS,
	DockviewComponentOptions,
	DockviewFrameworkOptions,
	DockviewReadyEvent,
	createDockview,
} from "../../dockview-core";
import { ReactPanelContentPart } from "./reactContentPart";
import { ReactPanelHeaderPart } from "./reactHeaderPart";
import { ReactPortalStore, usePortalsLifecycle } from "../react";
import { ReactWatermarkPart } from "./reactWatermarkPart";
import { ReactHeaderActionsRendererPart } from "./headerActionsRenderer";

function createGroupControlElement(
	component: React.FunctionComponent<IDockviewHeaderActionsProps> | undefined,
	store: ReactPortalStore,
): ((groupPanel: DockviewGroupPanel) => IHeaderActionsRenderer) | undefined {
	return component
		? (groupPanel: DockviewGroupPanel) => {
				return new ReactHeaderActionsRendererPart(component, store, groupPanel);
			}
		: undefined;
}

const DEFAULT_REACT_TAB = "props.defaultTabComponent";

export interface IDockviewReactProps extends DockviewOptions {
	className?: string;
	tabComponents?: Record<
		string,
		React.FunctionComponent<IDockviewPanelHeaderProps>
	>;
	components: Record<string, React.FunctionComponent<IDockviewPanelProps>>;
	watermarkComponent?: React.FunctionComponent<IWatermarkPanelProps>;
	defaultTabComponent?: React.FunctionComponent<IDockviewPanelHeaderProps>;
	rightHeaderActionsComponent?: React.FunctionComponent<IDockviewHeaderActionsProps>;
	leftHeaderActionsComponent?: React.FunctionComponent<IDockviewHeaderActionsProps>;
	prefixHeaderActionsComponent?: React.FunctionComponent<IDockviewHeaderActionsProps>;
	//
	onReady: (event: DockviewReadyEvent) => void;
	onDidDrop?: (event: DockviewDidDropEvent) => void;
	onWillDrop?: (event: DockviewWillDropEvent) => void;
}

function extractCoreOptions(props: IDockviewReactProps): DockviewOptions {
	const coreOptions = PROPERTY_KEYS.reduce(
		(obj, key) => {
			if (key in props) {
				obj[key] = props[key] as any;
			}
			return obj;
		},
		{} as Partial<DockviewComponentOptions>,
	);

	return coreOptions as DockviewOptions;
}

export const DockviewReact = React.forwardRef(
	(props: IDockviewReactProps, ref: React.ForwardedRef<HTMLDivElement>) => {
		const domRef = React.useRef<HTMLDivElement>(null);
		const dockviewRef = React.useRef<DockviewApi | null>(null);
		const [portals, addPortal] = usePortalsLifecycle();
		const initialPropsRef = React.useRef(props);
		const initialAddPortalRef = React.useRef(addPortal);
		const {
			components,
			defaultTabComponent,
			leftHeaderActionsComponent,
			onDidDrop,
			onWillDrop,
			prefixHeaderActionsComponent,
			rightHeaderActionsComponent,
			tabComponents,
			watermarkComponent,
		} = props;

		React.useImperativeHandle(ref, () => domRef.current!, []);

		const prevProps = React.useRef<Partial<IDockviewReactProps>>({});

		React.useEffect(() => {
			const changes: Partial<DockviewOptions> = {};

			PROPERTY_KEYS.forEach((propKey) => {
				const key = propKey;
				const propValue = props[key];

				if (key in props && propValue !== prevProps.current[key]) {
					changes[key] = propValue as any;
				}
			});

			if (dockviewRef.current && Object.keys(changes).length > 0) {
				dockviewRef.current.updateOptions(changes);
			}

			prevProps.current = props;
		});

		React.useEffect(() => {
			if (!domRef.current) {
				return;
			}
			const initialProps = initialPropsRef.current;
			const initialAddPortal = initialAddPortalRef.current;

			const frameworkTabComponents = initialProps.tabComponents ?? {};

			if (initialProps.defaultTabComponent) {
				frameworkTabComponents[DEFAULT_REACT_TAB] =
					initialProps.defaultTabComponent;
			}

			const frameworkOptions: DockviewFrameworkOptions = {
				createLeftHeaderActionComponent: createGroupControlElement(
					initialProps.leftHeaderActionsComponent,
					{ addPortal: initialAddPortal },
				),
				createRightHeaderActionComponent: createGroupControlElement(
					initialProps.rightHeaderActionsComponent,
					{ addPortal: initialAddPortal },
				),
				createPrefixHeaderActionComponent: createGroupControlElement(
					initialProps.prefixHeaderActionsComponent,
					{ addPortal: initialAddPortal },
				),
				createComponent: (options) => {
					return new ReactPanelContentPart(
						options.id,
						initialProps.components[options.name],
						{
							addPortal: initialAddPortal,
						},
					);
				},
				createTabComponent(options) {
					return new ReactPanelHeaderPart(
						options.id,
						frameworkTabComponents[options.name],
						{
							addPortal: initialAddPortal,
						},
					);
				},
				createWatermarkComponent: initialProps.watermarkComponent
					? () => {
							return new ReactWatermarkPart(
								"watermark",
								initialProps.watermarkComponent!,
								{
									addPortal: initialAddPortal,
								},
							);
						}
					: undefined,
				defaultTabComponent: initialProps.defaultTabComponent
					? DEFAULT_REACT_TAB
					: undefined,
			};

			const api = createDockview(domRef.current, {
				...extractCoreOptions(initialProps),
				...frameworkOptions,
			});

			const { clientWidth, clientHeight } = domRef.current;
			api.layout(clientWidth, clientHeight);

			if (initialProps.onReady) {
				initialProps.onReady({ api });
			}

			dockviewRef.current = api;

			// Re-layout after a frame to handle dialog animation timing
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
			if (!dockviewRef.current) {
				return () => {
					// noop
				};
			}

			const disposable = dockviewRef.current.onDidDrop((event) => {
				if (onDidDrop) {
					onDidDrop(event);
				}
			});

			return () => {
				disposable.dispose();
			};
		}, [onDidDrop]);

		React.useEffect(() => {
			if (!dockviewRef.current) {
				return () => {
					// noop
				};
			}

			const disposable = dockviewRef.current.onWillDrop((event) => {
				if (onWillDrop) {
					onWillDrop(event);
				}
			});

			return () => {
				disposable.dispose();
			};
		}, [onWillDrop]);

		React.useEffect(() => {
			if (!dockviewRef.current) {
				return;
			}

			dockviewRef.current.updateOptions({
				createComponent: (options) => {
					return new ReactPanelContentPart(
						options.id,
						components[options.name],
						{
							addPortal,
						},
					);
				},
			});
		}, [addPortal, components]);

		React.useEffect(() => {
			if (!dockviewRef.current) {
				return;
			}

			const frameworkTabComponents = tabComponents ?? {};

			if (defaultTabComponent) {
				frameworkTabComponents[DEFAULT_REACT_TAB] = defaultTabComponent;
			}

			dockviewRef.current.updateOptions({
				defaultTabComponent: defaultTabComponent
					? DEFAULT_REACT_TAB
					: undefined,
				createTabComponent(options) {
					return new ReactPanelHeaderPart(
						options.id,
						frameworkTabComponents[options.name],
						{
							addPortal,
						},
					);
				},
			});
		}, [addPortal, defaultTabComponent, tabComponents]);

		React.useEffect(() => {
			if (!dockviewRef.current) {
				return;
			}

			dockviewRef.current.updateOptions({
				createWatermarkComponent: watermarkComponent
					? () => {
							return new ReactWatermarkPart(
								"watermark",
								watermarkComponent!,
								{
									addPortal,
								},
							);
						}
					: undefined,
			});
		}, [addPortal, watermarkComponent]);

		React.useEffect(() => {
			if (!dockviewRef.current) {
				return;
			}
			dockviewRef.current.updateOptions({
				createRightHeaderActionComponent: createGroupControlElement(
					rightHeaderActionsComponent,
					{ addPortal },
				),
			});
		}, [addPortal, rightHeaderActionsComponent]);

		React.useEffect(() => {
			if (!dockviewRef.current) {
				return;
			}
			dockviewRef.current.updateOptions({
				createLeftHeaderActionComponent: createGroupControlElement(
					leftHeaderActionsComponent,
					{ addPortal },
				),
			});
		}, [addPortal, leftHeaderActionsComponent]);

		React.useEffect(() => {
			if (!dockviewRef.current) {
				return;
			}
			dockviewRef.current.updateOptions({
				createPrefixHeaderActionComponent: createGroupControlElement(
					prefixHeaderActionsComponent,
					{ addPortal },
				),
			});
		}, [addPortal, prefixHeaderActionsComponent]);

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
DockviewReact.displayName = "DockviewComponent";
