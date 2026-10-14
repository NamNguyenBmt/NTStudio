import { useState } from "react";
import { useApiMutation } from "../../lib/api";
import { ChevronDown, EyeOff, Eye, FlaskConical, Link2, LoaderCircle, PlugZap, Save, Trash } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { confirmDialog } from "../../components/ui/confirm";
import { Input, Select } from "../../components/ui/Input";
import { Switch } from "../../components/ui/Switch";
import { providerInfo } from "../../../../shared/providers";
import "./BudgetCard";
import "./LogsCard";
import "./DataLocationCard";
import "./MediaEngineCard";
import "./BackgroundCard";
import "./PricingCard";
import "./RoutingCard";
import { UNIT_PRICES } from "../../../../shared/pricing";

const INVALIDATES = ["ai.", "settings.", "vault.", "media."];

function providerStatus(p, keyless, dependencyMissing) {
  if (!p.enabled) return { label: "Đã tắt", tone: "neutral" };
  if (dependencyMissing) return { label: dependencyMissing, tone: "warning" };
  if (!keyless && !p.hasKey) return { label: "Chưa kích hoạt / Thiếu key", tone: "danger" };
  switch (p.status) {
    case "valid":
      return { label: "Hợp lệ", tone: "success" };
    case "invalid":
      return { label: "Key không hợp lệ", tone: "danger" };
    case "rate_limited":
      return { label: "Quá tải / Rate limited", tone: "warning" };
    default:
      return { label: keyless ? "Sẵn sàng" : "Đã lưu key · chưa kiểm tra", tone: keyless ? "success" : "secondary" };
  }
}

