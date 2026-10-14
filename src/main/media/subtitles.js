const YELLOW = "&H0000D4FF&";

function ts(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 36e4);
  const m = Math.floor(cs % 36e4 / 6e3);
  const s = Math.floor(cs % 6e3 / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

const clean = (s) => s.replace(/[{}]/g, "").replace(/\\/g, "/").replace(/\s+/g, " ").trim();
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const CJK_SPLIT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー][、。，！？；：…」』）》,.!?]*|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu;
const tokenize = (text) => clean(text).split(" ").filter(Boolean).flatMap((t) => CJK.test(t) ? t.match(CJK_SPLIT) ?? [t] : [t]);

const joinWords = (raw, shown = raw) => shown.reduce((acc, w, i) => {
  if (i === 0) return w;
  const prev = raw[i - 1].slice(-1);
  const tight = CJK.test(prev) || /[、。，！？；：」』）》]/.test(prev) || CJK.test(raw[i][0]);
  return acc + (tight ? "" : " ") + w;
}, "");

function proportional(text, duration) {
  const words = tokenize(text);
  const total = words.reduce((a, w) => a + w.length + 1, 0) || 1;
  let t = 0.05;
  const usable = Math.max(0.3, duration - 0.1);
  return words.map((w) => {
    const d = (w.length + 1) / total * usable;
    const out = { text: w, start: t, end: t + d };
    t += d;
    return out;
  });
}

function timings(scene) {
  const words = tokenize(scene.text);
  if (scene.words && scene.words.length === words.length) return scene.words.map((w, i) => ({ ...w, text: words[i] }));
  return proportional(scene.text, scene.audioDuration);
}

function chunks(words) {
  const out = [];
  let cur = [];
  let weight = 0;
  for (const w of words) {
    cur.push(w);
    weight += CJK.test(w.text) ? 5 / 12 : 1;
    if (weight >= 5 || /[.,!?;:…。，！？；：、]$/.test(w.text)) {
      out.push(cur);
      cur = [];
      weight = 0;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const LOOKS = {
  "montserrat-kara-pop": {
    upper: true,
    size: [68, 72],
    marginPortrait: 0.16,
    primary: "&H00FFFFFF",
    outlineColour: "&H00000000",
    back: "&H96000000",
    borderStyle: 1,
    outline: 6,
    shadow: 3,
    active: `\\c${YELLOW}`
  },
  // Kiểu "Alex Hormozi": từ đang đọc xanh lá và phóng to nhẹ
  "hormozi-green": {
    upper: true,
    size: [68, 72],
    marginPortrait: 0.16,
    primary: "&H00FFFFFF",
    outlineColour: "&H00000000",
    back: "&H96000000",
    borderStyle: 1,
    outline: 7,
    shadow: 2,
    active: "\\c&H006BFF3B&\\fscx118\\fscy118"
  },
  // Từ đang đọc xanh neon, viền cùng màu được làm mờ → phát sáng
  "neon-glow": {
    upper: false,
    size: [64, 66],
    marginPortrait: 0.16,
    primary: "&H00FFFFFF",
    outlineColour: "&H00301010",
    back: "&H00000000",
    borderStyle: 1,
    outline: 4,
    shadow: 0,
    active: "\\c&H00FFE500&\\3c&H00FFE500&\\blur6"
  },
  "bold-outline": {
    upper: true,
    size: [66, 68],
    marginPortrait: 0.16,
    primary: "&H00FFFFFF",
    outlineColour: "&H00000000",
    back: "&H80000000",
    borderStyle: 1,
    outline: 8,
    shadow: 0,
    active: null
  },
  // Phụ đề phim: chữ vàng nhạt, viền mảnh, đặt thấp
  "movie-yellow": {
    upper: false,
    size: [54, 52],
    marginPortrait: 0.12,
    primary: "&H0060F0FF",
    outlineColour: "&H00000000",
    back: "&H80000000",
    borderStyle: 1,
    outline: 3,
    shadow: 2,
    active: null
  },
  "clean-white": {
    upper: false,
    size: [56, 56],
    marginPortrait: 0.14,
    primary: "&H00FFFFFF",
    outlineColour: "&H00000000",
    back: "&H80000000",
    borderStyle: 3,
    outline: 14,
    shadow: 0,
    active: null
  }
};

export function buildAss(scenes, style, size = { w: 1080, h: 1920 }) {
  const look = LOOKS[style] ?? LOOKS["montserrat-kara-pop"];
  const portrait = size.h > size.w;
  const fontSize = portrait ? look.size[0] : look.size[1];
  const marginV = Math.round(size.h * (portrait ? look.marginPortrait : size.w === size.h ? 0.16 : 0.09));
  const marginH = Math.round(size.w * (portrait ? 0.075 : 0.08));
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${size.w}`,
    `PlayResY: ${size.h}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Main,Montserrat Black,${fontSize},${look.primary},${look.primary},${look.outlineColour},${look.back},0,0,0,0,100,100,0,0,${look.borderStyle},${look.outline},${look.shadow},2,${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  const events = [];
  for (const scene of scenes) {
    const sceneEnd = scene.start + scene.duration;
    const groups = chunks(timings(scene));
    for (const [gi, group] of groups.entries()) {
      const next = groups[gi + 1];
      const groupEnd = Math.min(sceneEnd, scene.start + group[group.length - 1].end + 0.35, next ? scene.start + next[0].start : Infinity);
      const words = group.map((w) => look.upper ? w.text.toLocaleUpperCase("vi") : w.text);
      const active = look.active;
      if (!active) {
        const start = scene.start + group[0].start;
        if (groupEnd - start >= 0.02) events.push(`Dialogue: 0,${ts(start)},${ts(groupEnd)},Main,,0,0,0,,${joinWords(words)}`);
        continue;
      }
      group.forEach((w, i) => {
        const start = scene.start + w.start;
        const end = i < group.length - 1 ? scene.start + group[i + 1].start : groupEnd;
        if (end - start < 0.02) return;
        const text = joinWords(
          words,
          words.map((x, j) => j === i ? `{${active}}${x}{\\r}` : x)
        );
        events.push(`Dialogue: 0,${ts(start)},${ts(end)},Main,,0,0,0,,${text}`);
      });
    }
  }
  return [...header, ...events, ""].join("\n");
}
