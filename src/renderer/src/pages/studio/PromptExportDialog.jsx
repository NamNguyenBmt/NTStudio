import { useState, useEffect, useMemo } from "react";
import { useApiQuery } from "../../lib/api";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Textarea, Select } from "../../components/ui/Input";
import { Switch } from "../../components/ui/Switch";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { toast } from "../../components/ui/toast";
import { fmtTime } from "./Storyboard";

const orientation = (a) => (a === "16:9" ? "horizontal 16:9" : a === "9:16" ? "vertical 9:16" : "square 1:1");
const lenText = (sec) => (sec >= 90 ? `${Math.round(sec / 60)}-minute` : `${Math.round(sec)}-second`);

function vidsPrompt(d, act) {
  const scenes = d.scenes.filter((s) => act == null || s.act === act);
  const sec = scenes.reduce((a, s) => a + s.durationSec, 0);
  const part = act != null && d.acts[act] ? ` – Part ${act + 1}/${d.acts.length}: ${d.acts[act].title}` : "";
  const offset = scenes[0]?.start ?? 0;
  return [
    `Create a ${lenText(sec)} ${orientation(d.aspect)} video titled "${d.title}"${part}.`,
    `Visual style: ${d.style || "cinematic, realistic, natural lighting"}.`,
    d.characters.length
      ? `Characters (keep each one visually identical in every scene):
${d.characters.map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.look}`).join("\n")}`
      : "",
    act != null && d.acts[act]?.summary ? `What happens in this part: ${d.acts[act].summary}` : "",
    "Voiceover and dialogue language: Vietnamese. Use the lines below word for word as the voiceover script, spoken by the named character (or a narrator).",
    `Scenes:
${scenes.map((s, i) => `${i + 1}. [${fmtTime(s.start - offset)}–${fmtTime(s.start - offset + s.durationSec)}] Visual: ${s.visual || "(match the line)"} | ${s.speaker ?? "Narrator"}: "${s.line}"`).join("\n")}`,
    "No on-screen text or titles except subtitles of the voiceover.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function flowPrompt(d, s, dialogue) {
  const say =
    dialogue && s.line.trim()
      ? `${s.speaker ? `${s.speaker} says` : "Narrator voice-over says"} in Vietnamese: "${s.line.trim()}"`
      : "";
  if (/Lighting:|Subject:|Setting:/.test(s.visual))
    return [s.visual, `${orientation(d.aspect)} video.`, say].filter(Boolean).join(" ");
  const looks = s.present.map((n) => d.characters.find((c) => c.name === n)).filter((c) => !!c);
  return [
    d.style ? `${d.style}.` : "",
    looks.map((c) => `${c.name}: ${c.look}.`).join(" "),
    s.visual ? `${s.visual.replace(/\.$/, "")}.` : "",
    `${orientation(d.aspect)} video, cinematic, smooth camera motion, no on-screen text, no subtitles.`,
    dialogue && s.line.trim()
      ? `${s.speaker ? `${s.speaker} says` : "Narrator voice-over says"} in Vietnamese: "${s.line.trim()}"`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function CopyButton({ text, label = "Chép", size = "sm" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      variant={size === "md" ? "primary" : "subtle"}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => toast.error("Không chép được vào clipboard"),
        )
      }
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Đã chép" : label}
    </Button>
  );
}

export function PromptExportDialog({ projectId, open, initialAct, onClose }) {
  const { data, isFetching } = useApiQuery("studio.promptExport", { id: projectId }, { enabled: open, staleTime: 0 });
  const [target, setTarget] = useState("vids");
  const [act, setAct] = useState(initialAct);
  const [dialogue, setDialogue] = useState(false);
  useEffect(() => {
    if (open) setAct(initialAct);
  }, [open, initialAct]);
  const vids = useMemo(() => (data ? vidsPrompt(data, act) : ""), [data, act]);
  const scenes = useMemo(() => (data ? data.scenes.filter((s) => act == null || s.act === act) : []), [data, act]);
  const flowAll = useMemo(
    () =>
      data
        ? scenes
            .map(
              (s) => `Scene ${String(s.index + 1).padStart(2, "0")}:
