const clean = (s) => (s ?? "").trim().replace(/\s+/g, " ").replace(/[.;,\s]+$/, "");

export function composeShotPrompt(shot, bible) {
  const byName = new Map((bible?.characters ?? []).map((c) => [c.name.trim().toLowerCase(), c]));
  const subjects = [
    ...shot.characters.map((n) => {
      const c = byName.get(n.trim().toLowerCase());
      return c ? `${c.name} (${clean(c.look)})` : clean(n);
    }),
    ...shot.product && bible?.product ? [`the ${bible.product.name} (${clean(bible.product.look)})`] : []
  ].filter(Boolean);
  const parts = [
    clean(shot.cameraAngle) && clean(shot.cameraMovement) ? `${clean(shot.cameraAngle)}, ${clean(shot.cameraMovement)}` : clean(shot.cameraAngle) || clean(shot.cameraMovement),
    subjects.length ? `Subject: ${subjects.join("; ")}` : "",
    clean(shot.action) ? `Action: ${clean(shot.action)}` : "",
    clean(shot.setting) ? `Setting: ${clean(shot.setting)}` : "",
    clean(shot.lighting) ? `Lighting: ${clean(shot.lighting)}` : "",
    clean(shot.look) ? `Look: ${clean(shot.look)}` : "",
    [clean(shot.style), clean(bible?.style)].filter(Boolean).length ? `Style: ${[clean(shot.style), clean(bible?.style)].filter(Boolean).join(", ")}` : "",
    clean(shot.sound) ? `Sound: ${clean(shot.sound)}` : "",
    "No on-screen text, no subtitles, no watermark"
  ].filter(Boolean);
  return parts.join(". ") + ".";
}

export function stillImagePrompt(prompt) {
  return prompt.replace(/(^|\.\s*)Sound:[^.]*\./i, "$1").replace(/,\s*(slow |smooth |fast )?(dolly|push|pull|pan|tilt|tracking|crane|handheld|orbit|zoom)[^.]*\./i, ".").trim();
}

export function bibleBrief(bible) {
  if (!bible) return "";
  return [
    `Visual bible (dùng xuyên suốt, KHÔNG đổi): style = ${bible.style}`,
    bible.characters.length ? `Nhân vật: ${bible.characters.map((c) => `${c.name} = ${c.look}`).join(" | ")}` : "",
    bible.product ? `Sản phẩm: ${bible.product.name} = ${bible.product.look}` : ""
  ].filter(Boolean).join("\n");
}

const replaceAll = (s, from, to) => from ? s.split(from).join(to) : s;

export function rebiblePrompt(prompt, prev, next) {
  let out = prompt;
  prev.characters.forEach((c, i) => {
    const n = next.characters[i];
    out = replaceAll(out, `${c.name} (${clean(c.look)})`, n ? `${n.name} (${clean(n.look)})` : c.name);
  });
  if (prev.product) {
    const p = prev.product;
    out = replaceAll(out, `the ${p.name} (${clean(p.look)})`, next.product ? `the ${next.product.name} (${clean(next.product.look)})` : `the ${p.name}`);
  }
  const oldStyle = clean(prev.style);
  const newStyle = clean(next.style);
  if (oldStyle && out.includes(oldStyle)) out = replaceAll(out, oldStyle, newStyle);
  else if (!oldStyle && newStyle) {
    out = /Style: [^.]*\./.test(out) ? out.replace(/Style: ([^.]*)\./, `Style: $1, ${newStyle}.`) : out.replace(/No on-screen text/, `Style: ${newStyle}. No on-screen text`);
  }
  return out.replace(/Style: , /, "Style: ").replace(/, \./g, ".");
}
