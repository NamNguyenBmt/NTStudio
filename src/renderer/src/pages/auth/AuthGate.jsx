import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { omni, useApiQuery } from "../../lib/api";
import { LoaderCircle } from "lucide-react";
import { useUiStore } from "../../stores/ui";
import { LoginPage } from "./LoginPage";
import { UpdateRequired, LicenseGate } from "./LicenseGate";

export function AuthGate({ children }) {
  const qc = useQueryClient();
  const { data: state, isLoading } = useApiQuery("auth.state", void 0, {
    staleTime: Infinity,
    refetchInterval: (q) => (q.state.data?.license?.status === "checking" ? 1500 : q.state.data?.user ? 6e4 : false),
  });
  const { data: appInfo } = useApiQuery("cloud.appInfo", void 0, { staleTime: 10 * 6e4, refetchInterval: 30 * 6e4 });
  useEffect(
    () =>
      omni.app.onLicenseChanged(() => {
        void qc.invalidateQueries({
          predicate: (q) =>
            typeof q.queryKey[0] === "string" && /^(auth\.state|license\.|channels\.|accounts\.)/.test(q.queryKey[0]),
        });
      }),
    [qc],
  );
  if (isLoading || !state) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-on-surface-variant">
        <LoaderCircle size={20} className="animate-spin" />
      </div>
    );
  }
  if (!state.user) {
    return (
      <LoginPage
        state={state}
        onAuthed={(user) => {
          qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth.state" });
          if (state.lastEmail !== user.email) useUiStore.getState().setActiveWorkspace(null);
          qc.setQueryData(["auth.state", null], { ...state, user, hasUsers: true, legacyData: false });
        }}
      />
    );
  }
  if (appInfo?.updateRequired) return <UpdateRequired info={appInfo} />;
  if (state.license && !state.license.usable) return <LicenseGate state={state} />;
  return <>{children}</>;
}
