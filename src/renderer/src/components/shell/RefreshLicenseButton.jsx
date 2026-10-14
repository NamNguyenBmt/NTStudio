import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api";
import { RefreshCw } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { toast } from "../ui/toast";

export function RefreshLicenseButton() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const lic = await call("license.refresh");
      await qc.invalidateQueries();
      if (lic.usable) toast.success(`Đã cập nhật gói & quyền: ${lic.planName ?? "gói hiện tại"}`);
      else toast.info(lic.message ?? "Đã kiểm tra lại gói – chưa có gói đang hoạt động");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return <IconButton icon={RefreshCw} label={"Làm mới gói & quyền"} onClick={() => void run()} disabled={busy} className={busy ? "[&>svg]:animate-spin" : void 0} />;
}
