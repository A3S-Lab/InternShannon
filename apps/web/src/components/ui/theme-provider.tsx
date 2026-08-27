import { createContext, useContext, useEffect, type ReactNode } from "react";
import { writeUserStorage } from "@/lib/browser-storage";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
	children: ReactNode;
	defaultTheme?: Theme;
	storageKey?: string;
};

type ThemeProviderState = {
	theme: Theme;
	setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
	theme: "light",
	setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
	children,
	defaultTheme: _defaultTheme = "light",
	storageKey = "vite-ui-theme",
}: ThemeProviderProps) {
	useEffect(() => {
		if (typeof window === "undefined") return;
		const root = window.document.documentElement;
		root.classList.remove("dark");
		root.classList.add("light");
		root.style.colorScheme = "light";
		writeUserStorage(storageKey, "light");
	}, [storageKey]);

	const value = {
		theme: "light" as const,
		setTheme: (_nextTheme: Theme) => writeUserStorage(storageKey, "light"),
	};

	return (
		<ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>
	);
}

export const useTheme = () => {
	const context = useContext(ThemeProviderContext);

	if (context === undefined)
		throw new Error("useTheme must be used within a ThemeProvider");

	return context;
};
