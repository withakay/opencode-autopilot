import type { ExtendedState } from "../types/index.ts";

const snapshotStore = new Map<string, ExtendedState>();

function cloneState(state: ExtendedState): ExtendedState {
  return JSON.parse(JSON.stringify(state)) as ExtendedState;
}

export function persistSnapshot(state: ExtendedState): void {
  snapshotStore.set(state.session_id, cloneState(state));
}

export function restoreSnapshot(sessionID: string): ExtendedState | null {
  const snapshot = snapshotStore.get(sessionID);
  return snapshot === undefined ? null : cloneState(snapshot);
}