export function ProviderRow({ provider, compact, note, owner }) {
  const info = providerInfo(provider.provider);
  const keyless = !!info.keyless;
  const shared = !!info.keyFrom;
  const ownKey = shared && provider.hasKey;
  const [override, setOverride] = useState(ownKey);
  const showForm = !keyless && (!shared || override || ownKey);
  const usable = keyless || provider.hasKey || shared && !!owner?.hasKey;
  const [key, setKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [result, setResult] = useState(null);
  const setKeyM = useApiMutation("ai.setKey", INVALIDATES);
  const removeKey = useApiMutation("ai.removeKey", INVALIDATES);
  const update = useApiMutation("ai.updateProvider", INVALIDATES);
  const test = useApiMutation("ai.test", INVALIDATES);
  const testModel = useApiMutation("ai.testModel", INVALIDATES);
  const [advanced, setAdvanced] = useState(false);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const dependencyMissing = shared && !ownKey && !owner?.hasKey ? `Cần key ${owner?.label ?? providerInfo(info.keyFrom).label}` : void 0;
  const status = providerStatus({ ...provider, hasKey: usable }, keyless, dependencyMissing);
  const error = setKeyM.error ?? removeKey.error ?? update.error ?? test.error ?? testModel.error;
  const busy = setKeyM.isPending || test.isPending || testModel.isPending;
  const unit = provider.defaultModel ? UNIT_PRICES[provider.defaultModel] : void 0;
  const save = () => {
    if (key.trim().length < 8) return;
    setKeyM.mutate({ providerId: provider.id, key }, { onSuccess: (r) => (setKey(""), setResult(r)) });
  };
  return <div className={cn("flex flex-col gap-space-sm rounded-xl bg-surface-container p-space-md", !provider.enabled && "opacity-70")}>
    <div className="flex flex-wrap items-center justify-between gap-space-sm">
      <div className="flex min-w-0 items-center gap-space-sm">
        <span className="text-label-md text-on-surface">{provider.label}</span>
        {!compact && <Badge mono={true}>{info.tagline}</Badge>}
      </div>
      <div className="flex items-center gap-space-sm">
        <Badge tone={status.tone} mono={true}>{"● "}{status.label}</Badge>
        <Switch checked={provider.enabled} onChange={(enabled) => update.mutate({ id: provider.id, patch: { enabled } })} label={`Bật ${provider.label}`} />
      </div>
    </div>
    {compact && <p className="text-label-sm text-on-surface-variant">{info.tagline}</p>}
    {(keyless || shared) && <p className="flex flex-wrap items-center gap-1 text-body-sm text-on-surface-variant">
      {shared && <Link2 size={13} className="shrink-0 text-outline" />}
      {note ?? (ownKey ? `Đang dùng key riêng (${provider.keyPreview}) – ghi đè key ${owner?.label ?? ""}.` : shared ? `Dùng chung API key ${owner?.label ?? ""} – ${owner?.hasKey ? "đã có key" : "chưa có key"}.` : "Không cần API key.")}
      {shared && !ownKey && <button type="button" onClick={() => setOverride((v) => !v)} className="text-label-sm text-primary hover:underline">
        {override ? "Bỏ, dùng key chung" : "Dùng key riêng"}
      </button>}
    </p>}
    {shared && override && !ownKey && <p className="text-label-sm text-outline">
      {"Key riêng chỉ dùng cho "}
      {provider.label}
      {", vd key có bật billing cho tác vụ trả phí, còn "}
      {owner?.label ?? "key chung"}
      {" vẫn dùng key Free cho văn bản / kịch bản."}
    </p>}
    {showForm && <form
      className={cn("grid gap-space-sm", compact || shared ? "grid-cols-1" : "grid-cols-[1fr_220px]")}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="relative">
        <Input
          type={reveal ? "text" : "password"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={provider.hasKey ? `Đã lưu ${provider.keyPreview} – nhập để thay` : `Nhập ${info.keyPlaceholder ?? "API key"}`}
          autoComplete="off"
          spellCheck={false}
          aria-label={`API key ${provider.label}`}
          className="pr-8 font-mono"
        />
        <button
          type="button"
          aria-label={reveal ? "Ẩn key đang nhập" : "Hiện key đang nhập"}
          onClick={() => setReveal((v) => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-on-surface-variant hover:text-on-surface"
        >
          {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {!compact && !shared && info.models.length > 1 && <ModelSelect provider={provider} onChange={(m) => update.mutate({ id: provider.id, patch: { defaultModel: m } })} />}
      <button type="submit" hidden={true} />
    </form>}
    {(compact || !showForm) && info.models.length > 1 && <ModelSelect provider={provider} onChange={(m) => update.mutate({ id: provider.id, patch: { defaultModel: m } })} />}
    {unit && <p className="font-mono text-[10px] text-outline">{"Đơn giá: "}{unit.note}</p>}
    {busy && <p className="flex items-center gap-1 font-mono text-code text-on-surface-variant">
      <LoaderCircle size={12} className="animate-spin" />
      {" "}
      {setKeyM.isPending ? "Đang lưu key & kiểm tra kết nối…" : testModel.isPending ? "Đang gọi thử model…" : "Đang kiểm tra…"}
    </p>}
    {!busy && result && <p className={cn("rounded-lg px-space-sm py-1 font-mono text-code", result.ok ? "bg-success/10 text-tertiary" : "bg-danger/10 text-error")}>
      {result.ok ? "✓" : "✕"}
      {" "}
      {result.message}
      {result.latencyMs != null && ` · ${result.latencyMs} ms`}
    </p>}
    {!busy && !result && provider.lastError && provider.status !== "valid" && usable && <p className="truncate font-mono text-code text-error" title={provider.lastError}>
      {"Lỗi gần nhất: "}
      {provider.lastError}
    </p>}
    {!keyless && !shared && <div>
      <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex items-center gap-1 text-label-sm text-outline hover:text-on-surface-variant">
        <ChevronDown size={12} className={cn("transition-transform", advanced && "rotate-180")} />
        {" Endpoint tùy chỉnh"}
        {provider.baseUrl ? " (đang dùng)" : ""}
      </button>
      {advanced && <form
        className="mt-1 flex gap-space-sm"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ id: provider.id, patch: { baseUrl: baseUrl.trim() || null } });
        }}
      >
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://gateway.noi-bo/v1 (để trống = mặc định)"
          className="font-mono text-code"
          aria-label="Endpoint tùy chỉnh"
        />
        <Button size="sm" type="submit" variant="subtle" disabled={update.isPending || baseUrl.trim() === (provider.baseUrl ?? "")}>
          Lưu
        </Button>
      </form>}
    </div>}
    <div className="flex flex-wrap items-center justify-end gap-space-sm">
      {error && <span className="mr-auto text-label-sm text-error">{error.message}</span>}
      {!keyless && provider.hasKey && <Button
        size="sm"
        variant="subtle"
        disabled={removeKey.isPending}
        onClick={() => void confirmDialog({
          title: shared ? "Xóa key riêng" : "Xóa API key",
          message: shared ? `Xóa key riêng của ${provider.label}? ${provider.label} sẽ quay về dùng chung key ${owner?.label ?? ""}.` : `Xóa API key ${provider.label} khỏi két? Các tác vụ AI dùng nhà cung cấp này sẽ chuyển sang dự phòng.`,
          confirmLabel: "Xóa key",
          danger: true
        }).then((ok) => ok && removeKey.mutate({ providerId: provider.id }, { onSuccess: () => (setOverride(false), setResult(null)) }))}
      >
        <Trash size={12} />
        {" "}
        {shared ? "Xóa key riêng" : "Xóa key"}
      </Button>}
      {showForm && <Button size="sm" variant="primary" disabled={key.trim().length < 8 || busy} onClick={save}>
        <Save size={12} />
        {" "}
        {provider.hasKey ? "Thay key" : "Lưu key"}
      </Button>}
      {provider.category === "text" && <Button
        size="sm"
        variant="subtle"
        disabled={!usable || busy}
        onClick={() => testModel.mutate({ id: provider.id }, { onSuccess: setResult })}
        title="Gọi thật một câu rất ngắn để chắc model đang chọn dùng được (chi phí ~0)"
      >
        <FlaskConical size={12} />
        {" Thử model"}
      </Button>}
      <Button
        size="sm"
        variant="subtle"
        disabled={!usable || busy}
        onClick={() => test.mutate({ id: provider.id }, { onSuccess: setResult })}
        title="Gọi endpoint xác thực của nhà cung cấp (không phát sinh phí), đo độ trễ và lấy danh sách model"
      >
        <PlugZap size={12} />
        {" Check Connection"}
      </Button>
    </div>
  </div>;
}

function ModelSelect({ provider, onChange }) {
  const known = providerInfo(provider.provider).models;
  const label = (id) => known.find((k) => k.id === id)?.label ?? id;
  const models = provider.liveModels.length ? provider.liveModels.map((id) => ({ id, label: label(id) })) : known;
  const value = provider.defaultModel ?? models[0]?.id ?? "";
  const missing = value && !models.some((m) => m.id === value);
  return <Select aria-label={`Model ${provider.label}`} value={value} onChange={(e) => onChange(e.target.value)} className={cn(missing && "text-error")}>
    {missing && <option value={value}>{label(value)}{" (không còn khả dụng)"}</option>}
    {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
  </Select>;
}
