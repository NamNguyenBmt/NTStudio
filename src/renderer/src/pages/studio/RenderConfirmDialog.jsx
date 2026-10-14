import { useApiQuery } from "../../lib/api";
import { Clapperboard, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { formatCredits } from "../../components/shell/FlowCredits";
import { ASPECT_LABEL, TRANSITION_LABEL, SUBTITLE_STYLES, durationLabel } from "../../../../shared/video";
import { formatById } from "../../../../shared/content-formats";

const RENDER_MODE_LABEL = {
  stock: "Tiết kiệm (video có sẵn)",
  semi_ai: "Bán tự động (ảnh AI + chuyển động)",
  full_ai: "Full AI Video (Veo)",
};

const SCENE_MODE_LABEL = {
  veo: "Video AI",
  image: "Ảnh AI",
  stock: "Video có sẵn",
  upload: "Clip / ảnh của bạn",
  none: "Không hình",
};

const CLIP_AUDIO_LABEL = {
  tts: "Chỉ giọng đọc (bỏ tiếng clip)",
  mix: "Giọng đọc + tiếng clip làm nền",
  clip: "Dùng tiếng clip (AI tự lồng tiếng)",
};

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-label-sm uppercase tracking-wider text-outline">{title}</h4>
      <dl className="grid grid-cols-[150px_1fr] gap-x-space-sm gap-y-1 rounded-lg bg-surface-container-lowest p-space-sm text-body-sm">
        {children}
      </dl>
    </section>
  );
}

function Row({ k, children, warn }) {
  return (
    <>
      <dt className="text-on-surface-variant">{k}</dt>
      <dd className={cn("min-w-0 break-words", warn ? "text-warning" : "text-on-surface")}>{children}</dd>
    </>
  );
}

