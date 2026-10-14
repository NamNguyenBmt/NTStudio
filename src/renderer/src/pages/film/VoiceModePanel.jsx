import { useApiMutation } from "../../lib/api";
import { Badge } from "../../components/ui/Badge";
import { Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { FILM_VOICE_MODES, FILM_INV } from "./meta";

const PROVIDER_SHORT = {
  elevenlabs: "ElevenLabs",
  edge_tts: "Edge-TTS",
  openai_tts: "OpenAI",
  google_tts: "Gemini TTS",
  local_tts: "Giọng local",
};

export function VoiceModePanel({ detail }) {
  const { film } = detail;
  const update = useApiMutation("film.update", FILM_INV);
  const chars = detail.assets.filter((a) => a.kind === "character" && !a.proposal);
  const mode = film.voiceMode;
  const meta = FILM_VOICE_MODES.find((m) => m.id === mode) ?? FILM_VOICE_MODES[0];
  const ready = (c) =>
    mode === "convert"
      ? c.voiceProvider === "elevenlabs" && !!c.voiceId
      : mode === "dub"
        ? !!c.voiceProvider && (!!c.voiceId || c.voiceProvider === "edge_tts")
        : true;
  const missing = chars.filter((c) => !ready(c));
  return (
    <div className="flex flex-col gap-space-xs">
      <Field label="Giọng nhân vật" hint={meta.hint}>
        {(id) => (
          <Select
            id={id}
            value={mode}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ id: film.id, patch: { voiceMode: e.target.value } })}
          >
            {FILM_VOICE_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {mode !== "clip" && chars.length > 0 && (
        <ul className="flex flex-col gap-0.5 rounded-lg bg-surface-container-lowest p-space-sm text-label-sm">
          {chars.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-space-sm">
              <span className="truncate text-on-surface">{c.name}</span>
              {ready(c) ? (
                <Badge tone="success">
                  {c.voiceProvider
                    ? `${PROVIDER_SHORT[c.voiceProvider] ?? c.voiceProvider}${c.voiceId ? ` · ${c.voiceId.slice(0, 14)}` : ""}`
                    : "OK"}
                </Badge>
              ) : (
                <Badge tone="warning">{mode === "convert" ? "Chưa có giọng ElevenLabs" : "Chưa chọn giọng"}</Badge>
              )}
            </li>
          ))}
          {missing.length > 0 && (
            <li className="pt-1 text-outline">
              {"Chọn giọng ở bước "}
              <b>Nhân vật</b>
              {" (bấm vào nhân vật › Giọng nói)."}{" "}
              {mode === "convert"
                ? "Cảnh của nhân vật chưa có giọng sẽ giữ giọng gốc."
                : "Chưa chọn thì dùng giọng Edge-TTS mặc định theo giới tính."}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
