import { useState, useEffect } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, AudioLines, Brain, Clapperboard, Gauge, KeyRound, LoaderCircle, Lock, Music, PlugZap, Route, Save, Settings2, Share2, ShieldCheck, Video } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Kbd } from "../../components/ui/Kbd";
import { StatusDot } from "../../components/ui/StatusDot";
import { toast } from "../../components/ui/toast";
import { ProviderRow } from "./ProviderRow";
import { providerInfo } from "../../../../shared/providers";
import { BudgetCard } from "./BudgetCard";
import { LogsCard } from "./LogsCard";
import { DataLocationCard } from "./DataLocationCard";
import { MediaEngineCard } from "./MediaEngineCard";
import { BackgroundCard } from "./BackgroundCard";
import { PricingCard } from "./PricingCard";
import { RoutingCard } from "./RoutingCard";
import { LocalTtsCard } from "./LocalTtsCard";
import { FlowCard } from "./FlowCard";
import { MediaSourcesCard } from "./MediaSourcesCard";
import { OmniraAiCard } from "./OmniraAiCard";
import { InstagramSetting, YoutubePublishSettings } from "./PublishSettings";

function Section({ icon: Icon, title, subtitle, children }) {
  return <Card className="flex flex-col gap-space-md p-space-md">
    <div className="flex flex-wrap items-start justify-between gap-space-md">
      <h2 className="flex items-center gap-space-sm text-headline-md text-on-surface">
        <Icon size={20} className="text-secondary" />
        {" "}
        {title}
      </h2>
      <span className="font-mono text-code text-on-surface-variant">{subtitle}</span>
    </div>
    {children}
  </Card>;
}

const MANAGED = new Set(["pexels", "pixabay"]);

const TABS = [
  { id: "ai", label: "Khóa AI", icon: KeyRound },
  { id: "publish", label: "Đăng bài", icon: Share2 },
  { id: "video", label: "Tạo video", icon: Video },
  { id: "system", label: "Hệ thống", icon: Settings2 }
];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get("tab"))?.id ?? "ai";
  return <div className="flex flex-col gap-space-lg">
    <div className="flex flex-wrap items-end justify-between gap-space-md">
      <h1 className="text-headline-lg text-on-surface">Cài đặt</h1>
      <nav className="flex flex-wrap gap-1 rounded-xl bg-surface-container-low p-1" aria-label="Nhóm cài đặt">
        {TABS.map((t) => <button
          key={t.id}
          type="button"
          onClick={() => setParams(t.id === "ai" ? {} : { tab: t.id }, { replace: true })}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-space-md py-1.5 text-label-md transition-colors",
            tab === t.id ? "bg-surface-container-highest text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface"
          )}
        >
          <t.icon size={14} />
          {" "}
          {t.label}
        </button>)}
      </nav>
    </div>
    {tab === "ai" && <AiTab />}
    {tab === "publish" && <PublishTab />}
    {tab === "video" && <VideoTab />}
    {tab === "system" && <SystemTab />}
  </div>;
}

function PublishTab() {
  return <div className="flex max-w-4xl flex-col gap-space-md"><InstagramSetting /><YoutubePublishSettings /></div>;
}

