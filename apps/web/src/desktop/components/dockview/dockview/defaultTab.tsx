import React from "react";
import { CloseButton } from "../svg";
import {
	DockviewPanelApi,
	IDockviewPanelHeaderProps,
} from "../../dockview-core";

function useTitle(api: DockviewPanelApi): string | undefined {
	const [title, setTitle] = React.useState(api.title);

	React.useEffect(() => {
		const disposable = api.onDidTitleChange((event) => {
			setTitle((current) => (current === event.title ? current : event.title));
		});

		return () => {
			disposable.dispose();
		};
	}, [api]);

	return title;
}

export type IDockviewDefaultTabProps = IDockviewPanelHeaderProps &
	React.DOMAttributes<HTMLDivElement> & {
		hideClose?: boolean;
		closeActionOverride?: () => void;
	};

export const DockviewDefaultTab: React.FunctionComponent<
	IDockviewDefaultTabProps
> = ({
	api,
	containerApi: _containerApi,
	params: _params,
	hideClose,
	closeActionOverride,
	onClick: externalOnClick,
	onKeyDown: externalOnKeyDown,
	...rest
}) => {
	const title = useTitle(api);

	const onClose = React.useCallback(
		(event: React.MouseEvent<HTMLSpanElement>) => {
			event.preventDefault();

			if (closeActionOverride) {
				closeActionOverride();
			} else {
				api.close();
			}
		},
		[api, closeActionOverride],
	);

	const onPointerDown = React.useCallback((e: React.MouseEvent) => {
		e.preventDefault();
	}, []);

	const onClick = React.useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (event.defaultPrevented) {
				return;
			}

			api.setActive();

			if (externalOnClick) {
				externalOnClick(event);
			}
		},
		[api, externalOnClick],
	);
	const onKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			externalOnKeyDown?.(event);
			if (
				event.defaultPrevented ||
				(event.key !== "Enter" && event.key !== " ")
			) {
				return;
			}
			event.preventDefault();
			api.setActive();
		},
		[api, externalOnKeyDown],
	);

	return (
		<div
			data-testid="dockview-dv-default-tab"
			data-panel-id={api.id}
				{...rest}
				onClick={onClick}
				onKeyDown={onKeyDown}
				role="tab"
				tabIndex={0}
				className="dv-default-tab"
		>
			<span className="dv-default-tab-content">{title}</span>
			{!hideClose && (
					<button
						type="button"
						className="dv-default-tab-action"
						onPointerDown={onPointerDown}
						onClick={onClose}
						aria-label="Close panel"
					>
						<CloseButton />
					</button>
			)}
		</div>
	);
};
