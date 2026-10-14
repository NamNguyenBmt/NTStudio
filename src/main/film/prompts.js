import { dialogueLanguageEn } from "../../shared/film";

const framing = (a) => (a === "16:9" ? "horizontal 16:9" : a === "1:1" ? "square 1:1" : "vertical 9:16");
const styleLine = (f) => (f.style.trim() ? ` Visual style: ${f.style.trim()}.` : "");
const NO_TEXT = " No text, no captions, no logos, no watermark.";

export function characterSheetPrompt(look, style) {
  return (
    `Character reference sheet for a film, showing ONE person: ${look.trim()}. Layout side by side on a plain light-grey studio background: one full-body front view, then face close-ups from the front, three-quarter and profile angles. Identical face, hairstyle and outfit in every view, neutral expression, even soft lighting.` +
    (style.trim() ? ` Visual style: ${style.trim()}.` : "") +
    NO_TEXT
  );
}

export function characterPrompt(f, a) {
  return characterSheetPrompt(a.description.trim() || a.name, f.style);
}

export function locationPrompt(f, a) {
  return `Establishing wide shot of a film location, ${framing(f.aspect)} frame: ${a.description.trim() || a.name}. No people. Cinematic composition and lighting.${styleLine(f)}${NO_TEXT}`;
}

export function shotPrompt(f, shot, chars, loc) {
  const refs = [];
  chars.forEach((c, i) => refs.push(`reference image ${i + 1} is the character sheet of ${c.name}`));
  if (loc) refs.push(`reference image ${chars.length + 1} is the location`);
  return [
    `Cinematic film still, ${framing(f.aspect)} frame.`,
    shot.camera.trim() ? `Camera: ${shot.camera.trim()}.` : "",
    `Action: ${shot.description.trim() || shot.summary}.`,
    loc ? `Location: ${loc.description.trim() || loc.name}.` : "",
    chars.length ? `Characters: ${chars.map((c) => `${c.name} – ${c.description.trim()}`).join("; ")}.` : "",
    refs.length
      ? `Use the attached references (${refs.join("; ")}): keep every character's face, hair and outfit exactly as in their sheet, and match the location.`
      : "",
    styleLine(f).trim(),
    "Natural poses, realistic proportions and hands." + NO_TEXT,
  ]
    .filter(Boolean)
    .join(" ");
}

export function parseDialogue(text) {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^([^:]{1,40}):\s*(.+)$/);
      return m ? { speaker: m[1].trim(), line: m[2].trim() } : { speaker: null, line: l };
    });
}

export function videoPrompt(f, shot, withAudio, chars = []) {
  const lang = dialogueLanguageEn(f.dialogueLanguage);
  const lines = lang ? parseDialogue(shot.dialogue) : [];
  const voiceOf = (name) => {
    const c = name ? chars.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase()) : void 0;
    return c?.voiceProfile?.trim() ? ` (voice: ${c.voiceProfile.trim()})` : "";
  };
  return [
    // Lời thoại đặt ĐẦU prompt (model bám phần đầu) – nói đúng câu, đúng ngôn ngữ, không tự chế lời
    withAudio && lines.length
      ? `Dialogue in ${lang}, lip-synced, spoken exactly as written: ${lines.map((d) => (d.speaker ? `${d.speaker}${voiceOf(d.speaker)} says "${d.line}"` : `"${d.line}"`)).join("; ")}. No other speech${lang !== "English" ? ", no English" : ""}.`
      : "",
    `${shot.description.trim() || shot.summary}.`,
    shot.camera.trim() ? `Camera: ${shot.camera.trim()}.` : "",
    withAudio ? "Natural ambient sound and foley matching the scene, no background music." : "",
    "Keep every character, outfit and the location exactly as in the first frame; smooth, realistic motion.",
    styleLine(f).trim(),
    "No on-screen text, no subtitles, no watermark.",
  ]
    .filter(Boolean)
    .join(" ");
}
