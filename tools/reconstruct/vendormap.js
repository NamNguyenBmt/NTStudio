// Build vendorMap: bundle-local vendor identifier -> import spec, using line regions of the original renderer bundle.
const fs = require("fs");
const cls = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const names = fs.readFileSync(process.argv[3], "utf8").trim().split(/\s+/);
const out = process.argv[4];
const declLine = new Map();
for (const c of cls) for (const n of c.names) declLine.set(n, c.start);

const special = {
  reactExports: { from: "react", members: true, nsName: "React" },
  React: { from: "react", default: true, local: "React" },
  React$1: { from: "react", ns: true, local: "React" },
  createRoot: { from: "react-dom/client", name: "createRoot" },
  reactDomExports: { from: "react-dom", members: true, nsName: "ReactDOM" },
  clsx: { from: "clsx", name: "clsx" },
  extendTailwindMerge: { from: "tailwind-merge", name: "extendTailwindMerge" },
  create: { from: "zustand", name: "create" },
  persist: { from: "zustand/middleware", name: "persist" },
  createJSONStorage: { from: "zustand/middleware", name: "createJSONStorage" },
  CSS: { from: "@dnd-kit/utilities", name: "CSS" },
};
const sortable = new Set(["SortableContext", "arrayMove", "sortableKeyboardCoordinates", "useSortable", "verticalListSortingStrategy", "rectSortingStrategy", "horizontalListSortingStrategy"]);
const regions = [
  [1, 3627, "@tanstack/react-query"],
  [10361, 11896, "react-router-dom"],
  [11897, 15151, "lucide-react"],
  [18622, 26857, "framer-motion"],
  [30074, 33820, "@dnd-kit/core"],
  [39845, 40422, "@dnd-kit/sortable"],
];
const map = {};
const miss = [];
for (const n of names) {
  if (special[n]) { map[n] = special[n]; continue; }
  const base = n.replace(/\$[0-9A-Za-z_$]+$/, "");
  if (sortable.has(base)) { map[n] = { from: "@dnd-kit/sortable", name: base }; continue; }
  const l = declLine.get(n);
  const reg = l && regions.find(([a, b]) => l >= a && l <= b);
  if (!reg) { miss.push(`${n}@${l}`); continue; }
  map[n] = { from: reg[2], name: base };
}
fs.writeFileSync(out, JSON.stringify(map, null, 1));
console.log("mapped", Object.keys(map).length, "missing", miss.join(" "));
