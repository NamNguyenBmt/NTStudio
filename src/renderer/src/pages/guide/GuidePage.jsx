import { useApiQuery } from "../../lib/api";
import { useSearchParams } from "react-router-dom";
import { Check, CircleCheck, Info, PlugZap, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { PlatformIcon } from "../../components/PlatformIcon";
import { PlatformBadge } from "../../components/PlatformBadge";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ConnectFacebookButton, ConnectTiktokButton, ConnectYoutubeButton } from "../accounts/ConnectButtons";
import { InstagramSetting } from "../settings/PublishSettings";

const connected = (c) => c.tokenStatus === "valid" || c.tokenStatus === "expiring";

function Note({ tone = "info", children }) {
  const Icon = tone === "warning" ? TriangleAlert : Info;
  return <div className={cn("flex gap-space-sm rounded-lg p-space-sm text-body-sm", tone === "warning" ? "bg-warning/10 text-on-surface" : "bg-secondary/10 text-on-surface")}>
    <Icon size={15} className={cn("mt-0.5 shrink-0", tone === "warning" ? "text-warning" : "text-secondary")} />
    <div className="min-w-0">{children}</div>
  </div>;
}

function Step({ n, title, done, children }) {
  return <li className="relative flex gap-space-md pb-space-lg last:pb-0">
    <span className={"absolute left-[13px] top-8 h-[calc(100%-2rem)] w-px bg-outline-variant/50 [li:last-child>&]:hidden"} aria-hidden={true} />
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-label-md",
        done ? "bg-success/20 text-tertiary" : "bg-surface-container-highest text-on-surface-variant"
      )}
    >
      {done ? <Check size={15} /> : n}
    </span>
    <div className="flex min-w-0 flex-1 flex-col gap-space-sm pt-0.5">
      <h3 className="flex flex-wrap items-center gap-space-sm text-body-lg font-semibold text-on-surface">
        {title}
        {done && <Badge tone="success">Xong</Badge>}
      </h3>
      <div className="flex flex-col gap-space-sm text-body-sm text-on-surface-variant">{children}</div>
    </div>
  </li>;
}

function StatusTile({ platform, label, status, ok, active, onClick }) {
  return <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex items-center gap-space-md rounded-xl border p-space-md text-left transition-colors",
      active ? "border-primary bg-primary/10" : "border-outline-variant/40 bg-surface-container hover:bg-surface-container-high"
    )}
  >
    <PlatformBadge platform={platform} className="shrink-0" />
    <div className="min-w-0 flex-1">
      <div className="text-label-md text-on-surface">{label}</div>
      <div className={cn("truncate text-body-sm", ok ? "text-tertiary" : "text-on-surface-variant")}>{status}</div>
    </div>
    {ok && <CircleCheck size={18} className="shrink-0 text-tertiary" />}
  </button>;
}

function ConnectedList({ channels, empty }) {
  if (!channels.length) return <p className="text-body-sm text-outline">{empty}</p>;
  return <ul className="flex flex-wrap gap-space-xs">
    {channels.map((c) => <li key={c.id}>
      <Badge tone={c.quotaBlocked ? "warning" : connected(c) ? "success" : "danger"}>
        {c.handle ? `@${c.handle}` : c.name}
        {c.quotaBlocked ? " – ngoài hạn mức" : !connected(c) ? " – cần kết nối lại" : ""}
      </Badge>
    </li>)}
  </ul>;
}

const b = (s) => <b className="text-on-surface">{s}</b>;

