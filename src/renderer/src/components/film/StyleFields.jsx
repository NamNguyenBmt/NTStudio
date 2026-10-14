import { useState, useEffect } from "react";
import { Input, Textarea, Select } from "../ui/Input";
import { Field } from "../ui/Field";
import { FILM_GENRES, FILM_STYLES, DIALOGUE_LANGUAGES, DEFAULT_DIALOGUE_LANGUAGE, CUSTOM } from "../../../../shared/film";

function PresetOrCustom({
  label,
  hint,
  presets,
  value,
  emptyLabel,
  placeholder,
  onCommit
}) {
  const v = value?.trim() ?? "";
  const [custom, setCustom] = useState(!!v && !presets.includes(v));
  const [text, setText] = useState(custom ? v : "");
  useEffect(() => {
    if (v && !presets.includes(v)) setCustom(true), setText(v);
    else if (v) setCustom(false);
  }, [v]);
  return <Field label={label} hint={hint}>
    {(id) => <div className="flex flex-col gap-1">
      <Select
        id={id}
        value={custom ? CUSTOM : v}
        onChange={(e) => {
          const next = e.target.value;
          if (next === CUSTOM) return setCustom(true);
          setCustom(false);
          setText("");
          onCommit(next || null);
        }}
      >
        {emptyLabel !== void 0 && <option value="">{emptyLabel}</option>}
        {presets.map((p) => <option key={p} value={p}>{p}</option>)}
        <option value={CUSTOM}>Khác (tự nhập)…</option>
      </Select>
      {custom && <Input
        autoFocus={!text}
        value={text}
        maxLength={120}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const t = text.trim();
          if (t !== v) onCommit(t || (emptyLabel !== void 0 ? null : DEFAULT_DIALOGUE_LANGUAGE));
        }}
      />}
    </div>}
  </Field>;
}

export function StyleFields({ value, onChange }) {
  const [notes, setNotes] = useState(value.notes ?? "");
  useEffect(() => setNotes(value.notes ?? ""), [value.notes]);
  return <div className="flex flex-col gap-space-sm">
    <div className="grid grid-cols-2 gap-space-sm">
      <PresetOrCustom
        label="Thể loại"
        presets={FILM_GENRES.map((g) => g.label)}
        value={value.genre}
        emptyLabel="— Không chọn —"
        placeholder="VD: phim võ thuật Việt Nam thời Lý"
        onCommit={(genre) => onChange({ genre })}
      />
      <PresetOrCustom
        label="Phong cách hình ảnh"
        presets={FILM_STYLES.map((s) => s.label)}
        value={value.visualStyle}
        emptyLabel="— AI tự đề xuất —"
        placeholder="VD: màu phim cũ, tông vàng ấm, ánh nến"
        onCommit={(visualStyle) => onChange({ visualStyle })}
      />
    </div>
    <PresetOrCustom
      label="Ngôn ngữ thoại"
      presets={DIALOGUE_LANGUAGES.map((l) => l.label)}
      value={value.dialogueLanguage}
      placeholder="VD: Tiếng Thái"
      onCommit={(l) => onChange({ dialogueLanguage: l ?? DEFAULT_DIALOGUE_LANGUAGE })}
    />
    <Field label="Ghi chú thêm (không bắt buộc)" hint="Viết tiếng Việt thoải mái – hệ thống tự chuyển thành prompt tối ưu cho ảnh / video">
      {(id) => <Textarea
        id={id}
        value={notes}
        maxLength={2e3}
        placeholder="VD: bối cảnh Hà Nội những năm 80, trang phục giản dị, tông màu trầm, nhiều cảnh mưa"
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes.trim() !== (value.notes ?? "").trim() && onChange({ notes: notes.trim() || null })}
        className="min-h-[70px]"
      />}
    </Field>
  </div>;
}
