import { StrictMode } from "react";
import { QueryClientProvider, MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./lib/api";
import { createRoot } from "react-dom/client";
import { applyStoredTheme } from "./lib/theme";
import { App } from "./App";
import "@fontsource/montserrat/900.css";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";

applyStoredTheme();

const onAuthError = (err) => {
  if (err instanceof ApiError && (err.code === "AUTH" || err.code === "LICENSE"))
    void queryClient.invalidateQueries({ queryKey: ["auth.state"] });
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: { queries: { staleTime: 3e4, retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
