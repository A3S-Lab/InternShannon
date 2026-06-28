const shuanUiPreset = require("./src/components/ui/tailwind-preset.cjs");

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [shuanUiPreset],
  content: ["./src/admin/index.html", "./src/desktop/index.html", "./src/**/*.{js,ts,jsx,tsx,md,mdx}"],
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};