function FacebookGuide({ pages }) {
  return <ol className="flex flex-col">
    <Step n={1} title="Bấm Kết nối Facebook" done={pages.some(connected)}>
      <p>Cửa sổ đăng nhập Facebook mở ra ngay trong app.</p>
      <div><ConnectFacebookButton variant="primary" /></div>
    </Step>
    <Step n={2} title="Đăng nhập tài khoản đang quản trị Fanpage">
      <p>{"Dùng tài khoản Facebook có quyền "}{b("quản trị / biên tập")}{" các Fanpage cần đăng bài."}</p>
    </Step>
    <Step n={3} title="Chọn Fanpage và bấm Tiếp tục">
      <p>
        {"Tick các Fanpage (và tài khoản Instagram nếu có) muốn dùng, giữ nguyên các quyền được đề xuất rồi bấm "}
        {b("Tiếp tục / Lưu")}
        . App tự thêm toàn bộ Fanpage đã chọn – không cần lấy token thủ công.
      </p>
    </Step>
    <Step n={4} title="Xong" done={pages.some(connected)}>
      <ConnectedList channels={pages} empty="Chưa có Fanpage nào được kết nối." />
      <Note>
        Muốn thêm Fanpage sau này: bấm Kết nối lại Facebook và tick thêm trang. Số kênh dùng được tùy theo gói của bạn.
      </Note>
    </Step>
  </ol>;
}

function InstagramGuide({ fbReady, igChannels }) {
  return <ol className="flex flex-col">
    <Step n={1} title="Chuyển Instagram sang tài khoản chuyên nghiệp">
      <p>
        {"Trong ứng dụng Instagram: "}
        {b("Cài đặt → Loại tài khoản và công cụ → Chuyển sang tài khoản chuyên nghiệp")}
        {" (chọn Nhà sáng tạo hoặc Doanh nghiệp). Miễn phí, đổi lại được bất cứ lúc nào."}
      </p>
    </Step>
    <Step n={2} title="Liên kết Instagram với một Fanpage">
      <p>
        {"Trên Facebook, chuyển sang Fanpage → "}
        {b("Cài đặt → Tài khoản được liên kết → Instagram → Kết nối")}
        . Mỗi tài khoản Instagram gắn với một Fanpage.
      </p>
    </Step>
    <Step n={3} title="Bật kết nối Instagram"><InstagramSetting /></Step>
    <Step n={4} title="Kết nối lại Facebook và tick tài khoản Instagram" done={igChannels.some(connected)}>
      <p>
        Trong cửa sổ Facebook có bước chọn tài khoản Instagram – tick tài khoản cần dùng. App tự thêm kênh Instagram dưới Fanpage tương ứng.
      </p>
      <div>
        <ConnectFacebookButton variant="primary" label="Kết nối lại Facebook + Instagram" disabled={!fbReady} />
      </div>
      {!fbReady && <p className="text-label-sm text-outline">Kết nối Facebook trước (tab Facebook).</p>}
      <ConnectedList channels={igChannels} empty="Chưa có tài khoản Instagram nào được kết nối." />
    </Step>
    <li>
      <Note>
        Instagram đăng được Reels (video). Ảnh / carousel và Story chưa hỗ trợ đăng tự động do giới hạn của Instagram.
      </Note>
    </li>
  </ol>;
}

function TiktokGuide({ channels }) {
  return <ol className="flex flex-col">
    <Step n={1} title="Bấm Kết nối TikTok" done={channels.some(connected)}>
      <div><ConnectTiktokButton variant="primary" /></div>
    </Step>
    <Step n={2} title="Đăng nhập TikTok và bấm Cho phép">
      <p>
        {"Đăng nhập đúng tài khoản TikTok muốn đăng video, giữ nguyên các quyền rồi bấm "}
        {b("Authorize / Cho phép")}
        . Token tự gia hạn, không phải đăng nhập lại thường xuyên.
      </p>
    </Step>
    <Step n={3} title="Xong" done={channels.some(connected)}>
      <ConnectedList channels={channels} empty="Chưa có kênh TikTok nào được kết nối." />
      <Note>
        Mỗi lần bấm Kết nối TikTok thêm được một tài khoản – đăng xuất TikTok trong cửa sổ đăng nhập để thêm tài khoản khác.
      </Note>
    </Step>
  </ol>;
}

