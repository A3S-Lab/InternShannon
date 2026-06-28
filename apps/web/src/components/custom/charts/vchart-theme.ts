import { useEffect, useMemo, useState } from "react";
import type { ITheme } from "@visactor/react-vchart";
import { useTheme } from "@/components/ui/theme-provider";

export type ResolvedTheme = "light" | "dark";

export interface VChartThemeTokens {
  /** Chart canvas background */
  chartBackground: string;
  /** Primary text */
  primaryText: string;
  /** Secondary text */
  secondaryText: string;
  /** Axis label / secondary text */
  axisLabel: string;
  /** Tertiary text — small captions, legend hints */
  axisSubLabel: string;
  /** Grid lines */
  grid: string;
  /** Axis domain / tick lines */
  axisLine: string;
  /** Tooltip card background */
  tooltipBg: string;
  /** Tooltip card text */
  tooltipText: string;
  /** Tooltip card border */
  tooltipBorder: string;
  /** Hovered legend / component background */
  hoverBg: string;
  /** Popup shadow */
  shadow: string;
}

const LIGHT_TOKENS: VChartThemeTokens = {
  chartBackground: "transparent",
  primaryText: "#0f172a",
  secondaryText: "#475569",
  axisLabel: "#64748b",
  axisSubLabel: "#94a3b8",
  grid: "#edf1f5",
  axisLine: "#e2e8f0",
  tooltipBg: "#ffffff",
  tooltipText: "#0f172a",
  tooltipBorder: "#e2e8f0",
  hoverBg: "#f8fafc",
  shadow: "rgba(15,23,42,0.12)",
};

const DARK_TOKENS: VChartThemeTokens = {
  chartBackground: "transparent",
  primaryText: "#f8fafc",
  secondaryText: "#cbd5e1",
  axisLabel: "#94a3b8",
  axisSubLabel: "#64748b",
  grid: "#1e293b",
  axisLine: "#334155",
  tooltipBg: "#111827",
  tooltipText: "#f8fafc",
  tooltipBorder: "#334155",
  hoverBg: "rgba(148,163,184,0.14)",
  shadow: "rgba(0,0,0,0.36)",
};

function palette(tokens: VChartThemeTokens) {
  return {
    backgroundColor: tokens.chartBackground,
    borderColor: tokens.tooltipBorder,
    shadowColor: tokens.shadow,
    hoverBackgroundColor: tokens.hoverBg,
    sliderRailColor: tokens.grid,
    sliderHandleColor: tokens.chartBackground,
    sliderTrackColor: "#2dd4bf",
    popupBackgroundColor: tokens.tooltipBg,
    primaryFontColor: tokens.primaryText,
    secondaryFontColor: tokens.secondaryText,
    tertiaryFontColor: tokens.axisSubLabel,
    axisLabelFontColor: tokens.axisLabel,
    disableFontColor: tokens.axisSubLabel,
    axisMarkerFontColor: tokens.tooltipText,
    axisGridColor: tokens.grid,
    axisDomainColor: tokens.axisLine,
    dataZoomHandleStrokeColor: tokens.axisLabel,
    dataZoomChartColor: tokens.grid,
    scrollBarSliderColor: tokens.axisLabel,
    axisMarkerBackgroundColor: tokens.tooltipBg,
    markLabelBackgroundColor: tokens.hoverBg,
    markLineStrokeColor: tokens.axisLabel,
    discreteLegendPagerTextColor: tokens.secondaryText,
    discreteLegendPagerHandlerColor: tokens.secondaryText,
    discreteLegendPagerHandlerDisableColor: tokens.axisSubLabel,
    emptyCircleColor: tokens.axisLine,
    linearProgressTrackColor: tokens.grid,
  };
}

function textStyle(fill: string, fontSize = 12) {
  return {
    fill,
    fontSize,
    fontWeight: "normal" as const,
    fillOpacity: 1,
  };
}

function tooltipTextStyle(fontColor: string, fontWeight: "normal" | "bold" = "normal") {
  return {
    fontColor,
    fontWeight,
  };
}

