/* eslint-disable @typescript-eslint/no-explicit-any */

"use client";

import React from "react";
import { VChartView, type VChartSpec } from "@/components/custom/vchart";
import { AvailableChartColors, type AvailableChartColorsKeys, constructCategoryColors } from "@/lib/chart";
import { cn } from "@/lib/utils";

const sparkColorValues: Record<AvailableChartColorsKeys, string> = {
  blue: "#2563eb",
  emerald: "#10b981",
  violet: "#8b5cf6",
  amber: "#f59e0b",
  gray: "#6b7280",
  cyan: "#06b6d4",
  pink: "#ec4899",
  lime: "#84cc16",
  fuchsia: "#d946ef",
};

function sparkYRange(autoMinValue: boolean, minValue: number | undefined, maxValue: number | undefined) {
  return {
    min: autoMinValue ? undefined : (minValue ?? 0),
    max: maxValue,
  };
}

function foldSparkData(data: Record<string, any>[], index: string, categories: string[]) {
  return data.flatMap((item, itemIndex) =>
    categories.map((category) => ({
      index: item[index] ?? itemIndex,
      category,
      value: item[category],
    })),
  );
}

function sparkColors(categories: string[], colors: AvailableChartColorsKeys[]) {
  const categoryColors = constructCategoryColors(categories, colors);
  return categories.map((category) => sparkColorValues[categoryColors.get(category) ?? "gray"]);
}

function sparkAxes(autoMinValue: boolean, minValue: number | undefined, maxValue: number | undefined) {
  return [
    { orient: "bottom", visible: false },
    {
      orient: "left",
      visible: false,
      ...sparkYRange(autoMinValue, minValue, maxValue),
    },
  ];
}

interface SparkAreaChartProps extends React.HTMLAttributes<HTMLDivElement> {
  data: Record<string, any>[];
  categories: string[];
  index: string;
  colors?: AvailableChartColorsKeys[];
  autoMinValue?: boolean;
  minValue?: number;
  maxValue?: number;
  connectNulls?: boolean;
  type?: "default" | "stacked" | "percent";
  fill?: "gradient" | "solid" | "none";
}

const SparkAreaChart = React.forwardRef<HTMLDivElement, SparkAreaChartProps>((props, forwardedRef) => {
  const {
    data = [],
    categories = [],
    index,
    colors = AvailableChartColors,
    autoMinValue = false,
    minValue,
    maxValue,
    connectNulls = false,
    type = "default",
    className,
    fill = "gradient",
    ...other
  } = props;

  const spec = React.useMemo<VChartSpec>(
    () => ({
      type: "area",
      data: [{ id: "spark-area", values: foldSparkData(data, index, categories) }],
      xField: "index",
      yField: "value",
      seriesField: "category",
      color: sparkColors(categories, colors),
      stack: type === "stacked" || type === "percent",
      percent: type === "percent",
      invalidType: connectNulls ? "link" : "break",
      padding: 1,
      animation: false,
      tooltip: { visible: false },
      axes: sparkAxes(autoMinValue, minValue, maxValue),
      point: { visible: false },
      line: { style: { lineWidth: 2 } },
      area: {
        style: {
          fillOpacity: fill === "none" ? 0 : fill === "solid" ? 0.28 : 0.18,
        },
      },
    }),
    [autoMinValue, categories, colors, connectNulls, data, fill, index, maxValue, minValue, type],
  );

  return (
    <div ref={forwardedRef} className={cn("h-12 w-28", className)} tremor-id="tremor-raw" {...other}>
      <VChartView spec={spec} />
    </div>
  );
});

SparkAreaChart.displayName = "SparkAreaChart";

interface SparkLineChartProps extends React.HTMLAttributes<HTMLDivElement> {
  data: Record<string, any>[];
  categories: string[];
  index: string;
  colors?: AvailableChartColorsKeys[];
  autoMinValue?: boolean;
  minValue?: number;
  maxValue?: number;
  connectNulls?: boolean;
}

const SparkLineChart = React.forwardRef<HTMLDivElement, SparkLineChartProps>((props, forwardedRef) => {
  const {
    data = [],
    categories = [],
    index,
    colors = AvailableChartColors,
    autoMinValue = false,
    minValue,
    maxValue,
    connectNulls = false,
    className,
    ...other
  } = props;

  const spec = React.useMemo<VChartSpec>(
    () => ({
      type: "line",
      data: [{ id: "spark-line", values: foldSparkData(data, index, categories) }],
      xField: "index",
      yField: "value",
      seriesField: "category",
      color: sparkColors(categories, colors),
      invalidType: connectNulls ? "link" : "break",
      padding: 1,
      animation: false,
      tooltip: { visible: false },
      axes: sparkAxes(autoMinValue, minValue, maxValue),
      point: { visible: false },
      line: { style: { lineWidth: 2 } },
    }),
    [autoMinValue, categories, colors, connectNulls, data, index, maxValue, minValue],
  );

  return (
    <div ref={forwardedRef} className={cn("h-12 w-28", className)} tremor-id="tremor-raw" {...other}>
      <VChartView spec={spec} />
    </div>
  );
});

SparkLineChart.displayName = "SparkLineChart";

interface BarChartProps extends React.HTMLAttributes<HTMLDivElement> {
  data: Record<string, any>[];
  index: string;
  categories: string[];
  colors?: AvailableChartColorsKeys[];
  autoMinValue?: boolean;
  minValue?: number;
  maxValue?: number;
  barCategoryGap?: string | number;
  type?: "default" | "stacked" | "percent";
}

const SparkBarChart = React.forwardRef<HTMLDivElement, BarChartProps>((props, forwardedRef) => {
  const {
    data = [],
    categories = [],
    index,
    colors = AvailableChartColors,
    autoMinValue = false,
    minValue,
    maxValue,
    barCategoryGap,
    type = "default",
    className,
    ...other
  } = props;

  const spec = React.useMemo<VChartSpec>(
    () => ({
      type: "bar",
      data: [{ id: "spark-bar", values: foldSparkData(data, index, categories) }],
      xField: "index",
      yField: "value",
      seriesField: "category",
      color: sparkColors(categories, colors),
      stack: type === "stacked" || type === "percent",
      percent: type === "percent",
      padding: 1,
      barGapInGroup: barCategoryGap,
      animation: false,
      tooltip: { visible: false },
      axes: sparkAxes(autoMinValue, minValue, maxValue),
      bar: { style: { cornerRadius: [1, 1, 0, 0] } },
    }),
    [autoMinValue, barCategoryGap, categories, colors, data, index, maxValue, minValue, type],
  );

  return (
    <div ref={forwardedRef} className={cn("h-12 w-28", className)} tremor-id="tremor-raw" {...other}>
      <VChartView spec={spec} />
    </div>
  );
});

SparkBarChart.displayName = "SparkBarChart";

export { SparkAreaChart, SparkLineChart, SparkBarChart };
