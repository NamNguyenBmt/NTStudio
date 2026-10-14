import { useState, useEffect, useRef } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { LoaderCircle, Mic, Pause, Play } from "lucide-react";
import { IconButton } from "../../components/ui/IconButton";
import { Input, Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { toast } from "../../components/ui/toast";
import { mediaUrl } from "../../lib/media";
import { providerInfo } from "../../../../shared/providers";

export function CharacterVoiceFields({ value, workspaceId, onChange }) {
  const { data: providers = [] } = useApiQuery("ai.providers", void 0, { staleTime: 6e4 });
  const tts = providers.filter((p) => p.category === "tts" && p.enabled);
  const provider = value.voiceProvider ?? "";
  const { data: voices = [], isFetching } = useApiQuery(
    "media.voices",
    { provider },
    { enabled: !!provider, staleTime: 10 * 6e4, retry: 0 },
  );
  const [profile, setProfile] = useState(value.voiceProfile ?? "");
  const [customId, setCustomId] = useState(value.voiceId ?? "");
  useEffect(() => setProfile(value.voiceProfile ?? ""), [value.voiceProfile]);
  useEffect(() => setCustomId(value.voiceId ?? ""), [value.voiceId]);
  const preview = useApiMutation("media.previewVoice");
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(false);
  };
  useEffect(() => stop, []);
  const play = () => {
    if (playing) return stop();
    preview.mutate(
      { provider, voiceId: value.voiceId, workspaceId },
      {
        onSuccess: (path) => {
          stop();
          const a = new Audio(mediaUrl(path));
          a.onended = stop;
          audio.current = a;
          setPlaying(true);
          a.play().catch(() => (stop(), toast.error("Không phát được file nghe thử")));
        },
        onError: (e) => toast.error(`Không nghe thử được: ${e.message}`),
      },
    );
  };
  const listed = voices.some((v) => v.id === value.voiceId);
  return (
    <div className="flex flex-col gap-space-sm rounded-lg border border-overlay/[0.06] p-space-sm">
      <span className="flex items-center gap-1.5 text-label-md text-on-surface">
        <Mic size={14} className="text-secondary" />
        {" Giọng nói của nhân vật"}
      </span>
      <Field
        label="Hồ sơ giọng (tiếng Anh – chèn vào prompt video)"
        hint="Giới tính, tuổi, cao độ, chất giọng, tốc độ, giọng vùng miền. AI tự gợi ý khi viết kịch bản."
      >
        {(id) => (
          <Textarea
            id={id}
            value={profile}
            maxLength={300}
            placeholder="young adult female, soft warm mid-pitch voice, calm pace, Northern Vietnamese accent"
            onChange={(e) => setProfile(e.target.value)}
            onBlur={() =>
              profile.trim() !== (value.voiceProfile ?? "").trim() && onChange({ voiceProfile: profile.trim() || null })
            }
            className="min-h-[52px] font-mono text-[12px]"
          />
        )}
      </Field>
      <div className="grid grid-cols-[150px_1fr_auto] items-end gap-space-sm">
        <Field label="Nguồn giọng cố định">
          {(id) => (
            <Select
              id={id}
              value={provider}
              onChange={(e) => onChange({ voiceProvider: e.target.value || null, voiceId: null })}
            >
              <option value="">— Chưa chọn —</option>
              {tts.map((p) => (
                <option key={p.id} value={p.provider}>
                  {p.label}
                  {!p.hasKey && !providerInfo(p.provider).keyless ? " (thiếu key)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Giọng">
          {(id) =>
            provider && voices.length ? (
              <Select
                id={id}
                value={listed ? (value.voiceId ?? "") : ""}
                onChange={(e) => onChange({ voiceId: e.target.value || null })}
              >
                <option value="">— Chọn giọng —</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={id}
                value={customId}
                disabled={!provider}
                placeholder={
                  provider ? (isFetching ? "Đang tải danh sách giọng…" : "Mã giọng (voice id)") : "Chọn nguồn trước"
                }
                onChange={(e) => setCustomId(e.target.value)}
                onBlur={() =>
                  customId.trim() !== (value.voiceId ?? "") && onChange({ voiceId: customId.trim() || null })
                }
              />
            )
          }
        </Field>
        <IconButton
          icon={preview.isPending ? LoaderCircle : playing ? Pause : Play}
          label={playing ? "Dừng nghe thử" : "Nghe thử giọng"}
          disabled={!provider || preview.isPending}
          onClick={play}
          className={preview.isPending ? "animate-spin" : void 0}
        />
      </div>
      <p className="text-label-sm text-outline">
        {"Giọng cố định dùng khi ghép tập: "}
        <b>Đổi giọng</b>
        {" cần giọng ElevenLabs (có thể nhân bản từ giọng mẫu trong tài khoản ElevenLabs của bạn); "}
        <b>Lồng tiếng</b>
        {" dùng được mọi nguồn giọng đọc."}
      </p>
    </div>
  );
}
