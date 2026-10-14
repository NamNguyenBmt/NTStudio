export const FEATURE_LABEL = {
  STUDIO: "Xưởng video AI",
  SERIES: "Series AI",
  FILM: "Xưởng phim",
  FLOW: "Tạo ảnh / video bằng Google Flow",
  CALENDAR: "Lịch đăng bài",
  INBOX: "Hộp thư hợp nhất",
  ANALYTICS: "Phân tích số liệu"
};

export const isFeatureCode = (s) => s in FEATURE_LABEL;

const LEGACY_LABEL = {
  "xưởng video ai": "STUDIO",
  "series ai": "SERIES",
  "xưởng phim": "FILM",
  "lịch đăng bài": "CALENDAR",
  "hộp thư hợp nhất": "INBOX"
};

export function normalizeFeatures(list) {
  const out = new Set();
  for (const raw of list ?? []) {
    const s = raw.trim();
    const code = isFeatureCode(s.toUpperCase()) ? s.toUpperCase() : LEGACY_LABEL[s.toLowerCase()];
    if (code) out.add(code);
  }
  return [...out];
}

const FEATURE_NAMESPACES = [
  ["film.", "FILM"],
  ["series.", "SERIES"],
  ["studio.", "STUDIO"],
  ["render.start", "STUDIO"],
  ["plan.toVideo", "STUDIO"],
  ["flow.", "FLOW"],
  ["posts.", "CALENDAR"],
  ["inbox.", "INBOX"],
  ["analytics.", "ANALYTICS"],
  ["insights.", "ANALYTICS"]
];

const VIEW_ONLY = new Set([
  "film.gate",
  "film.list",
  "film.get",
  "film.estimate",
  "film.renders",
  "film.queue",
  "film.assembleStatus",
  "series.list",
  "series.get",
  "studio.projects",
  "studio.get",
  "flow.status",
  "posts.range",
  "posts.worker",
  "posts.stagger",
  "inbox.conversations",
  "inbox.messages",
  "inbox.stats",
  "inbox.quickReplies",
  "inbox.rules",
  "inbox.aiSettings",
  "inbox.worker",
  "analytics.overview",
  "analytics.goals",
  "insights.last",
  "insights.bestHours"
]);

export function featureForEndpoint(endpoint) {
  if (VIEW_ONLY.has(endpoint)) return null;
  for (const [prefix, code] of FEATURE_NAMESPACES) if (prefix.endsWith(".") ? endpoint.startsWith(prefix) : endpoint === prefix) return code;
  return null;
}
