import { useState } from "react";
import { call, useApiQuery } from "../../lib/api";
import { Link } from "react-router-dom";
import { Download, Megaphone, TriangleAlert, WifiOff, X } from "lucide-react";
import { cn } from "../../lib/cn";

export function CloudBanner() {
  const { data: lic } = useApiQuery("license.state", void 0, { refetchInterval: 6e4 });
  const { data: info } = useApiQuery("cloud.appInfo", void 0, { staleTime: 10 * 6e4, refetchInterval: 30 * 6e4 });
  const [closed, setClosed] = useState(new Set());
  const notices = [];
  if (info?.announcement)
    notices.push({ id: `ann:${info.announcement}`, tone: info.announcementLevel === "critical" ? "critical" : info.announcementLevel === "warn" ? "warn" : "info", icon: Megaphone, text: info.announcement });
  if (info?.updateAvailable)
    notices.push({
      id: `upd:${info.latestVersion}`,
      tone: "info",
      icon: Download,
      text: <>
        {"Đã có NT Studio "}
        {info.latestVersion}
        {" (bạn đang dùng "}
        {info.currentVersion}
        ).
        {" "}
        {info.downloadUrl && <button type="button" className="font-semibold underline" onClick={() => void call("system.openExternal", { url: info.downloadUrl })}>
          Tải bản mới
        </button>}
      </>
    });
  if (lic?.needRelogin) notices.push({ id: "relogin", tone: "warn", icon: TriangleAlert, text: "Phiên đăng nhập NT đã hết hạn – đăng xuất rồi đăng nhập lại để tiếp tục gia hạn license." });
  if (lic?.status === "offline")
    notices.push({
      id: "offline",
      tone: "warn",
      icon: WifiOff,
      text: `Không kết nối được NT Cloud – đang dùng ngoại tuyến tới ${lic.tokenExpiresAt ? new Date(lic.tokenExpiresAt).toLocaleString("vi-VN") : "—"}.`
    });
  const daysLeft = lic?.entitlementEndsAt ? Math.ceil((new Date(lic.entitlementEndsAt).getTime() - Date.now()) / 864e5) : null;
  if (daysLeft != null && daysLeft <= 7)
    notices.push({
      id: `exp:${lic?.plan}`,
      tone: daysLeft <= 2 ? "critical" : "warn",
      icon: TriangleAlert,
      text: <>
        {lic?.trial ? "Gói dùng thử" : `Gói ${lic?.planName}`}
        {" còn "}
        {Math.max(daysLeft, 0)}
        {" ngày."}
        {" "}
        <Link to="/billing" className="font-semibold underline">{lic?.trial ? "Mua gói" : "Gia hạn"}</Link>
      </>
    });
  const shown = notices.filter((n) => n.tone === "critical" || !closed.has(n.id));
  if (!shown.length) return null;
  return <div className="flex flex-col">
    {shown.map((n) => <div
      key={n.id}
      className={cn(
        "flex items-center gap-space-sm px-space-md py-1.5 text-body-sm",
        n.tone === "critical" ? "bg-danger/15 text-error" : n.tone === "warn" ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"
      )}
    >
      <n.icon size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">{n.text}</span>
      {n.tone !== "critical" && <button type="button" aria-label="Đóng thông báo" onClick={() => setClosed((s) => new Set(s).add(n.id))} className="rounded p-0.5 hover:bg-overlay/[0.08]">
        <X size={13} />
      </button>}
    </div>)}
  </div>;
}