${flowPrompt(data, s, dialogue)}`,
            )
            .join("\n\n")
        : "",
    [data, scenes, dialogue],
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={820}
      title="Xuất prompt thủ công"
      description="Soạn prompt từ kịch bản để tự dán vào Google Vids hoặc Google Flow bằng tài khoản Google của bạn (không tốn lượt AI của app)."
      footer={
        <Button variant="subtle" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <div className="flex flex-col gap-space-md">
        <div className="flex flex-wrap items-center gap-space-sm">
          <SegmentedControl
            label="Công cụ"
            value={target}
            onChange={setTarget}
            options={[
              { value: "vids", label: "Google Vids · prompt tổng" },
              { value: "flow", label: "Google Flow / Veo · từng cảnh" },
            ]}
          />
          {data && data.acts.length > 0 && (
            <Select
              aria-label="Phạm vi"
              value={act ?? ""}
              onChange={(e) => setAct(e.target.value === "" ? null : Number(e.target.value))}
              className="w-64"
            >
              <option value="">
                Cả tập ({data.scenes.length}
                {" cảnh)"}
              </option>
              {data.acts.map((a, i) => (
                <option key={i} value={i}>
                  {"Hồi "}
                  {i + 1}
                  {": "}
                  {a.title}
                </option>
              ))}
            </Select>
          )}
          {data && (
            <Badge mono={true}>
              {scenes.length}
              {" cảnh · "}
              {fmtTime(scenes.reduce((a, s) => a + s.durationSec, 0))}
            </Badge>
          )}
        </div>
        {!data ? (
          <p className="text-body-sm text-on-surface-variant">
            {isFetching ? "Đang soạn prompt…" : "Chưa có dữ liệu."}
          </p>
        ) : scenes.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">Chưa có phân cảnh – viết kịch bản trước.</p>
        ) : target === "vids" ? (
          <>
            <ol className="list-decimal rounded-lg bg-surface-container-lowest p-space-sm pl-8 text-body-sm text-on-surface-variant">
              <li>
                Mở{" "}
                <a
                  href="https://vids.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  {"vids.google.com "}
                  <ExternalLink size={11} />
                </a>{" "}
                → tạo video mới bằng Gemini (Help me create) → dán prompt.
              </li>
              <li>Video dài: xuất và tạo theo từng hồi cho kết quả sát kịch bản hơn, rồi ghép lại trong Vids.</li>
              <li>Tải video về → Kho nội dung → thêm nội dung và chọn file video để lên lịch đăng.</li>
            </ol>
            <Textarea
              readOnly={true}
              value={vids}
              aria-label="Prompt Google Vids"
              className="min-h-[300px] font-mono text-code"
            />
            <div className="flex items-center justify-between gap-space-sm">
              <span className={vids.length > 6e3 ? "text-label-sm text-warning" : "text-label-sm text-outline"}>
                {vids.length.toLocaleString("vi-VN")}
                {" ký tự"}
                {vids.length > 6e3 ? " – khá dài, nên chọn xuất theo từng hồi" : ""}
              </span>
              <CopyButton text={vids} label="Chép prompt" size="md" />
            </div>
          </>
        ) : (
          <>
            <ol className="list-decimal rounded-lg bg-surface-container-lowest p-space-sm pl-8 text-body-sm text-on-surface-variant">
              <li>
                Mở{" "}
                <a
                  href="https://labs.google/fx/tools/flow"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  {"Google Flow "}
                  <ExternalLink size={11} />
                </a>{" "}
                (hoặc Veo trong Google Vids / Gemini) → tạo từng clip ~8 giây bằng prompt của cảnh. Cảnh dài hơn 8 giây:
                dùng "Extend" trong Flow, hoặc để app tự lặp clip cho đủ thời lượng.
              </li>
              <li>
                Nhân vật đã có ảnh trong Series AI: tải ảnh đó lên Flow làm ảnh tham chiếu (Ingredients) để Veo giữ đúng
                khuôn mặt, trang phục.
              </li>
              <li>
                Tải clip về, đặt tên theo số cảnh (<code>01.mp4</code>
                {", "}
                <code>02.mp4</code>…).
              </li>
              <li>
                {"Quay lại đây → chọn hồi → "}
                <b className="text-on-surface">Gắn nhiều clip vào hồi…</b>
                {" → Render: app ghép clip, lồng giọng đọc, phụ đề, nhạc nền."}
              </li>
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-space-sm">
              <label className="flex items-center gap-space-sm text-body-sm text-on-surface-variant">
                <Switch checked={dialogue} onChange={setDialogue} label="Kèm lời thoại" />
                Kèm lời thoại để Veo tự lồng tiếng (bỏ trống nếu dùng giọng đọc của app)
              </label>
              <CopyButton text={flowAll} label={`Chép tất cả ${scenes.length} prompt`} size="md" />
            </div>
            <ul className="scroll-thin flex max-h-[360px] flex-col gap-space-sm overflow-y-auto">
              {scenes.map((s) => {
                const text = flowPrompt(data, s, dialogue);
                return (
                  <li key={s.index} className="flex flex-col gap-1 rounded-lg bg-surface-container p-space-sm">
                    <div className="flex items-center gap-space-sm">
                      <span className="font-mono text-label-md text-on-surface">
                        {String(s.index + 1).padStart(2, "0")}
                      </span>
                      <span className="font-mono text-label-sm text-outline">
                        {fmtTime(s.start)}
                        {" · "}
                        {s.durationSec}s{data.acts.length ? ` · hồi ${s.act + 1}` : ""}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-label-sm text-on-surface-variant">
                        {s.speaker ?? "Dẫn truyện"}
                        {": "}
                        {s.line}
                      </span>
                      <CopyButton text={text} />
                    </div>
                    <p className="font-mono text-code text-on-surface-variant">{text}</p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}
