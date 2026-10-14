import { omni } from "../lib/api";
import { create } from "zustand";

export const useSystemStore = create(() => ({ stats: null, window: { isMaximized: false, isFocused: true } }));

export function bindSystemListeners() {
  const offStats = omni.system.onStats((stats) => useSystemStore.setState({ stats }));
  const offWin = omni.window.onStateChanged((window2) => useSystemStore.setState({ window: window2 }));
  return () => {
    offStats();
    offWin();
  };
}
