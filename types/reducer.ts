import type { Effect } from "./effect.ts";
import type { ExtendedState } from "./state.ts";

export interface ReducerResult {
  nextState: ExtendedState;
  effects: Effect[];
}
