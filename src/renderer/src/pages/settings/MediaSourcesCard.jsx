import { useApiQuery, useApiMutation } from "../../lib/api";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, Film, Image } from "lucide-react";
import { cn } from "../../lib/cn";
import { Select } from "../../components/ui/Input";
import { Switch } from "../../components/ui/Switch";
import { StatusDot } from "../../components/ui/StatusDot";
import { toast } from "../../components/ui/toast";
import { formatCredits } from "../../components/shell/FlowCredits";
import { providerInfo } from "../../../../shared/providers";

export const FLOW_MODEL_OPTIONS = [
  { id: "Veo 3.1 - Fast", label: "Veo 3.1 Fast (cân bằng – khuyên dùng)" },
  { id: "Veo 3.1 - Lite", label: "Veo 3.1 Lite (ít credit nhất)" },
  { id: "Veo 3.1 - Quality", label: "Veo 3.1 Quality (đẹp nhất, nhiều credit)" },
  { id: "Omni 1.1 Flash", label: "Omni 1.1 Flash (nhanh, clip 4–10 giây theo cảnh)" },
];

const INV = ["flow.", "film.gate", "studio.", "render.", "media."];
export const FLOW_ACCOUNT_ID = "flow-account";

export function MediaSourcesCard() {
  const [, setParams] = useSearchParams();
  const { data: s } = useApiQuery("flow.status", void 0, { refetchInterval: 5e3 });
  const { data: providers = [] } = useApiQuery("ai.providers");
  const { data: imageEngine } = useApiQuery("media.imageEngine");
  const setSource = useApiMutation("flow.setSource", INV);
  const setPrefs = useApiMutation("flow.setPrefs", INV);
  const setImageEngine = useApiMutation("media.setImageEngine", ["media."]);
  const find = (id) => providers.find((p) => p.provider === id);
  const keyState = (id, paid) => {
    const p = find(id);
    const from = providerInfo(id).keyFrom;
    const ownerLabel = from ? providerInfo(from).label : null;
    if (!p) return { health: "idle", text: "Chưa có", fix: "keys" };
    if (!p.hasKey && !(from && find(from)?.hasKey))
      return { health: "idle", text: `Chưa có key${ownerLabel ? ` ${ownerLabel}` : ""}`, fix: "keys" };
    if (!p.enabled)
      return { health: "warn", text: "Có key nhưng đang tắt", fix: "keys", fixLabel: "Bật ở tab Khóa AI" };
    if (p.status === "invalid") return { health: "error", text: "Key sai", fix: "keys", fixLabel: "Sửa key" };
    return { health: "ok", text: paid };
  };
  const flowState = !s
    ? { health: "idle", text: "Đang kiểm tra…" }
    : !s.chromePath
      ? { health: "error", text: "Chưa có Chrome / Edge trên máy" }
      : !s.loggedIn
        ? { health: "warn", text: "Chưa đăng nhập", fix: "flow" }
        : { health: "ok", text: `Đã đăng nhập${s.credits !== null ? ` · ${formatCredits(s.credits)} tín dụng` : ""}` };
  const goFix = (fix) => {
    if (fix === "keys") setParams({}, { replace: true });
    else document.getElementById(FLOW_ACCOUNT_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const videoSource = s?.source ?? "api";
  const pickVideo = (source) => {
    if (source !== videoSource) setSource.mutate({ source }, { onError: (e) => toast.error(e.message) });
  };
  const falFirst = imageEngine === "fal";
  const flowImages = !!s?.images;
  const imageChain = [
    {
      id: "google_image",
      label: "Gemini (Nano Banana)",
      state: keyState("google_image", "Có key · tính phí theo ảnh"),
    },
    { id: "fal", label: "Fal.ai Flux", state: keyState("fal", "Có key · tính phí theo ảnh") },
  ];
  if (falFirst) imageChain.reverse();
  const status = (st) => (
    <span className="flex min-w-0 items-center gap-1.5 text-label-sm">
      <StatusDot health={st.health} />
      <span
        className={cn(
          "truncate",
          st.health === "ok" ? "text-on-surface-variant" : st.health === "error" ? "text-error" : "text-outline",
        )}
      >
        {st.text}
      </span>
      {st.fix && (
        <button
          type="button"
          onClick={() => goFix(st.fix)}
          className="flex shrink-0 items-center gap-0.5 text-primary hover:underline"
        >
          {st.fixLabel ?? (st.fix === "keys" ? "Thêm key" : "Đăng nhập")} <ArrowRight size={11} />
        </button>
      )}
    </span>
  );
  return (
    <div className="flex flex-col gap-space-md rounded-xl border border-overlay/[0.08] bg-surface-container-lowest p-space-md">
      <p className="text-label-sm text-outline">
        App dùng nguồn nào, theo thứ tự nào. Key nhập ở tab Khóa AI; đăng nhập Google Flow ở thẻ bên dưới.
      </p>
      <div className="flex flex-col gap-space-xs">
        <span className="flex items-center gap-1.5 text-label-md text-on-surface-variant">
          <Film size={14} />
          {" Video AI "}
          <span className="text-label-sm text-outline">– chế độ Full AI ở Xưởng video, model Veo ở Xưởng phim</span>
        </span>
        <div role="radiogroup" aria-label="Nguồn video Veo" className="grid grid-cols-1 gap-space-xs md:grid-cols-2">
          {[
            {
              id: "flow",
              label: "Google Flow",
              hint: "Tài khoản Google có gói Google AI – trừ tín dụng Flow, app không tính phí",
              state: flowState,
            },
            {
              id: "api",
              label: "Veo API",
              hint: "Key Gemini – Google tính phí theo giây video",
              state: keyState("google_veo", "Có key Gemini · tính phí"),
            },
          ].map((o) => {
            const on = videoSource === o.id;
            return (
              <div
                key={o.id}
                role="radio"
                aria-checked={on}
                tabIndex={0}
                onClick={() => pickVideo(o.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pickVideo(o.id))}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-lg border p-space-sm transition-colors",
                  on ? "border-primary bg-primary/[0.06]" : "border-overlay/[0.08] hover:border-overlay/[0.16]",
                )}
              >
                <span className="flex items-center gap-space-sm text-label-md text-on-surface">
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                      on ? "border-primary" : "border-outline",
                    )}
                  >
                    {on && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </span>
                  {o.label}
                  {on && <span className="text-label-sm text-primary">đang dùng</span>}
                </span>
                <span className="text-label-sm text-outline">{o.hint}</span>
                <span onClick={(e) => e.stopPropagation()}>{status(o.state)}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-space-md gap-y-1 rounded-lg border border-dashed border-overlay/[0.08] px-space-sm py-1.5">
          <span className="text-label-sm text-on-surface-variant">
            <b className="font-medium text-on-surface">Seedance 2.0</b>
            {" – chọn theo từng phim trong Xưởng phim (ảnh tham chiếu, khung đầu / cuối)"}
          </span>
          {status(keyState("seedance", "Có key Fal · tính phí"))}
        </div>
      </div>
      <div className="flex flex-col gap-space-xs">
        <span className="flex items-center gap-1.5 text-label-md text-on-surface-variant">
          <Image size={14} />
          {" Ảnh AI "}
          <span className="text-label-sm text-outline">
            {"– ảnh cảnh Xưởng video, nhân vật / bối cảnh / khung hình Xưởng phim & Series"}
          </span>
        </span>
        <ol className="flex flex-col gap-space-xs">
          <li className="flex flex-wrap items-center justify-between gap-space-sm rounded-lg border border-overlay/[0.08] p-space-sm">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-space-sm text-label-md text-on-surface">
                <Order n={flowImages ? 1 : null} />
                {" Google Flow (Nano Banana)"}
              </span>
              <span className="text-label-sm text-outline">
                0 tín dụng – thử trước tiên khi bật; lỗi thì chuyển sang nguồn sau
              </span>
              {status(flowState)}
            </span>
            <Switch
              checked={flowImages}
              disabled={!s || setPrefs.isPending}
              onChange={(images) => setPrefs.mutate({ images }, { onError: (e) => toast.error(e.message) })}
              label="Tạo ảnh qua Google Flow"
            />
          </li>
          {imageChain.map((x, i) => (
            <li
              key={x.id}
              className="flex flex-wrap items-center justify-between gap-space-sm rounded-lg border border-overlay/[0.08] p-space-sm"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-space-sm text-label-md text-on-surface">
                  <Order n={i + (flowImages ? 2 : 1)} /> {x.label}
                </span>
                {status(x.state)}
              </span>
              {i === 0 && (
                <div className="w-48">
                  <Select
                    aria-label="Thứ tự Gemini / Fal"
                    value={falFirst ? "fal" : "google_image"}
                    disabled={setImageEngine.isPending}
                    onChange={(e) => setImageEngine.mutate({ engine: e.target.value })}
                    className="h-7 text-label-sm"
                  >
                    <option value="google_image">Gemini trước, rồi Fal</option>
                    <option value="fal">Fal trước, rồi Gemini</option>
                  </Select>
                </div>
              )}
            </li>
          ))}
        </ol>
        <p className="text-label-sm text-outline">
          Xưởng phim chọn Gemini hay Fal theo từng phim (Flow vẫn được thử trước). Ở Xưởng video, không nguồn nào dùng
          được thì cảnh đó lấy video có sẵn (miễn phí).
        </p>
      </div>
    </div>
  );
}

function Order({ n }) {
  return (
    <span
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px]",
        n ? "bg-secondary/15 text-secondary" : "bg-overlay/[0.06] text-outline",
      )}
    >
      {n ?? "–"}
    </span>
  );
}
