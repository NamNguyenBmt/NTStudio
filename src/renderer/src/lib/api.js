import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";

const noop = () => {
};

const browserFallback = {
  window: { minimize: noop, toggleMaximize: noop, close: noop, onStateChanged: () => noop },
  app: {
    info: async () => ({ name: "NT Studio", version: "2.5.0", platform: "browser", electron: "-" }),
    setTheme: noop,
    onNavigate: () => noop,
    onLicenseChanged: () => noop
  },
  system: { onStats: () => noop },
  inbox: { onChanged: () => noop },
  api: {
    invoke: async () => ({
      ok: false,
      error: { code: "INTERNAL", message: "Không chạy trong Electron – chưa có dữ liệu (mở bằng npm run dev)" }
    })
  }
};

export const omni = typeof window !== "undefined" && window.omni ? window.omni : browserFallback;

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function call(endpoint, ...args) {
  const res = await omni.api.invoke(endpoint, args[0]);
  if (!res.ok) throw new ApiError(res.error.code, res.error.message);
  return res.data;
}

export function useApiQuery(endpoint, input, options) {
  return useQuery({
    queryKey: [endpoint, input ?? null],
    queryFn: () => call(endpoint, input),
    ...options
  });
}

export function useApiMutation(endpoint, invalidates = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => call(endpoint, input),
    onSuccess: () => qc.invalidateQueries({
      predicate: (q) => {
        const key = q.queryKey[0];
        return typeof key === "string" && invalidates.some((prefix) => key.startsWith(prefix));
      }
    })
  });
}
