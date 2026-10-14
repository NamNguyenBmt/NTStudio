import { useState, useEffect } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, AudioLines, CalendarPlus, Clapperboard, FolderOpen, LoaderCircle, Square, Trash } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { confirmDialog } from "../../components/ui/confirm";
import { Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { Switch } from "../../components/ui/Switch";
import { Progress } from "../../components/ui/Progress";
import { toast } from "../../components/ui/toast";
import { mediaUrl } from "../../lib/media";
import { formatRelative } from "../../lib/format";
import { SUBTITLE_STYLES } from "../../../../shared/video";
import { canVietnameseSubtitle } from "../../../../shared/film";
import { FILM_VOICE_MODES, FILM_INV } from "./meta";
import { assetState } from "./AssetBoard";

const DEFAULTS = { transition: "cut", clipAudio: true, clipVolume: 1, bgmTrack: null, bgmVolume: 0.15, subtitleStyle: "none" };
const optsKey = (id) => `film.assemble.${id}`;
const mb = (b) => `${(b / 1024 ** 2).toFixed(1)} MB`;

export function AssembleStep({ detail }) {
  const { film } = detail;
  const navigate = useNavigate();
  const shots = detail.assets.filter((a) => a.kind === "shot");
  const [opts, setOpts] = useState(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(optsKey(film.id)) ?? "{}") };
    } catch {
      return DEFAULTS;
    }
  });
  const set = (p) => setOpts((o) => {
    const next = { ...o, ...p };
    try {
      localStorage.setItem(optsKey(film.id), JSON.stringify(next));
    } catch {
    }
    return next;
  });
  const { data: bgmList = [] } = useApiQuery("media.bgmList");
  const importBgm = useApiMutation("media.importBgm", ["media."]);
  const { data: st } = useApiQuery("film.assembleStatus", { filmId: film.id }, { refetchInterval: (q) => q.state.data?.running ? 700 : false });
  const { data: renders = [], refetch: refetchRenders } = useApiQuery("film.renders", { filmId: film.id });
  const assemble = useApiMutation("film.assemble", ["film.assembleStatus"]);
  const cancel = useApiMutation("film.assembleCancel", ["film.assembleStatus"]);
  const reorder = useApiMutation("film.reorder", FILM_INV);
  const update = useApiMutation("film.update", FILM_INV);
  const subLangChoice = canVietnameseSubtitle(film.dialogueLanguage);
  const subVi = subLangChoice && film.subtitleVi;
  const toContent = useApiMutation("film.renderToContent", ["content."]);
  const delRender = useApiMutation("film.deleteRender", ["film.renders"]);
  const showInFolder = useApiMutation("media.showInFolder");
  const [playing, setPlaying] = useState(null);
  useEffect(() => {
    if (st?.output && !st.running) {
      void refetchRenders();
      setPlaying(st.output);
    }
  }, [st?.output, st?.running]);
  const withVideo = shots.filter((s) => assetState(s, "video").file && s.selectedVideoTakeId);
  const total = withVideo.reduce((a, s) => a + s.durationSec, 0);
  const move = (i, dir) => {
    const ids = shots.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate({ filmId: film.id, ids });
  };
  const start = () => assemble.mutate({ filmId: film.id, options: opts }, { onSuccess: () => toast.info("Đang ghép tập – có thể chuyển trang, ghép vẫn chạy"), onError: (e) => toast.error(e.message) });
  return <div className="grid grid-cols-1 gap-space-md xl:grid-cols-[1fr_380px]">
    <div className="flex flex-col gap-space-md">
      <Card className="flex flex-col gap-space-sm p-space-md">
        <h2 className="flex items-center justify-between text-label-md text-on-surface">
          <span>Thứ tự cảnh ({withVideo.length}/{shots.length}{" có video)"}</span>
          <span className="font-mono text-outline">{"tổng ≈ "}{total}s</span>
        </h2>
        <ol className="flex flex-col gap-1">
          {shots.map((s, i) => {
            const v = assetState(s, "video");
            const ok = !!v.file && !!s.selectedVideoTakeId;
            return <li key={s.id} className={cn("flex items-center gap-space-sm rounded-lg bg-surface-container px-space-sm py-1", !ok && "opacity-50")}>
              <span className="w-6 text-right font-mono text-label-sm text-outline">{i + 1}</span>
              <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-surface-container-lowest">
                {v.poster && <img src={mediaUrl(v.poster)} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-body-sm text-on-surface">{s.summary || s.name}</div>
                <div className="truncate text-label-sm text-on-surface-variant">
                  {s.durationSec}
                  s
                  {s.dialogue ? ` · 💬 ${s.dialogue}` : ""}
                </div>
              </div>
              {!ok && <Badge tone="warning">Chưa có video</Badge>}
              <Button size="sm" variant="subtle" aria-label="Lên" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>
                <ArrowUp size={12} />
              </Button>
              <Button size="sm" variant="subtle" aria-label="Xuống" disabled={i === shots.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>
                <ArrowDown size={12} />
              </Button>
            </li>;
          })}
        </ol>
      </Card>
      <Card className="flex flex-col gap-space-sm p-space-md">
        <h2 className="text-label-md text-on-surface">Bản đã ghép ({renders.length})</h2>
        {playing && <video key={playing} src={mediaUrl(playing)} controls={true} className="max-h-[60vh] w-full rounded-lg bg-black" />}
        {renders.length === 0 ? <p className="text-body-sm text-outline">Chưa có bản nào – bấm "Ghép tập phim".</p> : <ul className="flex flex-col gap-1">
          {renders.map((r) => <li key={r.file} className={cn("flex items-center gap-space-sm rounded-lg px-space-sm py-1", playing === r.file ? "bg-surface-container-high" : "hover:bg-surface-container")}>
            <button type="button" onClick={() => setPlaying(r.file)} className="flex min-w-0 flex-1 items-center gap-space-sm text-left">
              <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-surface-container-lowest">
                {r.thumbnail && <img src={mediaUrl(r.thumbnail)} alt="" className="h-full w-full object-cover" />}
              </div>
              <span className="flex flex-col">
                <span className="text-body-sm text-on-surface">{new Date(r.createdAt).toLocaleString("vi-VN")}</span>
                <span className="font-mono text-label-sm text-outline">
                  {mb(r.sizeBytes)}
                  {" · "}
                  {formatRelative(r.createdAt)}
                </span>
              </span>
            </button>
            <Button size="sm" variant="subtle" title="Mở thư mục" aria-label="Mở thư mục" onClick={() => showInFolder.mutate({ path: r.file })}>
              <FolderOpen size={12} />
            </Button>
            <Button
              size="sm"
              variant="subtle"
              title="Lưu vào Kho nội dung để lên lịch đăng"
              disabled={toContent.isPending}
              onClick={() => toContent.mutate(
                { filmId: film.id, file: r.file },
                {
                  onSuccess: () => (toast.success("Đã lưu vào Kho nội dung – sẵn sàng lên lịch đăng"), navigate("/content")),
                  onError: (e) => toast.error(e.message)
                }
              )}
            >
              <CalendarPlus size={12} />
              {" Kho nội dung"}
            </Button>
            <Button
              size="sm"
              variant="subtle"
              aria-label="Xóa bản ghép"
              onClick={async () => {
                if (await confirmDialog({ title: "Xóa bản ghép", message: "Xóa file video này?", danger: true, confirmLabel: "Xóa" })) {
                  if (playing === r.file) setPlaying(null);
                  delRender.mutate({ filmId: film.id, file: r.file });
                }
              }}
            >
              <Trash size={12} />
            </Button>
          </li>)}
        </ul>}
      </Card>
    </div>
    <Card className="flex h-fit flex-col gap-space-md p-space-md xl:sticky xl:top-0">
      <VoiceModePanel detail={detail} />
      <Field label="Chuyển cảnh">
        {(id) => <Select id={id} value={opts.transition} onChange={(e) => set({ transition: e.target.value })}>
          <option value="cut">Cắt thẳng</option>
          <option value="fade_black">Mờ qua đen</option>
        </Select>}
      </Field>
      <div className="flex flex-col gap-1">
        <label className="flex items-center justify-between gap-space-sm text-body-sm text-on-surface">
          <span className="flex flex-col">
            Giữ tiếng của clip
            <span className="text-label-sm text-on-surface-variant">Thoại khớp môi, tiếng động do model video tạo</span>
          </span>
          <Switch label="Giữ tiếng của clip" checked={opts.clipAudio} onChange={(v) => set({ clipAudio: v })} />
        </label>
        {opts.clipAudio && <label className="flex items-center gap-space-sm text-label-sm text-on-surface-variant">
          <AudioLines size={13} />
          {" Âm lượng"}
          <input type="range" min={0} max={150} value={Math.round(opts.clipVolume * 100)} onChange={(e) => set({ clipVolume: Number(e.target.value) / 100 })} className="flex-1 accent-secondary" aria-label="Âm lượng tiếng clip" />
          <span className="w-10 text-right font-mono">{Math.round(opts.clipVolume * 100)}%</span>
        </label>}
      </div>
      <Field label="Nhạc nền (tự hạ khi có thoại)">
        {(id) => <Select
          id={id}
          value={opts.bgmTrack ?? ""}
          disabled={importBgm.isPending}
          onChange={(e) => {
            if (e.target.value === "__import") importBgm.mutate(void 0, { onSuccess: (name) => name && set({ bgmTrack: name }) });
            else set({ bgmTrack: e.target.value || null });
          }}
        >
          <option value="">Không nhạc nền</option>
          {opts.bgmTrack && !bgmList.includes(opts.bgmTrack) && <option value={opts.bgmTrack}>{opts.bgmTrack}{" (thiếu file)"}</option>}
          {bgmList.map((b) => <option key={b} value={b}>{b}</option>)}
          <option value="__import">+ Nhập file nhạc…</option>
        </Select>}
      </Field>
      {opts.bgmTrack && <label className="flex items-center gap-space-sm text-label-sm text-on-surface-variant">
        <AudioLines size={13} />
        {" Âm lượng nhạc"}
        <input type="range" min={0} max={50} value={Math.round(opts.bgmVolume * 100)} onChange={(e) => set({ bgmVolume: Number(e.target.value) / 100 })} className="flex-1 accent-secondary" aria-label="Âm lượng nhạc nền" />
        <span className="w-10 text-right font-mono">{Math.round(opts.bgmVolume * 100)}%</span>
      </label>}
      {subLangChoice && <Field label="Ngôn ngữ phụ đề" hint={subVi ? "AI dịch lời thoại từng cảnh (dịch một lần, lưu lại – sửa được trong từng cảnh quay)" : void 0}>
        {(id) => <Select
          id={id}
          value={subVi ? "vi" : "dialogue"}
          onChange={(e) => {
            const on = e.target.value === "vi";
            update.mutate({ id: film.id, patch: { subtitleVi: on } }, { onError: (err) => toast.error(err.message) });
            if (on && opts.subtitleStyle === "none") set({ subtitleStyle: "movie-yellow" });
          }}
        >
          <option value="vi">Tiếng Việt (dịch từ lời thoại)</option>
          <option value="dialogue">Theo lời thoại ({film.dialogueLanguage})</option>
        </Select>}
      </Field>}
      <Field label={subVi ? "Kiểu phụ đề" : "Phụ đề từ lời thoại"}>
        {(id) => <Select id={id} value={opts.subtitleStyle} onChange={(e) => set({ subtitleStyle: e.target.value })}>
          {[...SUBTITLE_STYLES].reverse().map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>}
      </Field>
      {subVi && opts.subtitleStyle === "none" && <span className="-mt-space-xs text-label-sm text-warning">
        Đang chọn "Không phụ đề" – chọn một kiểu để video có phụ đề tiếng Việt
      </span>}
      {st?.running ? <div className="flex flex-col gap-1">
        <div className="flex justify-between text-label-sm">
          <span className="truncate text-on-surface">{st.stage}</span>
          <span className="font-mono text-on-surface-variant">{Math.round(st.progress * 100)}%</span>
        </div>
        <Progress value={st.progress * 100} />
        <Button size="sm" variant="danger" className="self-start" onClick={() => cancel.mutate({ filmId: film.id })}>
          <Square size={12} />
          {" Hủy ghép"}
        </Button>
      </div> : <Button variant="primary" className="h-11" disabled={!withVideo.length || assemble.isPending} onClick={start}>
        {assemble.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Clapperboard size={15} />}
        {" Ghép tập phim ("}
        {withVideo.length}
        {" cảnh · "}
        {total}
        s)
      </Button>}
      {st?.error && <p className="text-label-sm text-error">{"Ghép lỗi: "}{st.error}</p>}
      {!!st?.notes.length && <ul className="text-label-sm text-warning">{st.notes.map((n) => <li key={n}>{"• "}{n}</li>)}</ul>}
      <p className="text-label-sm text-outline">
        Ghép trên máy bằng FFmpeg (GPU nếu có) – không tốn phí AI. Có thể ghép lại nhiều lần với tùy chọn khác.
      </p>
    </Card>
  </div>;
}

const PROVIDER_SHORT = { elevenlabs: "ElevenLabs", edge_tts: "Edge-TTS", openai_tts: "OpenAI", google_tts: "Gemini TTS", local_tts: "Giọng local" };

function VoiceModePanel({ detail }) {
  const { film } = detail;
  const update = useApiMutation("film.update", FILM_INV);
  const chars = detail.assets.filter((a) => a.kind === "character" && !a.proposal);
  const mode = film.voiceMode;
  const meta = FILM_VOICE_MODES.find((m) => m.id === mode) ?? FILM_VOICE_MODES[0];
  const ready = (c) => mode === "convert" ? c.voiceProvider === "elevenlabs" && !!c.voiceId : mode === "dub" ? !!c.voiceProvider && (!!c.voiceId || c.voiceProvider === "edge_tts") : true;
  const missing = chars.filter((c) => !ready(c));
  return <div className="flex flex-col gap-space-xs">
    <Field label="Giọng nhân vật" hint={meta.hint}>
      {(id) => <Select id={id} value={mode} disabled={update.isPending} onChange={(e) => update.mutate({ id: film.id, patch: { voiceMode: e.target.value } })}>
        {FILM_VOICE_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </Select>}
    </Field>
    {mode !== "clip" && chars.length > 0 && <ul className="flex flex-col gap-0.5 rounded-lg bg-surface-container-lowest p-space-sm text-label-sm">
      {chars.map((c) => <li key={c.id} className="flex items-center justify-between gap-space-sm">
        <span className="truncate text-on-surface">{c.name}</span>
        {ready(c) ? <Badge tone="success">
          {c.voiceProvider ? `${PROVIDER_SHORT[c.voiceProvider] ?? c.voiceProvider}${c.voiceId ? ` · ${c.voiceId.slice(0, 14)}` : ""}` : "OK"}
        </Badge> : <Badge tone="warning">{mode === "convert" ? "Chưa có giọng ElevenLabs" : "Chưa chọn giọng"}</Badge>}
      </li>)}
      {missing.length > 0 && <li className="pt-1 text-outline">
        {"Chọn giọng ở bước "}
        <b>Nhân vật</b>
        {" (bấm vào nhân vật › Giọng nói)."}
        {" "}
        {mode === "convert" ? "Cảnh của nhân vật chưa có giọng sẽ giữ giọng gốc." : "Chưa chọn thì dùng giọng Edge-TTS mặc định theo giới tính."}
      </li>}
    </ul>}
  </div>;
}
