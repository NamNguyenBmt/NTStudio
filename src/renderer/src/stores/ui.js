import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const safeStorage = createJSONStorage(() => {
  try {
    return window.localStorage;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
});

export const useUiStore = create()(
  persist(
    (set) => ({
      railCollapsed: false,
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      activeWorkspaceId: null,
      setActiveWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId }),
      theme: "system",
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "omni-ui",
      storage: safeStorage,
      partialize: (s) => ({ railCollapsed: s.railCollapsed, activeWorkspaceId: s.activeWorkspaceId, theme: s.theme }),
    },
  ),
);
