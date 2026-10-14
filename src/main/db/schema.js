import { sql } from "drizzle-orm";
import { text, integer, sqliteTable, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);
const updatedAt = () => integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);
const ts = (name) => integer(name, { mode: "timestamp_ms" });
const json = (name) => text(name, { mode: "json" }).$type();
export const PLATFORMS = ["facebook", "tiktok", "instagram", "youtube"];

export const workspaces = sqliteTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#c0c1ff"),
  icon: text("icon"),
  description: text("description"),
  brandVoice: text("brand_voice"),
  /** Kiến thức để AI trả lời khách: bảng giá, size, phí ship, chính sách đổi trả, giờ mở cửa… */
  knowledge: text("knowledge"),
  watermarkPath: text("watermark_path"),
  watermarkPosition: text("watermark_position", { enum: ["tl", "tr", "bl", "br", "center"] }).default("br"),
  watermarkOpacity: real("watermark_opacity").notNull().default(0.85),
  /** Hashtag / nhãn ngách hiển thị trên thẻ Pocket */
  tags: json("tags").notNull().default([]),
  /** Ngân sách AI (USD/tháng) riêng của Pocket – null = dùng hạn mức chung */
  aiBudgetUsd: real("ai_budget_usd"),
  goldenHours: json("golden_hours").notNull().default([]),
  /** Hạn mức token AI / tháng cho Pocket (null = không giới hạn) */
  aiTokenQuota: integer("ai_token_quota"),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: ts("archived_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const proxies = sqliteTable(
  "proxies",
  {
    id: id(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    protocol: text("protocol", { enum: ["socks5", "http", "https"] }).notNull().default("socks5"),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    username: text("username"),
    /** → secrets.id (kind = proxy_password) */
    passwordSecretId: text("password_secret_id"),
    country: text("country"),
    kind: text("kind", { enum: ["residential", "datacenter", "mobile", "isp"] }),
    exitIp: text("exit_ip"),
    latencyMs: integer("latency_ms"),
    health: text("health", { enum: ["ok", "warn", "error", "idle"] }).notNull().default("idle"),
    lastCheckedAt: ts("last_checked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("proxies_workspace_idx").on(t.workspaceId)]
);

export const browserProfiles = sqliteTable("browser_profiles", {
  id: id(),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  userAgent: text("user_agent"),
  locale: text("locale").default("vi-VN"),
  timezone: text("timezone").default("Asia/Ho_Chi_Minh"),
  canvasNoise: integer("canvas_noise", { mode: "boolean" }).notNull().default(true),
  webrtcShield: integer("webrtc_shield", { mode: "boolean" }).notNull().default(true),
  webglVendor: text("webgl_vendor"),
  /** Thư mục userData của profile, tương đối với app userData */
  dataDir: text("data_dir"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    displayName: text("display_name").notNull(),
    handle: text("handle"),
    externalId: text("external_id"),
    avatarUrl: text("avatar_url"),
    proxyId: text("proxy_id").references(() => proxies.id, { onDelete: "set null" }),
    browserProfileId: text("browser_profile_id").references(() => browserProfiles.id, { onDelete: "set null" }),
    twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).notNull().default(false),
    sessionStatus: text("session_status", { enum: ["valid", "expiring", "expired", "checkpoint", "unknown"] }).notNull().default("unknown"),
    sessionExpiresAt: ts("session_expires_at"),
    health: text("health", { enum: ["ok", "warn", "error", "idle"] }).notNull().default("idle"),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    index("accounts_workspace_idx").on(t.workspaceId),
    uniqueIndex("accounts_platform_external_uq").on(t.platform, t.externalId)
  ]
);

export const channels = sqliteTable(
  "channels",
  {
    id: id(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    kind: text("kind", { enum: ["fb_page", "tiktok_account", "ig_account", "yt_channel"] }).notNull(),
    name: text("name").notNull(),
    handle: text("handle"),
    externalId: text("external_id"),
    avatarUrl: text("avatar_url"),
    /** Quyền của account trên kênh (Fanpage: admin/editor…) */
    role: text("role"),
    followers: integer("followers").notNull().default(0),
    nicheTag: text("niche_tag"),
    tokenStatus: text("token_status", { enum: ["valid", "expiring", "expired", "missing"] }).notNull().default("missing"),
    tokenExpiresAt: ts("token_expires_at"),
    status: text("status", { enum: ["active", "paused", "error"] }).notNull().default("active"),
    /** Ngoài hạn mức kênh của gói: tạm dừng (status = paused), không đăng bài; bật lại khi còn chỗ / nâng gói */
    quotaBlocked: integer("quota_blocked", { mode: "boolean" }).notNull().default(false),
    health: text("health", { enum: ["ok", "warn", "error", "idle"] }).notNull().default("idle"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    index("channels_workspace_idx").on(t.workspaceId),
    index("channels_account_idx").on(t.accountId),
    uniqueIndex("channels_platform_external_uq").on(t.platform, t.externalId)
  ]
);

export const channelMetricsDaily = sqliteTable(
  "channel_metrics_daily",
  {
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD */
    day: text("day").notNull(),
    views: integer("views").notNull().default(0),
    engagements: integer("engagements").notNull().default(0),
    followers: integer("followers").notNull().default(0),
    /** Phút xem video trong ngày (Facebook page_video_view_time) */
    watchMinutes: integer("watch_minutes").notNull().default(0)
  },
  (t) => [uniqueIndex("channel_metrics_day_uq").on(t.channelId, t.day)]
);

export const secrets = sqliteTable(
  "secrets",
  {
    id: id(),
    kind: text("kind", { enum: ["cookie", "access_token", "proxy_password", "totp_secret", "api_key"] }).notNull(),
    /** integration: cấu hình tích hợp (vd App Secret của Meta App, ownerId = 'meta') */
    ownerType: text("owner_type", { enum: ["account", "channel", "proxy", "ai_provider", "integration"] }).notNull(),
    ownerId: text("owner_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    /** Phần hiển thị đã che, vd "EAAG…QZDD" */
    preview: text("preview"),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [uniqueIndex("secrets_owner_kind_uq").on(t.ownerType, t.ownerId, t.kind)]
);

export const aiProviders = sqliteTable("ai_providers", {
  id: id(),
  /** openai | gemini | deepseek | anthropic | elevenlabs | edge_tts | fal | replicate | pexels | kling … */
  provider: text("provider").notNull(),
  category: text("category", { enum: ["text", "tts", "media", "music"] }).notNull(),
  label: text("label").notNull(),
  defaultModel: text("default_model"),
  baseUrl: text("base_url"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: ["untested", "valid", "invalid", "rate_limited"] }).notNull().default("untested"),
  lastTestedAt: ts("last_tested_at"),
  lastLatencyMs: integer("last_latency_ms"),
  /** Lỗi gần nhất (loại + mô tả ngắn, không chứa nội dung prompt/key) */
  lastError: text("last_error"),
  /** Thứ tự ưu tiên trong chuỗi fallback cùng category */
  priority: integer("priority").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: id(),
    providerId: text("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    model: text("model"),
    feature: text("feature"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    characters: integer("characters").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    ok: integer("ok", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt()
  },
  (t) => [index("ai_usage_created_idx").on(t.createdAt)]
);

export const contentItems = sqliteTable(
  "content_items",
  {
    id: id(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["video", "reel", "image", "carousel", "text"] }).notNull(),
    title: text("title").notNull(),
    caption: text("caption"),
    hashtags: json("hashtags").notNull().default([]),
    mediaPaths: json("media_paths").notNull().default([]),
    thumbnailPath: text("thumbnail_path"),
    durationSec: real("duration_sec"),
    aspect: text("aspect", { enum: ["9:16", "1:1", "4:5", "16:9"] }),
    status: text("status", { enum: ["draft", "ready", "scheduled", "published", "failed"] }).notNull().default("draft"),
    source: text("source", { enum: ["studio", "manual", "import", "film"] }).notNull().default("manual"),
    spinVariants: integer("spin_variants").notNull().default(0),
    /** Bình luận đầu tiên tự đăng ngay sau khi bài lên (link, hashtag…) – Facebook & Instagram */
    firstComment: text("first_comment"),
    aiReviewed: integer("ai_reviewed", { mode: "boolean" }).notNull().default(false),
    /** Điểm Hook lần chấm gần nhất (shared/hook.ts) */
    hookScore: json("hook_score"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("content_workspace_idx").on(t.workspaceId), index("content_status_idx").on(t.status)]
);

export const contentVariants = sqliteTable(
  "content_variants",
  {
    id: id(),
    contentItemId: text("content_item_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
    caption: text("caption").notNull(),
    hashtags: json("hashtags").notNull().default([]),
    model: text("model"),
    createdAt: createdAt()
  },
  (t) => [index("variants_content_idx").on(t.contentItemId)]
);

export const videoProjects = sqliteTable("video_projects", {
  id: id(),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  contentItemId: text("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
  targetChannelId: text("target_channel_id").references(() => channels.id, { onDelete: "set null" }),
  topic: text("topic").notNull(),
  targetDurationSec: integer("target_duration_sec").notNull().default(30),
  ttsProvider: text("tts_provider").notNull().default("edge_tts"),
  voiceId: text("voice_id"),
  renderMode: text("render_mode", { enum: ["stock", "semi_ai", "full_ai"] }).notNull().default("stock"),
  subtitleStyle: text("subtitle_style").notNull().default("montserrat-kara-pop"),
  bgmTrack: text("bgm_track"),
  bgmVolume: real("bgm_volume").notNull().default(0.15),
  /** Âm thanh của clip video (Veo / clip của người dùng): tts = chỉ giọng đọc; mix = giọng đọc + tiếng clip làm nền; clip = dùng tiếng clip (Veo tự lồng tiếng) */
  clipAudio: text("clip_audio", { enum: ["tts", "mix", "clip"] }).notNull().default("tts"),
  /** Âm lượng tiếng clip khi trộn dưới giọng đọc (0–1) */
  clipAudioVolume: real("clip_audio_volume").notNull().default(0.35),
  /** false = video KHÔNG lời thoại (teaser, video công nghệ, cảnh hình): không giọng đọc, không phụ đề, giữ tiếng clip + nhạc nền */
  narration: integer("narration", { mode: "boolean" }).notNull().default(true),
  /** Mẫu định dạng nội dung (top list, tin nhanh, đố vui, tập phim…) – định hướng AI viết kịch bản */
  format: text("format"),
  /** Khung hình xuất (shared/video.ts) – video dài mặc định 16:9 */
  aspect: text("aspect", { enum: ["9:16", "16:9", "1:1"] }).notNull().default("9:16"),
  /** Chuyển cảnh giữa các phân cảnh. Dự án mới: mờ qua đen ($defaultFn – giữ DEFAULT SQL cũ để khỏi tạo lại bảng) */
  transition: text("transition", { enum: ["cut", "fade_black"] }).notNull().default("cut").$defaultFn(() => "fade_black"),
  /** Video dài: dàn ý theo hồi (AI viết dàn ý trước, rồi viết từng hồi) – cảnh thuộc hồi qua video_scenes.act */
  acts: json("acts"),
  /** Ảnh tham chiếu chung của dự án (sản phẩm, logo, nhân vật…) – đường dẫn trong media/uploads */
  referenceImages: json("reference_images").notNull().default([]),
  /** Bộ nhận diện hình ảnh: phong cách chung + mô tả cố định nhân vật / sản phẩm (shared/shot.ts) – giữ nhất quán giữa các cảnh */
  visualBible: json("visual_bible"),
  status: text("status", { enum: ["draft", "scripted", "rendering", "rendered", "failed"] }).notNull().default("draft"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const videoScenes = sqliteTable(
  "video_scenes",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => videoProjects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label"),
    voiceover: text("voiceover").notNull().default(""),
    durationSec: real("duration_sec").notNull().default(4),
    mediaPrompt: text("media_prompt"),
    mediaSource: text("media_source", { enum: ["stock", "pixabay", "fal", "nano_banana", "veo", "kling", "upload"] }),
    mediaPath: text("media_path"),
    /** Ghi công nguồn media (vd "Video: Tên tác giả / Pexels") */
    mediaCredit: text("media_credit"),
    /** Phim ngắn theo tập: nhân vật nói câu thoại (null = người dẫn truyện) */
    speakerId: text("speaker_id"),
    /** Giọng đọc riêng của cảnh (theo nhân vật) – null = giọng của dự án */
    voiceId: text("voice_id"),
    /** Thuộc hồi số mấy (0-based) trong dàn ý của dự án; clip ngắn luôn 0 */
    act: integer("act").notNull().default(0),
    /** Nguồn hình người dùng chọn cho cảnh: auto = theo chế độ render của dự án; upload = clip/ảnh của người dùng (media_path) */
    mediaMode: text("media_mode", { enum: ["auto", "stock", "image", "veo", "upload", "none"] }).notNull().default("auto"),
    /** Veo: ảnh khung đầu (image-to-video) và khung cuối (nội suy) – media/uploads */
    startImage: text("start_image"),
    endImage: text("end_image"),
    /** Ảnh tham chiếu riêng của cảnh (tối đa 3); null = tự động (nhân vật trong cảnh + ảnh tham chiếu dự án) */
    sceneRefs: json("scene_refs"),
    /** Từ khóa ngắn tìm video stock (prompt video đầy đủ nằm ở media_prompt) */
    searchQuery: text("search_query")
  },
  (t) => [index("scenes_project_idx").on(t.projectId, t.position)]
);

export const renderJobs = sqliteTable(
  "render_jobs",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => videoProjects.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["queued", "running", "done", "failed", "cancelled"] }).notNull().default("queued"),
    encoder: text("encoder"),
    progress: real("progress").notNull().default(0),
    /** Bước đang chạy (hiển thị cho người dùng) */
    stage: text("stage"),
    /** Cảnh báo không làm hỏng job (vd thiếu key Pexels → dùng nền màu) */
    notes: json("notes").notNull().default([]),
    outputPath: text("output_path"),
    error: text("error"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt()
  },
  (t) => [index("render_jobs_status_idx").on(t.status)]
);

export const scheduledPosts = sqliteTable(
  "scheduled_posts",
  {
    id: id(),
    contentItemId: text("content_item_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    scheduledAt: ts("scheduled_at").notNull(),
    status: text("status", { enum: ["queued", "publishing", "published", "failed", "cancelled"] }).notNull().default("queued"),
    isGoldenHour: integer("is_golden_hour", { mode: "boolean" }).notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    publishedAt: ts("published_at"),
    externalPostId: text("external_post_id"),
    /** Link xem bài trên nền tảng (khi API trả về) */
    permalink: text("permalink"),
    /** Thời điểm worker được thử lại sau lỗi tạm thời (null = theo scheduledAt) */
    nextAttemptAt: ts("next_attempt_at"),
    /** Ghi chú không phải lỗi, vd "TikTok: ứng dụng chưa duyệt → đăng ở chế độ riêng tư" */
    note: text("note"),
    /** Số liệu của bài sau khi đăng (đồng bộ Insights) */
    reach: integer("reach"),
    views: integer("views"),
    engagements: integer("engagements"),
    /** Thời gian xem trung bình (giây) – video/Reels */
    avgWatchSec: real("avg_watch_sec"),
    metricsAt: ts("metrics_at"),
    /** Kiểm tra sớm ~2 giờ sau đăng: số liệu lúc đó, mức thường lệ của kênh, kết quả (low/zero = phân phối kém) */
    earlyMetric: integer("early_metric"),
    earlyBaseline: integer("early_baseline"),
    earlyFlag: text("early_flag", { enum: ["ok", "low", "zero", "unknown"] }),
    earlyCheckedAt: ts("early_checked_at"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("posts_scheduled_idx").on(t.scheduledAt), index("posts_channel_idx").on(t.channelId)]
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: id(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    source: text("source", { enum: ["messenger", "comment", "direct"] }).notNull(),
    externalId: text("external_id"),
    customerName: text("customer_name").notNull(),
    customerExternalId: text("customer_external_id"),
    customerAvatarUrl: text("customer_avatar_url"),
    /** Bài viết gốc khi hội thoại bắt đầu từ bình luận */
    contextPostId: text("context_post_id"),
    contextPostTitle: text("context_post_title"),
    tags: json("tags").notNull().default([]),
    status: text("status", { enum: ["open", "pending", "resolved"] }).notNull().default("open"),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: ts("last_message_at"),
    lastMessagePreview: text("last_message_preview"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("conversations_last_idx").on(t.lastMessageAt), index("conversations_channel_idx").on(t.channelId)]
);

export const messages = sqliteTable(
  "messages",
  {
    id: id(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    author: text("author", { enum: ["customer", "agent", "bot", "system"] }).notNull(),
    body: text("body").notNull(),
    attachments: json("attachments").notNull().default([]),
    externalId: text("external_id"),
    /** draft = AI soạn sẵn, chờ người duyệt (outbox không gửi) */
    deliveryStatus: text("delivery_status", { enum: ["pending", "sent", "failed", "draft"] }),
    /** Tin đi ra: `message` = gửi nội dung; `hide` = ẩn bình luận `targetId` (luật chống cướp khách); `like` = Page thích bình luận */
    action: text("action", { enum: ["message", "hide", "like"] }).notNull().default("message"),
    /** Bình luận đích khi trả lời / ẩn / nhắn riêng từ bình luận */
    targetId: text("target_id"),
    /** Luật tự động đã tạo tin này */
    ruleId: text("rule_id"),
    /** Outbox chỉ gửi khi tới thời điểm này (độ trễ tự nhiên của luật, thử lại sau lỗi) */
    sendAfter: ts("send_after"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** AI: lý do cần duyệt / ý định khách / độ tin cậy */
    aiNote: text("ai_note"),
    createdAt: createdAt()
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt), index("messages_external_idx").on(t.externalId), index("messages_outbox_idx").on(t.deliveryStatus, t.sendAfter)]
);

export const quickReplies = sqliteTable("quick_replies", {
  id: id(),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  /** "/size" */
  shortcut: text("shortcut").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt()
});

export const autoReplyRules = sqliteTable("auto_reply_rules", {
  id: id(),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  channelId: text("channel_id").references(() => channels.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keywords: json("keywords").notNull().default([]),
  /** reply_comment | send_dm | hide_comment (vd: bình luận chứa SĐT) */
  action: text("action", { enum: ["reply_comment", "send_dm", "hide_comment"] }).notNull(),
  template: text("template"),
  minDelaySec: integer("min_delay_sec").notNull().default(15),
  maxDelaySec: integer("max_delay_sec").notNull().default(35),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const alerts = sqliteTable(
  "alerts",
  {
    id: id(),
    severity: text("severity", { enum: ["info", "warn", "error"] }).notNull(),
    kind: text("kind", {
      enum: ["cookie_expired", "token_invalid", "proxy_latency", "proxy_dead", "checkpoint", "render_failed", "publish_failed", "budget", "low_reach"]
    }).notNull(),
    entityType: text("entity_type", { enum: ["account", "channel", "proxy", "render_job", "post", "ai_provider"] }),
    entityId: text("entity_id"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt()
  },
  (t) => [index("alerts_open_idx").on(t.resolvedAt, t.createdAt)]
);

export const activityLog = sqliteTable(
  "activity_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    level: text("level", { enum: ["ok", "info", "warn", "error"] }).notNull(),
    scope: text("scope").notNull(),
    message: text("message").notNull(),
    createdAt: createdAt()
  },
  (t) => [index("activity_created_idx").on(t.createdAt)]
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: json("value").notNull(),
  updatedAt: updatedAt()
});

export const series = sqliteTable("series", {
  id: id(),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  /** Một câu tóm tắt ý tưởng series */
  logline: text("logline"),
  genre: text("genre"),
  /** Phong cách hình ảnh cố định cho mọi cảnh, vd "anime 2D, tông ấm, ánh sáng điện ảnh" */
  visualStyle: text("visual_style"),
  /** Phong cách hình ảnh dạng từ khóa tiếng Anh (AI chuyển từ visual_style) – ghép vào prompt hình từng cảnh */
  visualStyleEn: text("visual_style_en"),
  /** visual_style lúc dịch – khác thì dịch lại */
  visualStyleFor: text("visual_style_for"),
  episodeLengthSec: integer("episode_length_sec").notNull().default(60),
  ttsProvider: text("tts_provider").notNull().default("edge_tts"),
  /** Giọng người dẫn truyện */
  narratorVoiceId: text("narrator_voice_id"),
  renderMode: text("render_mode", { enum: ["stock", "semi_ai", "full_ai"] }).notNull().default("semi_ai"),
  targetChannelId: text("target_channel_id").references(() => channels.id, { onDelete: "set null" }),
  /** Kiểu sản xuất: video = Xưởng Video AI (giọng đọc + ảnh/stock); film = Xưởng Phim (phim chuyên nghiệp) */
  productionMode: text("production_mode", { enum: ["video", "film"] }).notNull().default("video"),
  /** Series kiểu Phim: ngôn ngữ thoại + ghi chú thêm (tiếng Việt được) */
  dialogueLanguage: text("dialogue_language").notNull().default("Tiếng Việt"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const seriesCharacters = sqliteTable(
  "series_characters",
  {
    id: id(),
    seriesId: text("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Vai trò trong truyện: nhân vật chính, phản diện… */
    role: text("role"),
    /** Ngoại hình cố định – người dùng viết tiếng Việt; AI chuyển thành prompt tiếng Anh (image_prompt, appearance_en) */
    appearance: text("appearance").notNull().default(""),
    personality: text("personality"),
    /** Prompt tạo ảnh nhân vật chuẩn (tiếng Anh, AI viết từ mô tả) – dùng cho "Ảnh AI" và "Chép prompt" */
    imagePrompt: text("image_prompt"),
    /** Mô tả ngoại hình ngắn gọn tiếng Anh – ghép vào prompt hình của từng cảnh trong tập phim */
    appearanceEn: text("appearance_en"),
    /** Dấu của mô tả lúc tạo prompt – mô tả đổi thì prompt được tạo lại */
    imagePromptFor: text("image_prompt_for"),
    /** Người dùng bật "Sửa prompt tiếng Anh (nâng cao)" → dùng nguyên image_prompt, AI không viết lại từ mô tả tiếng Việt */
    promptManual: integer("prompt_manual", { mode: "boolean" }).notNull().default(false),
    voiceId: text("voice_id"),
    /** Series kiểu Phim: nguồn giọng của nhân vật (elevenlabs / edge_tts / openai_tts / local_tts) – voiceId thuộc nguồn này */
    voiceProvider: text("voice_provider"),
    /** Hồ sơ giọng (tiếng Anh, chèn vào prompt video): giới tính, tuổi, chất giọng, vùng miền – giống nhau mọi tập */
    voiceProfile: text("voice_profile"),
    /** Ảnh tham chiếu nhân vật (tương đối thư mục media) – series kiểu Phim: bảng nhân vật chuẩn */
    referenceImage: text("reference_image"),
    /** Tuyến phát triển nhân vật qua các tập (AI gợi ý, sửa được) – ngoại hình cố định, tâm lý / vị trí thay đổi */
    arc: text("arc"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt()
  },
  (t) => [index("series_characters_series_idx").on(t.seriesId)]
);

export const seriesEpisodes = sqliteTable(
  "series_episodes",
  {
    id: id(),
    seriesId: text("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    synopsis: text("synopsis").notNull().default(""),
    /** Kết treo dẫn sang tập sau */
    cliffhanger: text("cliffhanger"),
    projectId: text("project_id").references(() => videoProjects.id, { onDelete: "set null" }),
    /** Series kiểu Phim: phim của tập trong Xưởng Phim (film_projects – không khai báo khóa ngoại vì bảng khai báo sau) */
    filmId: text("film_id"),
    status: text("status", { enum: ["planned", "scripted", "rendered", "published"] }).notNull().default("planned"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [uniqueIndex("series_episodes_number_uq").on(t.seriesId, t.number)]
);

export const contentIdeas = sqliteTable(
  "content_ideas",
  {
    id: id(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD – ngày dự kiến đăng */
    plannedDate: text("planned_date"),
    title: text("title").notNull(),
    /** Mẫu định dạng (xem shared/formats.ts) */
    format: text("format").notNull().default("free"),
    /** Câu mở đầu giữ chân người xem trong 3 giây đầu */
    hook: text("hook"),
    description: text("description"),
    status: text("status", { enum: ["idea", "in_progress", "done", "dropped"] }).notNull().default("idea"),
    projectId: text("project_id").references(() => videoProjects.id, { onDelete: "set null" }),
    contentItemId: text("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
    source: text("source", { enum: ["ai", "manual"] }).notNull().default("manual"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("content_ideas_date_idx").on(t.workspaceId, t.plannedDate)]
);

export const channelGoals = sqliteTable(
  "channel_goals",
  {
    id: id(),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    metric: text("metric", { enum: ["followers", "watch_minutes_60d", "views_30d", "videos_30d", "engagements_30d"] }).notNull(),
    target: integer("target").notNull(),
    label: text("label"),
    createdAt: createdAt()
  },
  (t) => [index("channel_goals_channel_idx").on(t.channelId)]
);

export const filmProjects = sqliteTable("film_projects", {
  id: id(),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  idea: text("idea").notNull().default(""),
  logline: text("logline"),
  /** Từ khóa phong cách tiếng Anh ĐÃ TỐI ƯU (ghép vào mọi prompt) – hệ thống tạo từ thể loại / phong cách / ghi chú */
  style: text("style").notNull().default(""),
  /** Lựa chọn của người dùng (shared/film-style.ts – lựa chọn sẵn hoặc tự nhập, tiếng Việt được) */
  genre: text("genre"),
  visualStyle: text("visual_style"),
  dialogueLanguage: text("dialogue_language").notNull().default("Tiếng Việt"),
  notes: text("notes"),
  /** Dấu của lựa chọn lúc tạo `style` – đổi lựa chọn thì tối ưu lại; "manual:…" = người dùng tự sửa `style` */
  styleFor: text("style_for"),
  /** Giọng nhân vật khi ghép: clip = giữ giọng model tạo · convert = đổi sang giọng nhân vật (ElevenLabs, giữ khẩu hình) · dub = lồng tiếng bằng giọng đọc */
  voiceMode: text("voice_mode", { enum: ["clip", "convert", "dub"] }).notNull().default("clip"),
  /** Thoại không phải tiếng Việt: ghép tập kèm phụ đề tiếng Việt (bản dịch lời thoại từng cảnh) */
  subtitleVi: integer("subtitle_vi", { mode: "boolean" }).notNull().default(false),
  aspect: text("aspect", { enum: ["9:16", "16:9", "1:1"] }).notNull().default("16:9"),
  targetSec: integer("target_sec").notNull().default(120),
  videoEngine: text("video_engine", { enum: ["seedance", "veo"] }).notNull().default("seedance"),
  imageEngine: text("image_engine", { enum: ["google", "fal"] }).notNull().default("google"),
  takesPerRun: integer("takes_per_run").notNull().default(2),
  /** Phim của một tập series (series kiểu Phim) */
  seriesId: text("series_id").references(() => series.id, { onDelete: "set null" }),
  episodeId: text("episode_id").references(() => seriesEpisodes.id, { onDelete: "set null" }),
  /** Id nhân vật series phim đã biết (đã nhập vào phim) – nhân vật series MỚI ngoài danh sách này được thêm khi mở phim */
  castKnown: json("cast_known"),
  /** Video: độ phân giải, có tạo âm thanh (tiếng động + lời thoại khớp môi), bản Seedance (fast rẻ hơn) */
  videoResolution: text("video_resolution", { enum: ["480p", "720p", "1080p"] }).notNull().default("720p"),
  videoAudio: integer("video_audio", { mode: "boolean" }).notNull().default(true),
  videoTier: text("video_tier", { enum: ["fast", "standard"] }).notNull().default("fast"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const filmAssets = sqliteTable(
  "film_assets",
  {
    id: id(),
    filmId: text("film_id").notNull().references(() => filmProjects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["character", "location", "shot"] }).notNull(),
    position: integer("position").notNull().default(0),
    name: text("name").notNull(),
    summary: text("summary").notNull().default(""),
    description: text("description").notNull().default(""),
    /** Tóm tắt tiếng Việt mà `description` (prompt tiếng Anh) được viết theo – tóm tắt đổi thì AI cập nhật prompt trước khi tạo ảnh / video */
    descriptionSrc: text("description_src"),
    /** Người dùng bật "Sửa prompt tiếng Anh (nâng cao)" → dùng nguyên `description`, không dịch lại từ tiếng Việt */
    promptManual: integer("prompt_manual", { mode: "boolean" }).notNull().default(false),
    characterIds: json("character_ids").notNull().default([]),
    locationId: text("location_id"),
    camera: text("camera").notNull().default(""),
    durationSec: integer("duration_sec").notNull().default(6),
    dialogue: text("dialogue"),
    /** Cảnh quay: phụ đề tiếng Việt (bản dịch lời thoại – sửa tay được) */
    subtitle: text("subtitle"),
    /** Lời thoại mà `subtitle` được dịch / viết theo – khác lời thoại hiện tại thì dịch lại khi ghép */
    subtitleSrc: text("subtitle_src"),
    selectedTakeId: text("selected_take_id"),
    /** Cảnh quay: bản video đã chọn (khung hình đã chọn nằm ở selectedTakeId) */
    selectedVideoTakeId: text("selected_video_take_id"),
    /** Nhân vật lấy từ dàn nhân vật series (bản gốc) */
    seriesCharacterId: text("series_character_id").references(() => seriesCharacters.id, { onDelete: "set null" }),
    /** Nhân vật: hồ sơ giọng (tiếng Anh – chèn vào prompt video) + giọng cố định (đổi giọng / lồng tiếng khi ghép) */
    voiceProfile: text("voice_profile"),
    voiceProvider: text("voice_provider"),
    voiceId: text("voice_id"),
    /** Nhân vật AI đề xuất khi viết kịch bản, chờ người dùng duyệt */
    proposal: text("proposal", { enum: ["pending"] }),
    /** Phạm vi AI đề xuất: chỉ tập này / thêm vào dàn nhân vật series */
    proposedScope: text("proposed_scope", { enum: ["episode", "series"] }),
    proposalReason: text("proposal_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("film_assets_film_idx").on(t.filmId, t.kind, t.position)]
);

export const filmTakes = sqliteTable(
  "film_takes",
  {
    id: id(),
    filmId: text("film_id").notNull().references(() => filmProjects.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull().references(() => filmAssets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["image", "video"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "done", "failed", "cancelled"] }).notNull().default("queued"),
    file: text("file"),
    /** Prompt + ảnh tham chiếu lúc xếp hàng (chụp lại – sửa mô tả sau đó không đổi bản đang chờ) */
    prompt: text("prompt").notNull(),
    refs: json("refs").notNull().default([]),
    model: text("model"),
    /** Video: thời lượng clip yêu cầu (giây) */
    durationSec: integer("duration_sec"),
    costUsd: real("cost_usd").notNull().default(0),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    /** Thử lại sau lỗi tạm thời (quá tải / giới hạn) không sớm hơn mốc này */
    notBefore: ts("not_before"),
    /** Bản nâng cấp độ phân giải của bản `sourceTakeId` (shared/upscale.ts) – hàng đợi chạy nâng cấp thay vì tạo mới */
    upscale: text("upscale"),
    sourceTakeId: text("source_take_id"),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at")
  },
  (t) => [index("film_takes_queue_idx").on(t.status, t.kind, t.createdAt), index("film_takes_asset_idx").on(t.assetId)]
);