function YoutubeGuide({ channels }) {
  return <ol className="flex flex-col">
    <Step n={1} title="Bấm Kết nối YouTube" done={channels.some(connected)}>
      <p>
        Trình duyệt mặc định trên máy sẽ mở trang đăng nhập Google (Google không cho đăng nhập trong cửa sổ của app).
      </p>
      <div><ConnectYoutubeButton variant="primary" /></div>
    </Step>
    <Step n={2} title="Chọn tài khoản Google, chọn kênh và bấm Cho phép">
      <p>
        {"Tick đồng ý các quyền (đặc biệt "}
        {b("Quản lý video YouTube")}
        ). Thấy trang "Kết nối thành công" thì quay lại app – kênh tự xuất hiện.
      </p>
    </Step>
    <Step n={3} title="Xong" done={channels.some(connected)}>
      <ConnectedList channels={channels} empty="Chưa có kênh YouTube nào được kết nối." />
      <Note>Video dọc ≤ 3 phút tự đăng thành Shorts. Chế độ hiển thị, danh mục video chỉnh ở Cài đặt → Đăng bài.</Note>
    </Step>
  </ol>;
}

const TabLabel = ({ platform, text }) => <span className="flex items-center gap-1.5"><PlatformIcon platform={platform} size={14} />{" "}{text}</span>;

export function GuidePage() {
  const [params, setParams] = useSearchParams();
  const tab = ["facebook", "instagram", "tiktok", "youtube"].find((t) => t === params.get("tab")) ?? "facebook";
  const setTab = (t) => setParams({ tab: t }, { replace: true });
  const { data: channels = [] } = useApiQuery("channels.list", {});
  const pages = channels.filter((c) => c.platform === "facebook");
  const igs = channels.filter((c) => c.platform === "instagram");
  const tts = channels.filter((c) => c.platform === "tiktok");
  const yts = channels.filter((c) => c.platform === "youtube");
  const st = (list, unit) => {
    const n = list.filter(connected).length;
    const blocked = list.filter((c) => c.quotaBlocked).length;
    if (!n) return { text: "Chưa kết nối", ok: false };
    return { text: `${n} ${unit} đã kết nối${blocked ? ` · ${blocked} ngoài hạn mức` : ""}`, ok: true };
  };
  const fb = st(pages, "Fanpage");
  const ig = st(igs, "tài khoản");
  const tt = st(tts, "kênh");
  const yt = st(yts, "kênh");
  return <div className="flex flex-col gap-space-md">
    <Card className="flex flex-col gap-space-md p-space-md">
      <div className="flex flex-wrap items-start justify-between gap-space-md">
        <div className="max-w-3xl">
          <h1 className="flex items-center gap-space-sm text-headline-md text-on-surface">
            <PlugZap size={20} className="text-secondary" />
            {" Hướng dẫn kết nối kênh"}
          </h1>
          <p className="text-body-sm text-on-surface-variant">
            Chỉ cần bấm Kết nối và đăng nhập – không phải tạo ứng dụng hay lấy token. App tự gia hạn kết nối cho bạn.
          </p>
        </div>
        <SegmentedControl
          label="Nền tảng"
          value={tab}
          onChange={setTab}
          options={[
            { value: "facebook", label: <TabLabel platform="facebook" text="Facebook" /> },
            { value: "instagram", label: <TabLabel platform="instagram" text="Instagram" /> },
            { value: "tiktok", label: <TabLabel platform="tiktok" text="TikTok" /> },
            { value: "youtube", label: <TabLabel platform="youtube" text="YouTube" /> }
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-space-sm md:grid-cols-2 xl:grid-cols-4">
        <StatusTile platform="facebook" label="Facebook Fanpage" status={fb.text} ok={fb.ok} active={tab === "facebook"} onClick={() => setTab("facebook")} />
        <StatusTile platform="instagram" label="Instagram" status={ig.text} ok={ig.ok} active={tab === "instagram"} onClick={() => setTab("instagram")} />
        <StatusTile platform="tiktok" label="TikTok" status={tt.text} ok={tt.ok} active={tab === "tiktok"} onClick={() => setTab("tiktok")} />
        <StatusTile platform="youtube" label="YouTube" status={yt.text} ok={yt.ok} active={tab === "youtube"} onClick={() => setTab("youtube")} />
      </div>
    </Card>
    <Card className="p-space-lg">
      {tab === "facebook" && <FacebookGuide pages={pages} />}
      {tab === "instagram" && <InstagramGuide fbReady={pages.some(connected)} igChannels={igs} />}
      {tab === "tiktok" && <TiktokGuide channels={tts} />}
      {tab === "youtube" && <YoutubeGuide channels={yts} />}
    </Card>
  </div>;
}