function buildVChartTheme(tokens: VChartThemeTokens): Partial<ITheme> {
  return {
    background: tokens.chartBackground,
    colorScheme: {
      default: {
        palette: palette(tokens),
      },
    },
    component: {
      axis: {
        domainLine: { style: { stroke: tokens.axisLine } },
        grid: { style: { stroke: tokens.grid } },
        tick: { style: { stroke: tokens.axisLine } },
        subTick: { style: { stroke: tokens.axisLine } },
        label: { style: textStyle(tokens.axisLabel) },
        title: { style: textStyle(tokens.secondaryText) },
      },
      axisX: {
        label: { style: textStyle(tokens.axisLabel) },
        unit: { style: textStyle(tokens.axisLabel) },
      },
      axisY: {
        label: { style: textStyle(tokens.axisLabel) },
        unit: { style: textStyle(tokens.axisLabel) },
      },
      discreteLegend: {
        item: {
          background: {
            state: {
              selectedHover: { fill: tokens.hoverBg },
              unSelectedHover: { fill: tokens.hoverBg },
            },
          },
          label: {
            style: textStyle(tokens.axisLabel),
            state: {
              unSelected: { fill: tokens.axisSubLabel },
            },
          },
        },
        pager: {
          textStyle: { fill: tokens.secondaryText },
          handler: {
            style: { fill: tokens.secondaryText },
            state: { disable: { fill: tokens.axisSubLabel } },
          },
        },
      },
      tooltip: {
        panel: {
          backgroundColor: tokens.tooltipBg,
          border: {
            color: tokens.tooltipBorder,
            width: 1,
            radius: 6,
          },
          shadow: {
            x: 0,
            y: 10,
            blur: 24,
            spread: 0,
            color: tokens.shadow,
          },
        },
        titleLabel: tooltipTextStyle(tokens.tooltipText, "bold"),
        keyLabel: tooltipTextStyle(tokens.secondaryText),
        valueLabel: tooltipTextStyle(tokens.tooltipText, "bold"),
      },
      crosshair: {
        xField: {
          line: { style: { stroke: tokens.axisLine } },
          label: {
            labelBackground: { style: { fill: tokens.tooltipBg, stroke: tokens.tooltipBorder } },
            style: { fill: tokens.tooltipText },
          },
        },
        yField: {
          line: { style: { stroke: tokens.axisLine } },
          label: {
            labelBackground: { style: { fill: tokens.tooltipBg, stroke: tokens.tooltipBorder } },
            style: { fill: tokens.tooltipText },
          },
        },
      },
      title: {
        textStyle: textStyle(tokens.primaryText, 14),
        subtextStyle: textStyle(tokens.secondaryText, 12),
      },
    },
  } as unknown as Partial<ITheme>;
}

/**
 * Resolves the effective theme (light/dark) taking system preference into
 * account. Subscribes to `prefers-color-scheme` so charts re-render when the
 * OS theme flips while `theme === "system"`.
 */
export function useResolvedTheme(): ResolvedTheme {
  const { theme } = useTheme();
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  return systemDark ? "dark" : "light";
}

/**
 * Returns chart-axis / grid / tooltip colors that match the current theme.
 * Saturated series colors (chart palette per-page) are intentionally NOT
 * here — those stay cross-theme stable. This hook only covers the chrome
 * around the data: things that should match the page's background/text
 * tones so charts don't look like a light-mode island in a dark UI.
 */
export function useVChartTheme(): VChartThemeTokens {
  const resolved = useResolvedTheme();
  return useMemo(() => (resolved === "dark" ? DARK_TOKENS : LIGHT_TOKENS), [resolved]);
}

/**
 * Full VChart theme fragment used by the shared renderer. This covers the
 * defaults VChart would otherwise draw in light mode: canvas background,
 * tooltip panel, axis chrome, legends and crosshair labels.
 */
export function useVChartThemeSpec(): Partial<ITheme> {
  const tokens = useVChartTheme();
  return useMemo(() => buildVChartTheme(tokens), [tokens]);
}
