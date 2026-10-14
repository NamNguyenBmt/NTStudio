import { useEffect } from "react";
import { omni } from "./api";
import { useUiStore } from "../stores/ui";

const media = () =>
  typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function resolveTheme(pref) {
  return pref === "system" ? (media()?.matches === false ? "light" : "dark") : pref;
}

function apply(pref) {
  const t = resolveTheme(pref);
  const root = document.documentElement;
  root.dataset.theme = t;
  root.classList.toggle("dark", t === "dark");
}

export function applyStoredTheme() {
  apply(useUiStore.getState().theme);
}

export function useThemeSync() {
  const theme = useUiStore((s) => s.theme);
  useEffect(() => {
    apply(theme);
    omni.app.setTheme(theme);
    if (theme !== "system") return;
    const mq = media();
    const onChange = () => apply("system");
    mq?.addEventListener("change", onChange);
    return () => mq?.removeEventListener("change", onChange);
  }, [theme]);
}