function AiTab() {
  const [, setParams] = useSearchParams();
  const { data: providers = [] } = useApiQuery("ai.providers");
  const { data: vault } = useApiQuery("vault.info");
  const { data: budget } = useApiQuery("settings.budget");
  const saveBudget = useApiMutation("settings.setBudget", ["settings."]);
  const testAll = useApiMutation("ai.testAll", ["ai.", "vault."]);
  const runTestAll = () => testAll.mutate(void 0, {
    onSuccess: (results) => {
      const tested = results.filter((r) => r.status !== "untested" || r.ok);
      const ok = tested.filter((r) => r.ok).length;
      if (ok === tested.length) toast.success(`${ok}/${tested.length} nhà cung cấp kết nối tốt`);
      else toast.error(`${tested.length - ok}/${tested.length} nhà cung cấp lỗi: ${tested.filter((r) => !r.ok).map((r) => r.label).join(", ")}`);
    },
    onError: (e) => toast.error(e.message)
  });
  const [draft, setDraft] = useState({ hardCapUsd: "", circuitBreaker: true });
  useEffect(() => {
    if (budget) setDraft({ hardCapUsd: String(budget.hardCapUsd), circuitBreaker: budget.circuitBreaker });
  }, [budget]);
  const capNum = Number(draft.hardCapUsd);
  const dirty = budget != null && (String(budget.hardCapUsd) !== draft.hardCapUsd || budget.circuitBreaker !== draft.circuitBreaker);
  const valid = draft.hardCapUsd.trim() !== "" && Number.isFinite(capNum) && capNum >= 0;
  const save = () => {
    if (dirty && valid) saveBudget.mutate({ hardCapUsd: capNum, circuitBreaker: draft.circuitBreaker });
  };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const by = (cat) => providers.filter((p) => p.category === cat && !MANAGED.has(p.provider));
  const ownerOf = (p) => {
    const from = providerInfo(p.provider).keyFrom;
    return from ? providers.find((x) => x.provider === from) : void 0;
  };
  const withKeys = providers.filter((p) => p.hasKey && !MANAGED.has(p.provider));
  return <div className="flex flex-col gap-space-md">
    <Card className="flex flex-wrap items-center justify-between gap-space-md p-space-md">
      <div className="flex max-w-3xl gap-space-sm">
        <Lock size={18} className="mt-0.5 shrink-0 text-tertiary" />
        <div>
          <div className="text-label-md text-on-surface">
            Khóa API của bạn (BYOK) – mã hóa AES-256-GCM, chỉ lưu trên máy này
          </div>
          <p className="text-body-sm text-on-surface-variant">
            Nhập key của nhà cung cấp bạn dùng (chỉ cần một vài cái). Edge-TTS và Google Flow không cần key.
            <span className="ml-1 inline-flex items-center gap-1 font-mono text-code">
              <StatusDot health={vault?.available ? "ok" : "error"} />
              {" "}
              {vault?.available ? `két ${vault.backend}` : "không có kho khóa hệ thống"}
            </span>
          </p>
        </div>
      </div>
      <div className="flex gap-space-sm">
        <Button onClick={runTestAll} disabled={testAll.isPending} title="Gọi endpoint xác thực của mọi nhà cung cấp đang bật (không phát sinh phí)">
          {testAll.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <PlugZap size={15} />}
          {" Kiểm tra tất cả"}
        </Button>
        <Button variant="primary" disabled={!dirty || !valid || saveBudget.isPending} onClick={save}>
          <Save size={15} />
          {" Lưu hạn mức "}
          <Kbd className="bg-black/20 text-on-primary">Ctrl+S</Kbd>
        </Button>
      </div>
    </Card>
    <div className="grid grid-cols-1 items-start gap-space-md xl:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-space-md">
        <Section icon={Brain} title="Văn bản AI" subtitle="Viết kịch bản, caption, trả lời tự động">
          <OmniraAiCard />
          {by("text").map((p) => <ProviderRow key={p.id} provider={p} />)}
        </Section>
        <Section icon={AudioLines} title="Giọng đọc (TTS)" subtitle={"Thuyết minh cho Reels & TikTok"}>
          <div className="grid grid-cols-1 gap-space-md lg:grid-cols-2">
            {by("tts").filter((p) => p.provider !== "local_tts").map((p) => <ProviderRow
              key={p.id}
              provider={p}
              compact={true}
              owner={ownerOf(p)}
              note={p.provider === "edge_tts" ? "Không cần API key, không giới hạn ký tự. Giọng Việt HoaiMy & NamMinh Neural." : void 0}
            />)}
          </div>
          <LocalTtsCard />
        </Section>
        <Section icon={Clapperboard} title="Ảnh / Video AI" subtitle="Key cho ảnh AI, video AI">
          <div className="grid grid-cols-1 gap-space-md lg:grid-cols-3">
            {by("media").filter((p) => p.provider !== "replicate" || p.hasKey).map((p) => <ProviderRow key={p.id} provider={p} compact={true} owner={ownerOf(p)} />)}
          </div>
          <button
            type="button"
            onClick={() => setParams({ tab: "video" }, { replace: true })}
            className="flex items-center gap-1 self-start text-label-sm text-primary hover:underline"
          >
            {"Chọn dùng nguồn nào, theo thứ tự nào (gồm Google Flow) ở tab Tạo video "}
            <ArrowRight size={12} />
          </button>
        </Section>
        <Section icon={Music} title="Nhạc nền AI (tùy chọn)" subtitle="Nhạc có quyền dùng thương mại">
          <div className="grid grid-cols-1 gap-space-md lg:grid-cols-2">
            {by("music").map((p) => <ProviderRow key={p.id} provider={p} compact={true} owner={ownerOf(p)} />)}
          </div>
        </Section>
      </div>
      <div className="flex flex-col gap-space-md xl:sticky xl:top-0">
        <BudgetCard budget={budget} draft={draft} onDraft={setDraft} />
        {saveBudget.error && <p className="text-body-sm text-error">{saveBudget.error.message}</p>}
        <RoutingCard />
        {withKeys.length > 0 && <Card className="flex flex-col gap-space-sm p-space-md">
          <h3 className="flex items-center gap-space-sm text-label-md text-on-surface">
            <Gauge size={15} className="text-secondary" />
            {" Độ trễ API"}
          </h3>
          <ul className="flex flex-col">
            {withKeys.map((p) => <li key={p.id} className="flex justify-between gap-space-sm py-1 font-mono text-code" title={p.lastError ?? void 0}>
              <span className="flex items-center gap-1.5 truncate text-on-surface">
                <StatusDot health={p.status === "valid" ? "ok" : p.status === "rate_limited" ? "warn" : p.status === "invalid" ? "error" : "idle"} />
                {p.label}
              </span>
              <span className={p.lastLatencyMs == null ? "text-outline" : p.lastLatencyMs > 800 ? "text-warning" : "text-tertiary"}>
                {p.lastLatencyMs != null ? `${p.lastLatencyMs}ms` : p.status === "invalid" ? "key sai" : "chưa đo"}
              </span>
            </li>)}
          </ul>
          <p className="flex items-start gap-1 text-label-sm text-outline">
            <ShieldCheck size={12} className="mt-0.5 shrink-0" />
            {" Không ghi prompt hay API key ra ổ đĩa – chỉ lưu số token, chi phí và loại lỗi."}
          </p>
        </Card>}
        <PricingCard />
      </div>
    </div>
  </div>;
}

function VideoTab() {
  return <div className="grid grid-cols-1 items-start gap-space-md xl:grid-cols-[1fr_360px]">
    <div className="flex flex-col gap-space-md">
      <Section icon={Route} title={"Nguồn tạo ảnh & video"} subtitle="Google Flow · Veo · Seedance · Gemini · Fal">
        <MediaSourcesCard />
      </Section>
      <Section icon={Video} title="Google Flow" subtitle={"Tạo video Veo & ảnh Nano Banana bằng tài khoản Google của bạn"}>
        <FlowCard />
      </Section>
    </div>
    <MediaEngineCard />
  </div>;
}

function SystemTab() {
  return <div className="grid grid-cols-1 items-start gap-space-md lg:grid-cols-2">
    <DataLocationCard />
    <BackgroundCard />
    <LogsCard />
  </div>;
}
