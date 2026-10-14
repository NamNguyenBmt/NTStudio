import { useState } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { createPortal } from "react-dom";
import { Clapperboard, FlaskConical, FolderOpen, LoaderCircle, LogIn, LogOut, Power, RefreshCw, ShieldCheck, X, Zap } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { confirmDialog } from "../../components/ui/confirm";
import { Input, Select } from "../../components/ui/Input";
import { Switch } from "../../components/ui/Switch";
import { StatusDot } from "../../components/ui/StatusDot";
import { toast } from "../../components/ui/toast";
import { mediaUrl } from "../../lib/media";
import { formatRelative } from "../../lib/format";
import { FLOW_CREDITS_LOW, formatCredits } from "../../components/shell/FlowCredits";
import { FLOW_MODEL_OPTIONS, FLOW_ACCOUNT_ID } from "./MediaSourcesCard";

const INV = ["flow.", "film.gate", "studio.", "render."];

export function FlowCard() {
  const { data: s } = useApiQuery("flow.status", void 0, { refetchInterval: 5e3 });
  const setModel = useApiMutation("flow.setModel", INV);
  const setPrefs = useApiMutation("flow.setPrefs", INV);
  const openLogin = useApiMutation("flow.openLogin", INV);
  const check = useApiMutation("flow.check", INV);
  const close = useApiMutation("flow.close", INV);
  const reset = useApiMutation("flow.reset", INV);
  const test = useApiMutation("flow.test", INV);
  const cancelTest = useApiMutation("flow.cancelTest");
  const openDiag = useApiMutation("flow.openDiagnostics");
  const [prompt, setPrompt] = useState("A calm ocean wave rolling onto a sandy beach at sunset, cinematic");
  const [result, setResult] = useState(null);
  const refreshCredits = useApiMutation("flow.refreshCredits", INV);
  const lowCredits = s?.credits != null && s.credits < FLOW_CREDITS_LOW;
  const readCredits = () => refreshCredits.mutate(void 0, {
    onSuccess: (r) => r.credits !== null ? toast.success(`Google Flow còn ${formatCredits(r.credits)} credit`) : toast.error("Chưa đọc được số credit trên Google Flow"),
    onError: (e) => toast.error(e.message)
  });
  const login = () => openLogin.mutate(void 0, {
    onSuccess: () => toast.info("Đã mở Chrome – đăng nhập tài khoản Google có gói Google AI, vào được Flow thì ĐÓNG cửa sổ Chrome; app sẽ tự kiểm tra"),
    onError: (e) => toast.error(e.message)
  });
  const doCheck = () => check.mutate(void 0, {
    onSuccess: (r) => r.loggedIn ? toast.success(`Đã đăng nhập Google Flow${r.email ? ` – ${r.email}` : ""}`) : toast.error("Chưa đăng nhập Google Flow trong cửa sổ Chrome"),
    onError: (e) => toast.error(e.message)
  });
  const signOut = async () => {
    if (!await confirmDialog({ title: "Đăng xuất Google Flow", message: "Đóng Chrome của Flow và xóa profile (cookie, phiên Google) khỏi máy. Lần sau cần đăng nhập lại.", danger: true, confirmLabel: "Đăng xuất" }))
      return;
    reset.mutate(void 0, { onSuccess: () => toast.success("Đã xóa phiên Google Flow khỏi máy"), onError: (e) => toast.error(e.message) });
  };
  const runTest = (dryRun) => test.mutate(
    { prompt, aspect: "16:9", dryRun },
    {
      onSuccess: (r) => r.file ? (setResult(r.file), toast.success("Flow đã tạo xong video thử")) : toast.success("Kiểm tra giao diện Flow: mọi bước OK (chưa bấm tạo, không tốn credit) – ảnh chụp trong thư mục chẩn đoán"),
      onError: (e) => /Đã hủy/.test(e.message) ? toast.info("Đã hủy chạy thử") : toast.error(e.message)
    }
  );
  return <div id={FLOW_ACCOUNT_ID} className="flex scroll-mt-space-md flex-col gap-space-sm rounded-xl border border-overlay/[0.08] bg-surface-container-lowest p-space-md">
    <h3 className="flex items-center gap-space-sm text-label-md text-on-surface">
      <Clapperboard size={15} className="text-secondary" />
      {" Tài khoản Google Flow"}
    </h3>
    <p className="text-body-sm text-on-surface-variant">
      {"Đã có gói Google AI (Plus / Pro / Ultra)? Đăng nhập một lần: app mở Chrome trên máy bạn với một profile riêng, tự nhập prompt vào Flow, chờ tạo xong rồi tải file về. Video trừ vào credit Flow của gói, ảnh Nano Banana không tốn credit, app không tính phí. Chọn dùng Flow cho video / ảnh ở thẻ "}
      <b>{"Nguồn tạo ảnh & video"}</b>
      {" phía trên."}
    </p>
    <p className="flex items-start gap-1.5 text-label-sm text-tertiary">
      <ShieldCheck size={13} className="mt-0.5 shrink-0" />
      {" Bạn tự đăng nhập Google trong cửa sổ Chrome. Phiên đăng nhập chỉ nằm trong profile Chrome trên máy này: app không đọc mật khẩu và không gửi cookie hay video đi đâu."}
    </p>
    {s && <>
      <div className="flex flex-col gap-space-xs rounded-lg bg-surface-container p-space-sm text-label-sm">
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusDot health={!s.chromePath ? "error" : s.loggedIn ? "ok" : "warn"} live={s.busy} />
            {!s.chromePath ? <span className="text-error">Không tìm thấy Google Chrome / Microsoft Edge – cài Chrome để dùng Flow</span> : s.loggedIn ? <span className="text-on-surface">
              Đã đăng nhập
              {s.email ? ` · ${s.email}` : ""}
              {s.checkedAt && <span className="text-outline">{" · kiểm tra "}{formatRelative(s.checkedAt)}</span>}
            </span> : <span className="text-warning">Chưa đăng nhập Google Flow</span>}
          </span>
          <span className="flex items-center gap-1">
            {s.loginWindow && <Badge tone="warning">Cửa sổ đăng nhập đang mở</Badge>}
            {s.checking && <Badge tone="secondary">Đang kiểm tra phiên…</Badge>}
            {s.running && <Badge tone="secondary">Chrome đang mở</Badge>}
            {s.busy && <Badge tone="primary">Đang tạo video</Badge>}
          </span>
        </div>
        {s.loggedIn && <div className="flex flex-wrap items-center gap-space-sm">
          <span className="flex items-center gap-1 text-on-surface-variant">
            <Zap size={13} className={lowCredits ? "text-warning" : "text-secondary"} />
            {" Credit còn lại:"}
            <b className={cn("font-mono tabular-nums", lowCredits ? "text-warning" : "text-on-surface")}>
              {s.credits !== null ? formatCredits(s.credits) : "chưa đọc"}
            </b>
            {s.tier && <Badge tone="secondary">{s.tier}</Badge>}
            {s.creditsAt && <span className="text-outline">{"· cập nhật "}{formatRelative(s.creditsAt)}</span>}
          </span>
          <Button size="sm" variant="subtle" disabled={refreshCredits.isPending || s.busy || s.loginWindow || s.checking} onClick={readCredits}>
            {refreshCredits.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {" Đọc lại credit"}
          </Button>
          {lowCredits && <span className="text-warning">
            Sắp hết credit – mỗi video Veo Fast tốn khoảng 20 credit, Quality khoảng 100.
          </span>}
        </div>}
        {s.chromePath && <div className="truncate font-mono text-code text-outline" title={s.chromePath}>{s.chromePath}</div>}
        {s.loginWindow && <div className="text-warning">
          Đăng nhập Google trong cửa sổ Chrome vừa mở. Vào được trang Flow rồi thì đóng cửa sổ Chrome đó – app sẽ tự kiểm tra đăng nhập.
        </div>}
      </div>
      <div className="flex flex-wrap gap-space-sm">
        <Button size="sm" variant={s.loggedIn ? "subtle" : "primary"} disabled={!s.chromePath || openLogin.isPending || s.loginWindow || s.busy} onClick={login}>
          {openLogin.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <LogIn size={13} />}
          {" Mở Chrome để đăng nhập"}
        </Button>
        <Button size="sm" variant="subtle" disabled={!s.chromePath || check.isPending || s.loginWindow || s.checking} onClick={doCheck}>
          {check.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {" Kiểm tra đăng nhập"}
        </Button>
        {s.running && <Button size="sm" variant="subtle" disabled={close.isPending || s.busy} onClick={() => close.mutate()}>
          <Power size={13} />
          {" Đóng Chrome"}
        </Button>}
        {s.profile && <Button size="sm" variant="subtle" className="hover:text-error" disabled={reset.isPending || s.busy} onClick={() => void signOut()}>
          <LogOut size={13} />
          {" Đăng xuất & xóa phiên"}
        </Button>}
      </div>
      <div className="flex flex-wrap items-center gap-space-sm text-label-sm text-on-surface-variant">
        <span>Model Veo trong Flow:</span>
        <div className="w-72">
          <Select aria-label="Model Veo trong Flow" value={s.model} disabled={setModel.isPending} onChange={(e) => setModel.mutate({ model: e.target.value })}>
            {FLOW_MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </div>
        <span className="text-outline">
          App tự chuyển Flow sang chế độ Video, 1 kết quả, đúng tỉ lệ khung hình
          {s.model === "Omni 1.1 Flash" ? ", 720p; mỗi clip dài 4 / 6 / 8 / 10 giây theo thời lượng cảnh." : "; Veo 3.1 trong Flow luôn tạo clip 8 giây."}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-space-sm md:grid-cols-2">
        <div className="flex items-center justify-between gap-space-sm rounded-lg border border-overlay/[0.06] p-space-sm">
          <div>
            <div className="text-label-md text-on-surface">Chạy ẩn</div>
            <div className="text-label-sm text-outline">
              Cửa sổ Chrome tạo video nằm ngoài màn hình – chỉ cửa sổ đăng nhập hiện ra. Tắt để xem app thao tác trên Flow.
            </div>
          </div>
          <Switch checked={s.hidden} disabled={setPrefs.isPending} onChange={(hidden) => setPrefs.mutate({ hidden })} label="Chạy ẩn" />
        </div>
        <div className="flex items-center justify-between gap-space-sm rounded-lg border border-overlay/[0.06] p-space-sm">
          <div>
            <div className="text-label-md text-on-surface">Số video tạo cùng lúc</div>
            <div className="text-label-sm text-outline">
              Mỗi luồng một tab và một dự án Flow riêng. Nhiều luồng nhanh hơn nhưng Flow có thể giới hạn tần suất.
              {s.maxConcurrency < 4 ? ` Gói hiện tại tối đa ${s.maxConcurrency} luồng.` : ""}
              {s.active || s.waiting ? ` Đang tạo ${s.active}${s.waiting ? ` · chờ ${s.waiting}` : ""}.` : ""}
            </div>
          </div>
          <div className="w-20 shrink-0">
            <Select aria-label="Số video tạo cùng lúc" value={s.concurrency} disabled={setPrefs.isPending} onChange={(e) => setPrefs.mutate({ concurrency: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n} disabled={n > s.maxConcurrency}>
                {n}
                {n > s.maxConcurrency ? " (nâng gói)" : ""}
              </option>)}
            </Select>
          </div>
        </div>
      </div>
      {s.loggedIn && <div className="flex flex-col gap-space-xs rounded-lg border border-overlay/[0.06] p-space-sm">
        <span className="text-label-sm text-on-surface-variant">
          Tạo thử một video (kiểm tra tự động hóa trên máy bạn – trừ credit Flow như tạo bình thường)
        </span>
        <div className="flex gap-space-sm">
          <Input value={prompt} maxLength={1e3} onChange={(e) => setPrompt(e.target.value)} aria-label="Prompt chạy thử" />
          {test.isPending ? <Button size="sm" variant="subtle" onClick={() => cancelTest.mutate()}>
            <LoaderCircle size={13} className="animate-spin" />
            {" Đang tạo… "}
            <X size={13} />
          </Button> : <>
            <Button size="sm" variant="subtle" disabled={prompt.trim().length < 3} onClick={() => runTest(true)} title="Làm mọi bước (chế độ Video, model, tải khung hình mẫu, nhập prompt) nhưng không bấm tạo">
              <ShieldCheck size={13} />
              {" Kiểm tra (0 credit)"}
            </Button>
            <Button size="sm" variant="primary" disabled={prompt.trim().length < 3} onClick={() => runTest(false)}>
              <FlaskConical size={13} />
              {" Chạy thử"}
            </Button>
          </>}
        </div>
        <span className="text-label-sm text-outline">
          Thường mất 1–3 phút. Đừng thao tác trong cửa sổ Chrome của Flow khi app đang tạo video.
        </span>
      </div>}
      {s.diagnosticsDir && <div className="flex flex-wrap items-center justify-between gap-space-sm text-label-sm text-on-surface-variant">
        <span>
          Có ảnh chụp chẩn đoán từ lần tự động hóa bị lỗi (giao diện Flow có thể đã đổi) – gửi cho bộ phận hỗ trợ để cập nhật.
        </span>
        <Button size="sm" variant="subtle" onClick={() => openDiag.mutate()}>
          <FolderOpen size={13} />
          {" Mở thư mục chẩn đoán"}
        </Button>
      </div>}
      <p className="text-label-sm text-outline">
        Lưu ý: Flow không có API chính thức – app điều khiển giao diện web của Flow nên có thể lỗi khi Google đổi giao diện, và việc tự động hóa có thể không phù hợp điều khoản của Google.
      </p>
    </>}
    {result && createPortal(
      <Dialog open={true} onClose={() => setResult(null)} title="Video thử từ Google Flow" width={760}>
        <video src={mediaUrl(result)} controls={true} autoPlay={true} playsInline={true} className="max-h-[65vh] w-full rounded-lg bg-black object-contain" />
      </Dialog>,
      document.body
    )}
  </div>;
}
