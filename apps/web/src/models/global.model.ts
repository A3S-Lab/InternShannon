import { workspaceAssetPath } from "@/lib/constants";
import { onUserStorageScopeChange, readUserJsonStorage, writeUserJsonStorage } from "@/lib/browser-storage";
import { proxy, subscribe } from "valtio";

// =============================================================================
// Profile persistence
// =============================================================================

interface User {
	id: number;
	nickname: string;
	email: string;
	avatar: string;
}

const PROFILE_KEY = "internshannon-profile";

interface ProfileData {
	nickname: string;
	avatar: string;
	isOnboarded: boolean;
}

const DEFAULT_PROFILE: ProfileData = {
	nickname: "",
	avatar: workspaceAssetPath("logo.png"),
	isOnboarded: false,
};

function loadProfile(): ProfileData {
	try {
			const saved = readUserJsonStorage<Partial<ProfileData> | null>(PROFILE_KEY, null);
		if (saved) return { ...DEFAULT_PROFILE, ...saved };
	} catch {
		// ignore
	}
	return DEFAULT_PROFILE;
}

const saved = loadProfile();

const state = proxy<{ user: User; isOnboarded: boolean }>({
	user: {
		id: 1,
		nickname: saved.nickname,
		email: "",
		avatar: saved.avatar,
	},
	isOnboarded: saved.isOnboarded,
});

subscribe(state, () => {
	try {
			writeUserJsonStorage(PROFILE_KEY, {
			nickname: state.user.nickname,
			avatar: state.user.avatar,
			isOnboarded: state.isOnboarded,
		});
	} catch {
		// Storage unavailable
	}
});

onUserStorageScopeChange(() => {
	const profile = loadProfile();
	state.user.nickname = profile.nickname;
	state.user.avatar = profile.avatar;
	state.isOnboarded = profile.isOnboarded;
});

const actions = {
	setProfile: (nickname: string, avatar: string) => {
		state.user.nickname = nickname;
		state.user.avatar = avatar || DEFAULT_PROFILE.avatar;
		state.isOnboarded = true;
	},
	reopenOnboarding: () => {
		state.isOnboarded = false;
	},
	load: async () => {
		return { user: state.user };
	},
};

export default {
	state,
	...actions,
};
