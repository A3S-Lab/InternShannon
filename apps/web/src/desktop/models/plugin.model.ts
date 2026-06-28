import { onUserStorageScopeChange, readUserJsonStorage, writeUserJsonStorage } from "@/lib/browser-storage";
import { proxy } from "valtio";

export interface Plugin {
	id: string;
	name: string;
	description: string;
	icon: string; // lucide icon name
	path: string; // route path
	installed: boolean;
	category: string; // plugin category
	remoteUrl?: string; // remote component URL (optional, for remote plugins)
}

const STORAGE_KEY = "internshannon-plugins-v1";
const ORDER_KEY = "internshannon-plugins-order-v1";

const AVAILABLE_PLUGINS: Plugin[] = [];

function loadOrder(): string[] {
	try {
			return readUserJsonStorage<string[]>(ORDER_KEY, []);
	} catch {
		/* ignore */
	}
	return [];
}

function load(): Plugin[] {
	try {
		const order = loadOrder();
		let plugins = AVAILABLE_PLUGINS.map((p) => ({ ...p }));
			const installedIds = readUserJsonStorage<string[] | null>(STORAGE_KEY, null);
		if (installedIds) {
			plugins = plugins.map((p) => ({
				...p,
				installed: installedIds.includes(p.id),
			}));
		}
		if (order.length > 0) {
			plugins.sort((a, b) => {
				const ai = order.indexOf(a.id);
				const bi = order.indexOf(b.id);
				if (ai === -1 && bi === -1) return 0;
				if (ai === -1) return 1;
				if (bi === -1) return -1;
				return ai - bi;
			});
		}
		return plugins;
	} catch {
		/* ignore */
	}
	return AVAILABLE_PLUGINS.map((p) => ({ ...p }));
}

function persist() {
	try {
		const installedIds = state.plugins
			.filter((p) => p.installed)
			.map((p) => p.id);
			writeUserJsonStorage(STORAGE_KEY, installedIds);
	} catch {
		/* ignore */
	}
}

function persistOrder() {
	try {
		const order = state.plugins.map((p) => p.id);
			writeUserJsonStorage(ORDER_KEY, order);
	} catch {
		/* ignore */
	}
}

const state = proxy<{ plugins: Plugin[] }>({ plugins: load() });

onUserStorageScopeChange(() => {
	state.plugins = load();
});

const actions = {
	install(id: string) {
		const p = state.plugins.find((p) => p.id === id);
		if (p) {
			p.installed = true;
			persist();
		}
	},

	uninstall(id: string) {
		const p = state.plugins.find((p) => p.id === id);
		if (p) {
			p.installed = false;
			persist();
		}
	},

	reorder(fromId: string, toId: string) {
		const plugins = state.plugins;
		const fromIdx = plugins.findIndex((p) => p.id === fromId);
		const toIdx = plugins.findIndex((p) => p.id === toId);
		if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
		const [item] = plugins.splice(fromIdx, 1);
		plugins.splice(toIdx, 0, item);
		persistOrder();
	},

	installedPlugins() {
		return state.plugins.filter((p) => p.installed);
	},
};

export default { state, ...actions };
