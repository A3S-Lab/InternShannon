/**
 * Global command registry — the single source of truth for all editor commands.
 * Inspired by VS Code's CommandsRegistry.
 *
 * Usage:
 *   CommandRegistry.registerCommand("editor.bold", handler, { label: "加粗", category: "格式" });
 *   CommandRegistry.executeCommand("editor.bold");
 */

export interface CommandDescriptor {
	id: string;
	label: string;
	category: string;
	defaultKey?: string;
	when?: string;
}

export type CommandHandler<Args extends unknown[] = unknown[]> = (
	accessor: ServicesAccessor,
	...args: Args
) => void | Promise<void>;

export interface ServicesAccessor {
	get(serviceId: string): unknown;
}

export interface IDisposable {
	dispose(): void;
}

type Listener = (commandId: string) => void;

class CommandRegistryImpl {
	private _descriptors = new Map<string, CommandDescriptor>();
	private _handlers = new Map<string, CommandHandler[]>();
	private _listeners = new Set<Listener>();

	registerCommand<Args extends unknown[] = unknown[]>(
		id: string,
		handler: CommandHandler<Args>,
		descriptor?: CommandDescriptor,
	): IDisposable {
		if (descriptor) {
			this._descriptors.set(id, descriptor);
		}

		const handlers = this._handlers.get(id) ?? [];
		handlers.push(handler as CommandHandler);
		this._handlers.set(id, handlers);

		return {
			dispose: () => {
				const hs = this._handlers.get(id);
				if (hs) {
					const idx = hs.indexOf(handler as CommandHandler);
					if (idx !== -1) hs.splice(idx, 1);
					if (hs.length === 0) this._handlers.delete(id);
				}
			},
		};
	}

	onDidExecuteCommand(listener: Listener): IDisposable {
		this._listeners.add(listener);
		return { dispose: () => this._listeners.delete(listener) };
	}

	async executeCommand<R = unknown>(
		id: string,
		...args: unknown[]
	): Promise<R | undefined> {
		const handlers = this._handlers.get(id);
		if (!handlers || handlers.length === 0) {
			console.warn(`[CommandRegistry] No command handler for "${id}"`);
			return undefined;
		}
		const accessor: ServicesAccessor = {
			get: (_serviceId: string) => undefined,
		};
		this._listeners.forEach((l) => l(id));
		// Use the most recently registered handler (last in list)
		const handler = handlers[handlers.length - 1];
		try {
			const result = (handler as CommandHandler)(accessor, ...args);
			if (result instanceof Promise) {
				return (await result) as R;
			}
			return result as R;
		} catch (err) {
			console.error(`[CommandRegistry] Error executing "${id}":`, err);
			return undefined;
		}
	}

	getCommand(id: string): CommandDescriptor | undefined {
		return this._descriptors.get(id);
	}

	getAllCommands(): CommandDescriptor[] {
		return Array.from(this._descriptors.values());
	}

	getCommandsByCategory(): Map<string, CommandDescriptor[]> {
		const map = new Map<string, CommandDescriptor[]>();
		for (const cmd of this._descriptors.values()) {
			const list = map.get(cmd.category) ?? [];
			list.push(cmd);
			map.set(cmd.category, list);
		}
		return map;
	}
}

export const CommandRegistry = new CommandRegistryImpl();
