import { useApiQuery, useApiMutation } from "../../lib/api";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Switch } from "../../components/ui/Switch";
import { SegmentedControl } from "../../components/ui/SegmentedControl";

function Toggle({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-space-sm">
      <div>
        <div className="text-body-sm text-on-surface">{label}</div>
        {hint && <div className="text-label-sm text-outline">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

export function AiReplyCard() {
  const navigate = useNavigate();
  const { data: cfg } = useApiQuery("inbox.aiSettings");
  const save = useApiMutation("inbox.setAiSettings", ["inbox."]);
  const set = (patch) => save.mutate(patch);
  if (!cfg) return <Card className="h-40 animate-pulse" />;
  return (
    <Card className="flex flex-col gap-space-sm p-space-md">
      <h3 className="flex items-center gap-space-sm text-label-md uppercase tracking-wider text-on-surface-variant">
        <Sparkles size={14} className="text-secondary" />
        {" AI trả lời khách"}
      </h3>
      <SegmentedControl
        label="Chế độ AI"
        value={cfg.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { value: "off", label: "Tắt" },
          { value: "draft", label: "Soạn nháp" },
          { value: "auto", label: "Tự gửi" },
        ]}
      />
      <p className="text-label-sm text-on-surface-variant">
        {cfg.mode === "off"
          ? "AI không soạn trả lời. Luật từ khóa vẫn chạy."
          : cfg.mode === "draft"
            ? "AI soạn sẵn câu trả lời cho mọi tin mới, bạn bấm Duyệt & gửi."
            : `AI tự gửi khi chắc chắn ≥ ${Math.round(cfg.minConfidence * 100)}% và câu trả lời có trong kiến thức; câu khó, khiếu nại, thiếu thông tin vào hàng chờ duyệt.`}
      </p>
      {cfg.mode !== "off" && (
        <div className="flex flex-col gap-space-sm rounded-lg bg-surface-container-lowest p-space-sm">
          <Toggle label="Trả lời bình luận" checked={cfg.comments} onChange={(comments) => set({ comments })} />
          <Toggle
            label="Trả lời tin nhắn"
            hint="Messenger, Instagram Direct"
            checked={cfg.messages}
            onChange={(messages) => set({ messages })}
          />
          {cfg.mode === "auto" && (
            <>
              <label className="flex flex-col gap-1 text-body-sm text-on-surface">
                <span className="flex justify-between">
                  {"Ngưỡng tự gửi "}
                  <span className="font-mono text-secondary">{Math.round(cfg.minConfidence * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={60}
                  max={100}
                  step={5}
                  value={Math.round(cfg.minConfidence * 100)}
                  onChange={(e) => set({ minConfidence: Number(e.target.value) / 100 })}
                  className="accent-primary-container"
                  aria-label="Ngưỡng tin cậy tự gửi"
                />
              </label>
              <div className="grid grid-cols-3 gap-1 text-label-sm text-on-surface-variant">
                <label className="flex flex-col gap-0.5">
                  Trễ tối thiểu (s)
                  <Input
                    type="number"
                    min={0}
                    max={600}
                    defaultValue={cfg.minDelaySec}
                    onBlur={(e) => set({ minDelaySec: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  Trễ tối đa (s)
                  <Input
                    type="number"
                    min={0}
                    max={900}
                    defaultValue={cfg.maxDelaySec}
                    onBlur={(e) => set({ maxDelaySec: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  Tối đa / giờ
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    defaultValue={cfg.maxPerHour}
                    onBlur={(e) => set({ maxPerHour: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </label>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => navigate("/workspaces")}
            className="self-start text-label-sm text-primary hover:underline"
          >
            Soạn "Kiến thức trả lời khách" cho từng Pocket →
          </button>
        </div>
      )}
      <div className="flex flex-col gap-space-sm border-t border-overlay/[0.06] pt-space-sm">
        <Toggle
          label="Page tự thích bình luận"
          hint="Facebook – thả like bình luận của khách sau vài giây"
          checked={cfg.autoLike}
          onChange={(autoLike) => set({ autoLike })}
        />
        <Toggle
          label="Gắn nhãn khách tiềm năng"
          hint="Khách để lại SĐT hoặc AI nhận ra ý định mua"
          checked={cfg.tagLeads}
          onChange={(tagLeads) => set({ tagLeads })}
        />
      </div>
      <p className="text-label-sm text-outline">
        Dùng nhà cung cấp Text AI trong Cài đặt (tính phí theo key của bạn, có ngắt khi vượt hạn mức). Chỉ áp cho tin
        mới trong 30 phút.
      </p>
    </Card>
  );
}
