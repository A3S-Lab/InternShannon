const { fontFamily } = require("tailwindcss/defaultTheme");

/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ["class"],
	theme: {
		container: {
			center: true,
			padding: "2rem",
			screens: {
				"2xl": "1400px",
			},
		},
		extend: {
			fontFamily: {
				sans: ["var(--font-sans)", ...fontFamily.sans],
				display: ["var(--font-display)", ...fontFamily.sans],
				mid: ["var(--font-mid)", ...fontFamily.sans],
				mono: ["var(--font-mono)", ...fontFamily.mono],
			},
			colors: {
				brand: {
					DEFAULT: "#1456f0",
					light: "#3daeff",
					pink: "#ea5ec1",
					deep: "#17437d",
				},
				// 这些 token 走 CSS 变量，light/dark 切换由 styles.css 的 :root / .dark 控制；
				// 不要回退成静态 hex，否则 dark 模式下文本/边框会消失。
				text: {
					DEFAULT: "var(--col-text00)",
					dark: "var(--col-text01)",
					surface: "var(--col-text02)",
					secondary: "var(--col-text04)",
					muted: "var(--col-text05)",
					helper: "var(--brand-2)",
				},
				border: {
					DEFAULT: "hsl(var(--border))",
					light: "var(--col-border-light)",
				},
				input: "hsl(var(--input))",
				ring: "hsl(var(--ring))",
				background: "hsl(var(--background))",
				foreground: "hsl(var(--foreground))",
				primary: {
					DEFAULT: "hsl(var(--primary))",
					foreground: "hsl(var(--primary-foreground))",
				},
				secondary: {
					DEFAULT: "hsl(var(--secondary))",
					foreground: "hsl(var(--secondary-foreground))",
				},
				destructive: {
					DEFAULT: "hsl(var(--destructive))",
					foreground: "hsl(var(--destructive-foreground))",
				},
				muted: {
					DEFAULT: "hsl(var(--muted))",
					foreground: "hsl(var(--muted-foreground))",
				},
				accent: {
					DEFAULT: "hsl(var(--accent))",
					foreground: "hsl(var(--accent-foreground))",
				},
				popover: {
					DEFAULT: "hsl(var(--popover))",
					foreground: "hsl(var(--popover-foreground))",
				},
				card: {
					DEFAULT: "hsl(var(--card))",
					foreground: "hsl(var(--card-foreground))",
				},
				sidebar: {
					DEFAULT: "hsl(var(--sidebar-background))",
					foreground: "hsl(var(--sidebar-foreground))",
					primary: "hsl(var(--sidebar-primary))",
					"primary-foreground": "hsl(var(--sidebar-primary-foreground))",
					accent: "hsl(var(--sidebar-accent))",
					"accent-foreground": "hsl(var(--sidebar-accent-foreground))",
					border: "hsl(var(--sidebar-border))",
					ring: "hsl(var(--sidebar-ring))",
				},
				success: {
					DEFAULT: "hsl(var(--success))",
					foreground: "hsl(var(--success-foreground))",
				},
				warning: {
					DEFAULT: "hsl(var(--warning))",
					foreground: "hsl(var(--warning-foreground))",
				},
				info: {
					DEFAULT: "hsl(var(--info))",
					foreground: "hsl(var(--info-foreground))",
				},
			},
			borderRadius: {
				none: "0",
				minimal: "4px",
				sm: "calc(var(--radius) - 4px)",
				DEFAULT: "var(--radius)",
				md: "calc(var(--radius) - 2px)",
				lg: "var(--radius)",
				comfortable: "var(--radius-comfortable, 12px)",
				xl: "var(--radius-generous, 18px)",
				"2xl": "var(--radius-large, 22px)",
				"4xl": "2rem",
				"5xl": "2.5rem",
				pill: "var(--radius-pill, 30px)",
				full: "9999px",
			},
			boxShadow: {
				standard: "var(--shadow-standard)",
				subtle: "var(--shadow-subtle, var(--shadow-standard))",
				"soft-glow": "var(--shadow-soft-glow)",
				ambient: "var(--shadow-ambient, var(--shadow-soft-glow))",
				"brand-purple": "var(--shadow-brand-purple)",
				brand: "var(--shadow-brand, var(--shadow-brand-purple))",
				"brand-purple-offset": "var(--shadow-brand-purple-offset)",
				card: "var(--shadow-card)",
				elevated: "var(--shadow-elevated, var(--shadow-card))",
				weak:
					"0 2px 4px -2px hsl(var(--foreground) / 0.08), 0 2px 4px -2px hsl(var(--foreground) / 0.04)",
				strong:
					"0 10px 15px -3px hsl(var(--foreground) / 0.08), 0 4px 6px -4px hsl(var(--foreground) / 0.04)",
			},
			fontSize: {
				"display-hero": ["80px", { lineHeight: "1.10", fontWeight: "500" }],
				"section-heading": ["31px", { lineHeight: "1.50", fontWeight: "600" }],
				"card-title": ["28px", { lineHeight: "1.71", fontWeight: "500" }],
				"sub-heading": ["24px", { lineHeight: "1.50", fontWeight: "500" }],
				"feature-label": ["18px", { lineHeight: "1.50", fontWeight: "500" }],
				"body-lg": ["20px", { lineHeight: "1.50", fontWeight: "500" }],
				body: ["16px", { lineHeight: "1.50", fontWeight: "400" }],
				"body-bold": ["16px", { lineHeight: "1.50", fontWeight: "700" }],
				nav: ["14px", { lineHeight: "1.50", fontWeight: "500" }],
				"button-sm": ["13px", { lineHeight: "1.50", fontWeight: "600" }],
				caption: ["13px", { lineHeight: "1.70", fontWeight: "400" }],
				label: ["12px", { lineHeight: "1.25", fontWeight: "500" }],
				micro: ["10px", { lineHeight: "1.50", fontWeight: "400" }],
			},
			spacing: {
				0.5: "2px",
				1: "4px",
				1.5: "6px",
				2: "8px",
				2.5: "10px",
				3: "12px",
				4: "16px",
				5: "20px",
				6: "24px",
				8: "32px",
				10: "40px",
				12: "48px",
				16: "64px",
				20: "80px",
			},
			keyframes: {
				"accordion-down": {
					from: { height: "0" },
					to: { height: "var(--radix-accordion-content-height)" },
				},
				"accordion-up": {
					from: { height: "var(--radix-accordion-content-height)" },
					to: { height: "0" },
				},
			},
			animation: {
				"accordion-down": "accordion-down 0.2s ease-out",
				"accordion-up": "accordion-up 0.2s ease-out",
			},
		},
	},
};
