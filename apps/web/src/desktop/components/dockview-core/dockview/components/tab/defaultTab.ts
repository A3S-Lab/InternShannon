import { CompositeDisposable } from "../../../lifecycle";
import { ITabRenderer, GroupPanelPartInitParameters } from "../../types";
import { addDisposableListener } from "../../../events";
import {
	createCloseButton,
	createFileIcon,
	createDirtyDot,
} from "../../../svg";
import "./defaultTab.scss";

export class DefaultTab extends CompositeDisposable implements ITabRenderer {
	private readonly _element: HTMLElement;
	private readonly _content: HTMLElement;
	private readonly _iconContainer: HTMLElement;
	private readonly action: HTMLElement;
	private _title: string | undefined;
	private _isDirty = false;
	private _dirtyDot: SVGSVGElement;

	get element(): HTMLElement {
		return this._element;
	}

	constructor() {
		super();

		this._element = document.createElement("div");
		this._element.className = "dv-default-tab";

		this._iconContainer = document.createElement("div");
		this._iconContainer.className = "dv-default-tab-icon";

		this._content = document.createElement("div");
		this._content.className = "dv-default-tab-content";

		this.action = document.createElement("div");
		this.action.className = "dv-default-tab-action";
		this.action.appendChild(createCloseButton());

		this._dirtyDot = createDirtyDot();
		this._dirtyDot.style.display = "none";

		this._element.appendChild(this._iconContainer);
		this._element.appendChild(this._content);
		this._element.appendChild(this._dirtyDot);
		this._element.appendChild(this.action);

		this.addDisposables(
			addDisposableListener(this.action, "pointerdown", (ev) => {
				ev.preventDefault();
			}),
		);

		this.render();
	}

	init(params: GroupPanelPartInitParameters): void {
		this._title = params.title;

		// Extract file extension from panel ID (which is the file path)
		const panelId = params.api.id;
		const ext = panelId.split(".").pop() || "";
		const icon = createFileIcon(ext);
		this._iconContainer.innerHTML = "";
		this._iconContainer.appendChild(icon);

		this.addDisposables(
			params.api.onDidTitleChange((event) => {
				const wasDirty = this._isDirty;
				// Check if title ends with " *" indicating dirty state
				this._isDirty = event.title.endsWith(" *");
				if (this._isDirty !== wasDirty) {
					this._dirtyDot.style.display = this._isDirty ? "flex" : "none";
					this._dirtyDot.style.color = this._isDirty ? "#569cd6" : "";
				}
				// Update title, removing the " *" suffix for display
				this._title = event.title.replace(/ \*$/, "");
				this.render();
			}),
			addDisposableListener(this.action, "pointerdown", (ev) => {
				ev.preventDefault();
			}),
			addDisposableListener(this.action, "click", (ev) => {
				if (ev.defaultPrevented) {
					return;
				}

				ev.preventDefault();
				params.api.close();
			}),
		);

		this.render();
	}

	private render(): void {
		if (this._content.textContent !== this._title) {
			this._content.textContent = this._title ?? "";
		}
	}
}
