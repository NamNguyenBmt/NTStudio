// Print versions of key packages bundled in each asar
const asar = require("E:/Omnira Studio Source/node_modules/@electron/asar");
const pk = ["react", "react-dom", "framer-motion", "motion-dom", "motion-utils", "lucide-react", "@tanstack/react-query", "@tanstack/query-core", "react-router", "react-router-dom", "@remix-run/router", "zustand", "zod", "drizzle-orm", "better-sqlite3", "playwright-core", "@anthropic-ai/sdk", "tailwind-merge", "clsx", "@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities", "msedge-tts", "ffmpeg-static", "ffprobe-static"];
const res = {};
for (const a of process.argv.slice(2)) {
  for (const p of pk) {
    let v = "-";
    try { v = JSON.parse(asar.extractFile(a, ["node_modules", ...p.split("/"), "package.json"].join("\\"))).version; } catch {}
    (res[p] ||= []).push(v);
  }
}
for (const [p, vs] of Object.entries(res)) console.log(vs.every((v) => v === vs[0]) ? "  " : "!!", p, vs.join("  ->  "));
