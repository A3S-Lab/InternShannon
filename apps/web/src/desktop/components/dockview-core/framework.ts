import type { Parameters } from "./panel/types";

export interface PanelParameters<T extends object = Parameters> {
  params: T;
}
