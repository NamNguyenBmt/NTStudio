import { useState, useRef } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { Cpu, Download, LoaderCircle, Mic, Pause, Play, RefreshCw, Trash, X } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { confirmDialog } from "../../components/ui/confirm";
import { Input } from "../../components/ui/Input";
import { Progress } from "../../components/ui/Progress";
import { StatusDot } from "../../components/ui/StatusDot";
import { toast } from "../../components/ui/toast";
import { mediaUrl } from "../../lib/media";
import { formatRelative } from "../../lib/format";

const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

const RATING = {
  good: { label: "TỐT", tone: "success", health: "ok" },
  slow: { label: "Có thể xử lý chậm", tone: "warning", health: "warn" },
  poor: { label: "Không đạt yêu cầu", tone: "danger", health: "error" }
};

export function LocalTtsCard() {
  const { data: s, error } = useApiQuery("localtts.status", void 0, { refetchInterval: (q) => q.state.data?.install.running ? 1e3 : q.state.data?.engine.running ? 5e3 : false });
  const detect = useApiMutation("localtts.status", ["localtts."]);
  const install = useApiMutation("localtts.install", ["localtts."]);
  const cancel = useApiMutation("localtts.cancel", ["localtts."]);
  const uninstall = useApiMutation("localtts.uninstall", ["localtts.", "media.voices"]);
  const running = !!s?.install.running;
  const hw = s?.hardware ?? null;
  const startInstall = async () => {
    if (!hw) return;
    const what = hw.variant === "cuda" ? `App sẽ tải Python, PyTorch CUDA và model VieNeu-TTS (tổng ~${hw.downloadGb} GB) – bản chạy bằng GPU.` : `App sẽ tải Python và model VieNeu-TTS (tổng ~${hw.downloadGb} GB) – bản chạy bằng CPU.`;
    const warn = hw.rating === "poor" ? `

⚠ Cấu hình máy KHÔNG ĐẠT yêu cầu khuyến nghị:
• ${hw.notes.join("\n• ")}
Vẫn cài được nhưng đọc có thể rất chậm hoặc làm máy đơ khi render.` : hw.rating === "slow" ? "\n\nMáy sẽ chạy bằng CPU nên đọc chậm hơn GPU, nhất là với video dài." : "";
    if (!await confirmDialog({
      title: "Cài engine giọng đọc local",
      message: `${what} Có thể mất ${hw.variant === "cuda" ? "10–30" : "5–15"} phút tùy tốc độ mạng; trong lúc cài vẫn dùng app bình thường.${warn}

Tiếp tục?`,
      confirmLabel: hw.rating === "poor" ? "Vẫn cài" : "Tải & cài",
      danger: hw.rating === "poor"
    }))
      return;
    install.mutate(void 0, { onError: (e) => toast.error(e.message) });
  };
  const removeEngine = async () => {
    if (!await confirmDialog({ title: "Gỡ engine giọng local", message: "Xóa Python, PyTorch và model (giải phóng ổ đĩa). Giọng clone của bạn vẫn được giữ.", danger: true, confirmLabel: "Gỡ" }))
      return;
    uninstall.mutate(void 0, { onSuccess: () => toast.success("Đã gỡ engine giọng local"), onError: (e) => toast.error(e.message) });
  };
  return <div className="flex flex-col gap-space-sm rounded-xl border border-overlay/[0.08] bg-surface-container-lowest p-space-md">
    <div className="flex flex-wrap items-center justify-between gap-space-sm">
      <h3 className="flex items-center gap-space-sm text-label-md text-on-surface">
        <Cpu size={15} className="text-secondary" />
        {" Giọng đọc local – VieNeu-TTS"}
        <Badge tone="neutral">Nâng cao</Badge>
      </h3>
      {s && (running ? <Badge tone="secondary">Đang cài…</Badge> : s.installed ? <Badge tone="success">Đã cài</Badge> : <Badge tone={s.eligible ? "neutral" : "warning"}>{s.eligible ? "Chưa cài" : "Không cài được"}</Badge>)}
    </div>
    <p className="text-body-sm text-on-surface-variant">
      Chạy model giọng tiếng Việt ngay trên máy: miễn phí, không giới hạn ký tự, 25 giọng có sẵn (Bắc / Trung / Nam) và clone giọng từ 3–15 giây giọng mẫu. Mã nguồn mở Apache 2.0 – audio dùng thương mại được.
    </p>
    <div className="flex flex-col gap-space-xs rounded-lg bg-surface-container p-space-sm text-label-sm">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <span className="flex min-w-0 items-center gap-1.5">
          <StatusDot health={hw ? RATING[hw.rating].health : "idle"} />
          {hw ? <>
            <span className="text-on-surface-variant">Đánh giá cấu hình:</span>
            <Badge tone={RATING[hw.rating].tone}>{RATING[hw.rating].label}</Badge>
            <span className="text-outline">{"· bản "}{hw.variant === "cuda" ? "GPU" : "CPU"}</span>
          </> : <span className={error ? "text-error" : "text-on-surface-variant"}>
            {s ? "Không đánh giá được cấu hình" : error ? `Không đọc được trạng thái: ${error.message}` : "Đang dò cấu hình máy…"}
          </span>}
        </span>
        <Button size="sm" variant="subtle" disabled={detect.isPending || running} onClick={() => detect.mutate({ detect: true })}>
          {detect.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {" Dò lại"}
        </Button>
      </div>
      {hw && <>
        <dl className="grid grid-cols-[auto_1fr] gap-x-space-md gap-y-0.5 font-mono text-code">
          <dt className="text-outline">CPU</dt>
          <dd className="truncate text-right text-on-surface" title={hw.cpu}>{hw.cpu}{" · "}{hw.threads}{" luồng"}</dd>
          <dt className="text-outline">RAM</dt>
          <dd className="text-right text-on-surface">{hw.ramGb.toFixed(0)}{" GB"}</dd>
          <dt className="text-outline">GPU</dt>
          <dd className="truncate text-right text-on-surface">
            {s?.gpu ? `${s.gpu.name} · ${(s.gpu.vramMb / 1024).toFixed(1)} GB · driver ${s.gpu.driver}` : "Không có GPU rời NVIDIA"}
          </dd>
          <dt className="text-outline">Ổ đĩa trống</dt>
          <dd className="text-right text-on-surface">
            {hw.diskFreeGb == null ? "—" : `${hw.diskFreeGb.toFixed(0)} GB`}
          </dd>
        </dl>
        <ul className="flex flex-col gap-0.5 text-on-surface-variant">
          {hw.notes.map((n) => <li key={n}>{"• "}{n}</li>)}
        </ul>
      </>}
    </div>
    {s?.reason && <p className="text-label-sm text-warning">{s.reason}</p>}
    {s && running && <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-space-sm text-label-sm">
        <span className="truncate text-on-surface">{s.install.stage}</span>
        <span className="shrink-0 font-mono text-on-surface-variant">
          {Math.round(s.install.progress * 100)}
          %
          {s.install.startedAt ? ` · ${Math.round((Date.now() - s.install.startedAt) / 6e4)} phút` : ""}
        </span>
      </div>
      <Progress value={s.install.progress * 100} />
      <InstallLog lines={s.install.log} />
      <Button size="sm" variant="subtle" className="self-start" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
        <X size={12} />
        {" Hủy cài đặt"}
      </Button>
    </div>}
    {s && !running && s.install.error && <div className="flex flex-col gap-1">
      <p className="text-label-sm text-error">{"Cài đặt lỗi: "}{s.install.error}</p>
      <InstallLog lines={s.install.log} />
    </div>}
    {s && !running && !s.installed && <Button
      variant="primary"
      className="self-start"
      disabled={!s.eligible || install.isPending}
      title={s.eligible ? void 0 : s.reason ?? void 0}
      onClick={() => void startInstall()}
    >
      <Download size={14} />
      {" "}
      {s.install.error ? "Thử cài lại" : `Tải & cài engine ${hw?.variant === "cuda" ? "GPU" : "CPU"} (~${hw?.downloadGb ?? "?"} GB)`}
    </Button>}
    {s?.installed && !running && <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-space-md gap-y-0.5 font-mono text-code">
        <dt className="text-outline">Phiên bản</dt>
        <dd className="text-right text-on-surface">
          {s.installed.version}
          {" · bản "}
          {s.installed.variant === "cuda" ? "GPU" : "CPU"}
        </dd>
        <dt className="text-outline">Dung lượng</dt>
        <dd className="text-right text-on-surface">
          {gb(s.installed.sizeBytes)}
          {" · cài "}
          {formatRelative(s.installed.installedAt)}
        </dd>
        <dt className="text-outline">Engine</dt>
        <dd className="text-right text-on-surface-variant">
          {s.engine.running ? `Đang chạy · ${s.engine.device === "cuda" ? `GPU ${s.engine.gpu ?? ""}` : "CPU"}` : "Tắt (tự bật khi đọc, tự tắt sau 5 phút rảnh)"}
        </dd>
      </dl>
      {s.installed.variant === "cpu" && hw?.variant === "cuda" && <p className="text-label-sm text-secondary">
        Máy đã có GPU phù hợp – gỡ engine rồi cài lại để chuyển sang bản GPU (nhanh hơn nhiều).
      </p>}
      <CloneLibrary />
      <Button size="sm" variant="subtle" className="self-start" disabled={uninstall.isPending} onClick={() => void removeEngine()}>
        <Trash size={12} />
        {" Gỡ engine"}
      </Button>
    </>}
  </div>;
}

function InstallLog({ lines }) {
  if (!lines.length) return null;
  return <details className="text-label-sm text-on-surface-variant">
    <summary className="cursor-pointer">Chi tiết</summary>
    <pre className="scroll-thin mt-1 max-h-40 select-text overflow-auto whitespace-pre-wrap break-all rounded bg-surface-container p-space-sm font-mono text-[10px]">
      {lines.join("\n")}
    </pre>
  </details>;
}

function CloneLibrary() {
  const { data: clones = [] } = useApiQuery("localtts.clones");
  const add = useApiMutation("localtts.addClone", ["localtts.", "media.voices"]);
  const remove = useApiMutation("localtts.removeClone", ["localtts.", "media.voices"]);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const audio = useRef(null);
  const [playing, setPlaying] = useState(null);
  const play = (id, file) => {
    audio.current?.pause();
    if (playing === id) return setPlaying(null);
    const a = new Audio(mediaUrl(file));
    a.onended = () => setPlaying(null);
    audio.current = a;
    setPlaying(id);
    a.play().catch(() => setPlaying(null));
  };
  return <div className="flex flex-col gap-space-sm border-t border-overlay/[0.06] pt-space-sm">
    <span className="flex items-center gap-1.5 text-label-md text-on-surface">
      <Mic size={14} className="text-secondary" />
      {" Giọng clone ("}
      {clones.length}
      )
    </span>
    {clones.length > 0 && <ul className="flex flex-col gap-1">
      {clones.map((c) => <li key={c.id} className="flex items-center gap-space-sm rounded-lg bg-surface-container px-space-sm py-1 text-label-sm">
        <button type="button" aria-label={playing === c.id ? "Dừng" : "Nghe giọng mẫu"} onClick={() => play(c.id, c.file)} className="text-on-surface-variant hover:text-on-surface">
          {playing === c.id ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <span className="min-w-0 flex-1 truncate text-on-surface">{c.name}</span>
        <span className="font-mono text-outline">{c.durationSec.toFixed(1)}s</span>
        <button
          type="button"
          aria-label="Xóa giọng clone"
          title="Xóa giọng clone"
          disabled={remove.isPending}
          onClick={async () => {
            if (await confirmDialog({ title: "Xóa giọng clone", message: `Xóa giọng "${c.name}"? Dự án đang dùng giọng này sẽ tự chuyển về giọng có sẵn.`, danger: true, confirmLabel: "Xóa" }))
              remove.mutate({ id: c.id });
          }}
          className="text-on-surface-variant hover:text-error"
        >
          <Trash size={13} />
        </button>
      </li>)}
    </ul>}
    <div className="flex flex-wrap items-center gap-space-sm">
      <Input className="min-w-0 flex-1" placeholder="Tên giọng (vd Giọng chủ shop)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="Tên giọng clone" />
      <Button
        size="sm"
        className="h-8"
        disabled={!consent || add.isPending}
        title={consent ? "Chọn file 3–15 giây: một người nói, rõ, không nhạc nền" : "Đánh dấu xác nhận quyền dùng giọng trước"}
        onClick={() => add.mutate(
          { name, consent: true },
          {
            onSuccess: (c) => {
              if (!c) return;
              toast.success(`Đã thêm giọng "${c.name}" – chọn trong Xưởng Video (VieNeu-TTS)`);
              setName("");
            },
            onError: (e) => toast.error(e.message)
          }
        )}
      >
        {add.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <Mic size={12} />}
        {" Chọn file giọng mẫu…"}
      </Button>
    </div>
    <label className="flex items-start gap-space-sm text-label-sm text-on-surface-variant">
      <input type="checkbox" className="mt-0.5 accent-secondary" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
      Tôi xác nhận đây là giọng của tôi hoặc tôi đã được người đó cho phép sử dụng. Không clone giọng người khác khi chưa có sự đồng ý.
    </label>
  </div>;
}
