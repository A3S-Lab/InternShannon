import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onUserStorageScopeChange, readUserStorage, writeUserStorage } from "@/lib/browser-storage";

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
	theme: "system",
	setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

function isTheme(value: string | null): value is Theme {
	return value === "dark" || value === "light" || value === "system";
}

export function ThemeProvider({
	children,
	defaultTheme = "system",
	storageKey = "vite-ui-theme",
}: ThemeProviderProps) {
	const [theme, setTheme] = useState<Theme>(() => {
		const storedTheme = readUserStorage(storageKey);
		return isTheme(storedTheme) ? storedTheme : defaultTheme;
	});

	useEffect(() => {
		return onUserStorageScopeChange(() => {
			const storedTheme = readUserStorage(storageKey);
			setTheme(isTheme(storedTheme) ? storedTheme : defaultTheme);
		});
	}, [defaultTheme, storageKey]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const root = window.document.documentElement;
		const mediaQuery = typeof window.matchMedia === "function"
			? window.matchMedia("(prefers-color-scheme: dark)")
			: null;

		const applyTheme = (nextTheme: Theme) => {
			root.classList.remove("light", "dark");

			if (nextTheme === "system") {
				root.classList.add(mediaQuery?.matches ? "dark" : "light");
				return;
			}

			root.classList.add(nextTheme);
		};

		applyTheme(theme);

		if (theme !== "system" || !mediaQuery) return;

		const handleChange = () => applyTheme("system");
		if (typeof mediaQuery.addEventListener === "function") {
			mediaQuery.addEventListener("change", handleChange);
			return () => {
				mediaQuery.removeEventListener("change", handleChange);
			};
		}
		mediaQuery.addListener(handleChange);
		return () => {
			mediaQuery.removeListener(handleChange);
		};
	}, [theme]);

	const value = {
		theme,
			setTheme: (nextTheme: Theme) => {
				setTheme(nextTheme);
				writeUserStorage(storageKey, nextTheme);
			},
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