export function RenderConfirmDialog({
  open,
  project,
  sceneCount,
  totalSec,
  channelName,
  ttsLabel,
  estimate,
  onConfirm,
  onCancel,
}) {
  const { data: flow } = useApiQuery("flow.status", void 0, { enabled: open });
  const est = estimate;
  const counts = (est?.scenes ?? []).reduce((a, s) => ({ ...a, [s.mode]: (a[s.mode] ?? 0) + 1 }), {});
  const veoScenes = est?.scenes.filter((s) => s.mode === "veo") ?? [];
  const veoNew = veoScenes.filter((s) => !s.cached).length;
  const viaFlow = flow?.source === "flow" && veoScenes.length > 0;
  const subtitle = SUBTITLE_STYLES.find((s) => s.id === project.subtitleStyle)?.label ?? project.subtitleStyle;
  const bible = project.visualBible;
  const offBy = Math.abs(totalSec - project.targetDurationSec);
  const cost = est && est.totalUsd > 0 ? `≈ $${est.totalUsd.toFixed(2)}` : "Miễn phí";
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width={640}
      title="Kiểm tra lại trước khi render"
      description={"Xem lại các lựa chọn bên dưới. Cần đổi gì thì bấm “Sửa lại”, đúng rồi thì bấm “Xác nhận & render”."}
      footer={
        <>
          <Button variant="subtle" onClick={onCancel}>
            Sửa lại
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            <Clapperboard size={14} />
            {" Xác nhận & render"}
            {est && est.totalUsd > 0 ? ` (${cost})` : ""}
          </Button>
        </>
      }
    >
      <div className="scroll-thin flex max-h-[62vh] flex-col gap-space-md overflow-y-auto pr-1">
        <Section title="Nội dung">
          <Row k="Chủ đề">{project.topic}</Row>
          <Row k="Mẫu định dạng">{formatById(project.format).label}</Row>
          <Row k="Thời lượng" warn={offBy > 3}>
            {durationLabel(Math.round(totalSec))}
            {" · "}
            {sceneCount}
            {" cảnh"}
            {offBy > 3 && ` (mục tiêu ${durationLabel(project.targetDurationSec)})`}
          </Row>
          <Row k="Khung hình">{ASPECT_LABEL[project.aspect]}</Row>
          <Row k="Chuyển cảnh">{TRANSITION_LABEL[project.transition]}</Row>
          <Row k="Kênh đích" warn={!channelName}>
            {channelName ?? "Chưa chọn (không có watermark / brand voice của Pocket)"}
          </Row>
        </Section>
        <Section title="Hình ảnh">
          <Row k="Chế độ">{RENDER_MODE_LABEL[project.renderMode]}</Row>
          {est && (
            <Row k="Nguồn hình từng cảnh">
              {Object.entries(counts)
                .map(([m, n]) => `${SCENE_MODE_LABEL[m]}: ${n}`)
                .join(" · ")}
              {est.cachedScenes > 0 && (
                <span className="text-outline">
                  {" · "}
                  {est.cachedScenes}
                  {" cảnh dùng lại từ lần trước"}
                </span>
              )}
            </Row>
          )}
          {veoScenes.length > 0 && (
            <Row k="Tạo video AI bằng">
              {viaFlow ? `Google Flow – ${flow?.model}` : (est?.veoModel ?? "Veo API")}
              {veoNew > 0 && ` · ${veoNew} clip mới`}
            </Row>
          )}
          {viaFlow && (
            <Row k="Credit Flow còn" warn={flow?.credits != null && flow.credits < 100}>
              {flow?.credits != null ? `${formatCredits(flow.credits)} credit` : "chưa đọc được"}
              {veoNew > 0 && <span className="text-outline">{" · mỗi clip Veo Fast ~20, Quality ~100 credit"}</span>}
            </Row>
          )}
          <Row k="Ảnh tham chiếu">
            {project.referenceImages.length ? `${project.referenceImages.length} ảnh` : "Không có"}
          </Row>
          {bible && (bible.characters.length > 0 || bible.product) && (
            <Row k="Bộ nhận diện">
              {[...bible.characters.map((c) => c.name), ...(bible.product ? [bible.product.name] : [])].join(", ")}
            </Row>
          )}
        </Section>
        <Section title="Âm thanh">
          <Row k="Lời thoại">
            {project.narration
              ? `Có – ${ttsLabel}${project.voiceId ? ` · ${project.voiceId}` : ""}`
              : "Không lời thoại (chỉ hình + âm thanh)"}
          </Row>
          <Row k="Phụ đề">{project.narration ? subtitle : "Không (video không lời thoại)"}</Row>
          <Row k="Tiếng clip">
            {project.narration ? CLIP_AUDIO_LABEL[project.clipAudio] : "Giữ tiếng clip (tiếng môi trường)"}
          </Row>
          <Row k="Nhạc nền">
            {project.bgmTrack ? `${project.bgmTrack} · âm lượng ${Math.round(project.bgmVolume * 100)}%` : "Không có"}
          </Row>
        </Section>
        <Section title="Chi phí ước tính">
          {est ? (
            <>
              {est.veoSeconds > 0 && (
                <Row k={`Video AI (${viaFlow ? `Google Flow – ${flow?.model}` : est.veoModel})`}>
                  {est.veoUsd > 0
                    ? `${est.veoSeconds} giây ≈ $${est.veoUsd.toFixed(2)}`
                    : `${est.veoSeconds} giây (trừ credit Flow)`}
                </Row>
              )}
              {est.images > 0 && (
                <Row k={`Ảnh AI (${est.imageModel})`}>{`${est.images} ảnh ≈ $${est.imageUsd.toFixed(2)}`}</Row>
              )}
              {est.ttsChars > 0 && (
                <Row k="Giọng đọc">{`${est.ttsChars.toLocaleString("vi-VN")} ký tự ≈ $${est.ttsUsd.toFixed(2)}`}</Row>
              )}
              <Row k="Tổng">
                <b>{cost}</b>
                {est.veoSeconds > 0 && (
                  <span className="text-outline">{" · mỗi cảnh video AI mất khoảng 1–3 phút"}</span>
                )}
              </Row>
            </>
          ) : (
            <Row k="Tổng">Không ước tính được</Row>
          )}
        </Section>
        {est && est.warnings.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/10 p-space-sm text-body-sm text-warning">
            {est.warnings.map((w) => (
              <li key={w} className="flex gap-1.5">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
