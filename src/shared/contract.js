import { z } from "zod";

const platform = z.enum(["facebook", "tiktok", "instagram", "youtube"]);
const id = z.string().min(1);
const optionalWorkspace = z.object({ workspaceId: id.nullish() }).default({});
const none = z.void().or(z.undefined());
const byId = z.object({ id });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const WorkspaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(40).nullish(),
  description: z.string().max(500).nullish(),
  brandVoice: z.string().max(2e3).nullish(),
  /** Kiến thức trả lời khách cho AI: giá, size, ship, đổi trả… */
  knowledge: z.string().max(8e3).nullish(),
  watermarkPath: z.string().max(1024).nullish(),
  watermarkPosition: z.enum(["tl", "tr", "bl", "br", "center"]).optional(),
  watermarkOpacity: z.number().min(0.05).max(1).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  aiBudgetUsd: z.number().min(0).max(1e5).nullish(),
  goldenHours: z.array(z.object({ start: hhmm, end: hhmm, weight: z.number().min(0).max(1) })).optional(),
  aiTokenQuota: z.number().int().positive().nullish()
});

const ProxyInput = z.object({
  workspaceId: id.nullish(),
  label: z.string().trim().min(1).max(80),
  protocol: z.enum(["socks5", "http", "https"]).default("socks5"),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255).nullish(),
  country: z.string().max(8).nullish(),
  kind: z.enum(["residential", "datacenter", "mobile", "isp"]).nullish()
});

const AccountInput = z.object({
  workspaceId: id.nullish(),
  platform,
  displayName: z.string().trim().min(1).max(120),
  handle: z.string().trim().max(100).nullish(),
  externalId: z.string().trim().max(100).nullish(),
  proxyId: id.nullish(),
  twoFactorEnabled: z.boolean().optional(),
  note: z.string().max(500).nullish()
});

const PageInput = z.object({
  accountId: id,
  name: z.string().trim().min(1).max(160),
  externalId: z.string().trim().max(100).nullish(),
  role: z.enum(["admin", "editor", "moderator", "advertiser"]).nullish(),
  nicheTag: z.string().max(60).nullish()
});

const ProjectInput = z.object({
  workspaceId: id.nullish(),
  targetChannelId: id.nullish(),
  topic: z.string().trim().min(1).max(1e3),
  /** 10 giây – 15 phút (phim dài render theo từng cảnh rồi ghép) */
  targetDurationSec: z.number().int().min(10).max(900).optional(),
  aspect: z.enum(["9:16", "16:9", "1:1"]).optional(),
  transition: z.enum(["cut", "fade_black"]).optional(),
  ttsProvider: z.string().max(40).optional(),
  voiceId: z.string().max(120).nullish(),
  renderMode: z.enum(["stock", "semi_ai", "full_ai"]).optional(),
  subtitleStyle: z.string().max(60).optional(),
  bgmTrack: z.string().max(200).nullish(),
  bgmVolume: z.number().min(0).max(1).optional(),
  clipAudio: z.enum(["tts", "mix", "clip"]).optional(),
  clipAudioVolume: z.number().min(0).max(1).optional(),
  /** false = không lời thoại (chỉ hình + tiếng clip + nhạc nền) */
  narration: z.boolean().optional(),
  /** Mẫu định dạng (shared/formats.ts) */
  format: z.string().max(80).nullish(),
  /** Ảnh tham chiếu chung (sản phẩm, logo, nhân vật) – đường dẫn media/uploads do media.importClips trả về */
  referenceImages: z.array(z.string().max(300)).max(6).optional(),
  /** Video dài: dàn ý theo hồi (sửa tên / tóm tắt / thời lượng hồi) */
  acts: z.array(z.object({ title: z.string().trim().min(1).max(120), summary: z.string().max(800), targetSec: z.number().int().min(10).max(900) })).max(10).nullish()
});

const SceneInput = z.object({
  label: z.string().max(80).nullish(),
  voiceover: z.string().max(2e3),
  durationSec: z.number().min(0.5).max(120),
  /** Prompt video đầy đủ (tiếng Anh) */
  mediaPrompt: z.string().max(2e3).nullish(),
  /** Từ khóa ngắn tìm video stock */
  searchQuery: z.string().max(120).nullish(),
  mediaSource: z.enum(["stock", "fal", "kling", "upload"]).nullish(),
  /** Phim ngắn: nhân vật nói + giọng riêng (giữ nguyên khi sửa phân cảnh) */
  speakerId: z.string().max(60).nullish(),
  voiceId: z.string().max(120).nullish(),
  /** Hồi (0-based) – video dài */
  act: z.number().int().min(0).max(9).optional(),
  /** Nguồn hình của cảnh (auto = theo chế độ render của dự án) */
  mediaMode: z.enum(["auto", "stock", "image", "veo", "upload", "none"]).optional(),
  /** Clip/ảnh của người dùng (chỉ dùng khi mediaMode = upload): đường dẫn trong thư mục media, do media.importClips trả về */
  mediaPath: z.string().max(300).nullish(),
  /** Veo: ảnh khung đầu / khung cuối (media/uploads) */
  startImage: z.string().max(300).nullish(),
  endImage: z.string().max(300).nullish(),
  /** Ảnh tham chiếu riêng của cảnh (≤ 3); null = tự động */
  sceneRefs: z.array(z.string().max(300)).max(3).nullish()
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD");

const SeriesInput = z.object({
  workspaceId: id.nullish(),
  title: z.string().trim().min(1).max(120),
  logline: z.string().trim().max(600).nullish(),
  genre: z.string().trim().max(80).nullish(),
  visualStyle: z.string().trim().max(400).nullish(),
  /** 30/60/90 giây (phim ngắn) hoặc 3–15 phút (viết theo hồi) */
  episodeLengthSec: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180), z.literal(300), z.literal(600), z.literal(900)]).optional(),
  ttsProvider: z.string().max(40).optional(),
  narratorVoiceId: z.string().max(120).nullish(),
  renderMode: z.enum(["stock", "semi_ai", "full_ai"]).optional(),
  targetChannelId: id.nullish(),
  /** video = Xưởng Video AI; film = Xưởng Phim (khóa khi đã có tập được sản xuất) */
  productionMode: z.enum(["video", "film"]).optional(),
  /** Series kiểu Phim: ngôn ngữ thoại, ghi chú thêm (tiếng Việt được) */
  dialogueLanguage: z.string().trim().min(1).max(60).optional(),
  notes: z.string().max(2e3).nullish()
});

const ContentInput = z.object({
  workspaceId: id.nullish(),
  kind: z.enum(["video", "reel", "image", "carousel", "text"]),
  title: z.string().trim().min(1).max(300),
  caption: z.string().max(5e3).nullish(),
  hashtags: z.array(z.string().max(100)).max(60).optional(),
  aspect: z.enum(["9:16", "1:1", "4:5", "16:9"]).nullish(),
  status: z.enum(["draft", "ready"]).optional(),
  /** Bình luận đầu tiên tự đăng sau khi bài lên (Facebook, Instagram) */
  firstComment: z.string().max(2e3).nullish(),
  /** File ảnh/video đính kèm: đường dẫn tuyệt đối (chọn qua system.pickMedia) hoặc tương đối thư mục media */
  mediaPaths: z.array(z.string().min(1).max(1e3)).max(10).optional()
});

const def = () => (input) => ({ input, output: void 0 });
const contentStatus = z.enum(["draft", "ready", "scheduled", "published", "failed"]);
const email = z.string().trim().toLowerCase().email("Email không hợp lệ").max(160);
const password = z.string().min(8, "Mật khẩu tối thiểu 8 ký tự").max(200);

export const PUBLIC_ENDPOINTS = new Set([
  "auth.state",
  "auth.login",
  "auth.register",
  "auth.registerVerify",
  "auth.registerResend",
  "auth.forgotPassword",
  "auth.resetPassword",
  "auth.checkReferral",
  "cloud.appInfo",
  "system.logInfo",
  "system.openLogs",
  "storage.location",
  "storage.useExisting",
  "storage.openRoot"
]);

export const UNLICENSED_ENDPOINTS = new Set([
  "auth.logout",
  "auth.changePassword",
  "auth.updateProfile",
  "license.state",
  "license.refresh",
  "license.activate",
  "license.devices",
  "license.removeDevice",
  "billing.plans",
  "billing.createOrder",
  "billing.order",
  "billing.orders",
  "cloud.notifications",
  "cloud.notificationsSeen",
  "system.openExternal"
]);

export const contract = {
  // Đăng nhập bằng tài khoản NT (cloud); dữ liệu vẫn lưu trên máy theo từng tài khoản
  "auth.state": def()(none),
  // Thư mục dữ liệu (chọn nơi lưu, chuyển máy)
  "storage.location": def()(none),
  "storage.openRoot": def()(none),
  "storage.move": def()(none),
  "storage.useExisting": def()(none),
  /** Đăng ký bước 1: gửi mã xác thực 6 số tới email (chưa tạo tài khoản) */
  "auth.register": def()(
    z.object({
      email,
      displayName: z.string().trim().min(1, "Nhập tên hiển thị").max(80),
      password,
      phone: z.string().trim().max(30).optional(),
      /** Mã giới thiệu của AM / Sale (tùy chọn) */
      referralCode: z.string().trim().max(20).optional(),
      remember: z.boolean().default(true),
      /** Chuyển dữ liệu của bản trước khi có đăng nhập vào tài khoản này (người dùng chọn) */
      adoptLegacy: z.boolean().default(false)
    })
  ),
  /** Đăng ký bước 2: nhập đúng mã → tạo tài khoản và đăng nhập luôn */
  "auth.registerVerify": def()(z.object({ email, code: z.string().trim().regex(/^\d{6}$/, "Mã xác thực gồm 6 chữ số") })),
  "auth.registerResend": def()(z.object({ email })),
  /** Quên mật khẩu bước 1: gửi mã 6 số tới email (trả lời như nhau dù email có tài khoản hay không) */
  "auth.forgotPassword": def()(z.object({ email })),
  /** Quên mật khẩu bước 2: đúng mã → đặt mật khẩu mới và đăng nhập luôn */
  "auth.resetPassword": def()(
    z.object({ email, code: z.string().trim().regex(/^\d{6}$/, "Mã xác thực gồm 6 chữ số"), newPassword: password, remember: z.boolean().default(true) })
  ),
  "auth.login": def()(z.object({ email, password: z.string().min(1).max(200), remember: z.boolean().default(true) })),
  "auth.logout": def()(none),
  "auth.changePassword": def()(z.object({ currentPassword: z.string().min(1).max(200), newPassword: password })),
  "auth.updateProfile": def()(z.object({ displayName: z.string().trim().min(1).max(80) })),
  /** Kiểm tra mã giới thiệu trước khi đăng ký → tên AM */
  "auth.checkReferral": def()(z.object({ code: z.string().trim().min(1).max(20) })),
  // License & mua gói (NT Cloud)
  "license.state": def()(none),
  /** Kiểm tra lại với cloud ngay (heartbeat) */
  "license.refresh": def()(none),
  /** Kích hoạt lại máy này (sau khi gỡ bớt máy khác / bị gỡ) */
  "license.activate": def()(none),
  "license.devices": def()(none),
  "license.removeDevice": def()(byId),
  /** Hạn mức kênh: đang dùng / tối đa, kênh ngoài hạn mức */
  "channels.quota": def()(none),
  /** Chọn kênh dùng (≤ hạn mức) – kênh còn lại chuyển "Ngoài hạn mức" */
  "channels.setQuota": def()(z.object({ activeIds: z.array(z.string().min(1).max(64)).max(1e5) })),
  "billing.plans": def()(none),
  "billing.createOrder": def()(z.object({ planCode: z.string().min(1).max(40), gateway: z.enum(["VIETQR", "PAYOS"]).optional() })),
  /** Hỏi trạng thái đơn (app hỏi định kỳ khi khách đang thanh toán; PAID → tự làm mới license) */
  "billing.order": def()(z.object({ code: z.string().min(1).max(30) })),
  "billing.orders": def()(none),
  /** Phiên bản mới / bắt buộc cập nhật, thông báo từ quản trị */
  "cloud.appInfo": def()(none),
  /** Chuông thông báo: thông báo quản trị viên gửi + thông báo tự động (thanh toán thành công) */
  "cloud.notifications": def()(none),
  /** Mở chuông → đánh dấu mọi thông báo đã đọc */
  "cloud.notificationsSeen": def()(none),
  /** Mở link ngoài (trang thanh toán PayOS, tải bản cập nhật) bằng trình duyệt mặc định */
  "system.openExternal": def()(z.object({ url: z.string().url().max(2e3) })),
  // Workspaces
  "workspaces.list": def()(none),
  "workspaces.create": def()(WorkspaceInput),
  "workspaces.update": def()(z.object({ id, patch: WorkspaceInput.partial() })),
  "workspaces.archive": def()(byId),
  /** Bật/tắt nhiễu Canvas cho mọi profile trình duyệt thuộc Pocket */
  "workspaces.setCanvasNoise": def()(z.object({ id, enabled: z.boolean() })),
  /** Xuất cấu hình (không gồm bí mật) ra file JSON qua hộp thoại lưu; null = người dùng hủy */
  "workspaces.export": def()(none),
  // Tài khoản / kênh / proxy
  "accounts.tree": def()(optionalWorkspace),
  "accounts.get": def()(byId),
  /** TikTok/Instagram: tự tạo kênh tương ứng. Facebook (VIA): thêm Fanpage bằng `channels.createPage`. */
  "accounts.create": def()(AccountInput),
  "accounts.update": def()(
    z.object({ id, patch: AccountInput.omit({ platform: true }).partial() })
  ),
  "accounts.delete": def()(byId),
  "channels.createPage": def()(PageInput),
  "channels.delete": def()(byId),
  /**
   * Kết nối API đăng bài: dán Page token / User token (FB, IG – tự tìm trang khớp) hoặc Access token TikTok.
   * Token lưu mã hóa trong két, không bao giờ trả về renderer.
   */
  "channels.connect": def()(
    z.object({
      channelId: id,
      token: z.string().trim().min(20).max(4e3),
      refreshToken: z.string().trim().max(4e3).nullish(),
      clientKey: z.string().trim().max(200).nullish(),
      clientSecret: z.string().trim().max(200).nullish()
    })
  ),
  "channels.verify": def()(byId),
  /** Ứng dụng Meta (App ID + App Secret) dùng cho "Kết nối Facebook" – khai báo một lần */
  /** viaCloud: chưa tự cấu hình ứng dụng riêng → kết nối bằng ứng dụng NT trên cloud */
  "integrations.meta": def()(none),
  /** Kết nối Facebook thì lấy luôn tài khoản Instagram liên kết với Fanpage (mặc định bật) */
  "integrations.setInstagram": def()(z.object({ enabled: z.boolean() })),
  "integrations.setMeta": def()(
    z.object({ appId: z.string().trim().regex(/^\d{5,20}$/, "App ID là dãy số"), appSecret: z.string().trim().regex(/^[0-9a-f]{32}$/i, "App Secret gồm 32 ký tự 0-9, a-f").nullish(), configId: z.string().trim().regex(/^\d{5,25}$/, "Configuration ID là dãy số").nullish().or(z.literal("")), redirectUri: z.string().trim().url("Redirect URI không hợp lệ").max(500).nullish().or(z.literal("")), instagram: z.boolean().optional() })
  ),
  /** Ứng dụng YouTube (OAuth Client loại Desktop app trong Google Cloud) – khai báo một lần */
  "integrations.youtube": def()(none),
  "integrations.setYoutube": def()(
    z.object({
      clientId: z.string().trim().regex(/^[\w-]+\.apps\.googleusercontent\.com$/, "Client ID có dạng …apps.googleusercontent.com"),
      clientSecret: z.string().trim().min(10).max(200).nullish()
    })
  ),
  "integrations.setYoutubePublish": def()(
    z.object({
      privacy: z.enum(["public", "unlisted", "private"]).optional(),
      categoryId: z.string().regex(/^\d{1,3}$/).optional(),
      declareSynthetic: z.boolean().optional(),
      notifySubscribers: z.boolean().optional()
    })
  ),
  /** "Kết nối YouTube": đăng nhập Google qua trình duyệt → tạo/cập nhật kênh YouTube */
  "accounts.connectYoutube": def()(
    z.object({ accountId: id.optional(), workspaceId: id.nullish() }).default({})
  ),
  /** Hủy phiên đăng nhập YouTube đang chờ trình duyệt */
  "accounts.cancelYoutubeLogin": def()(none),
  /** Ứng dụng TikTok (Client Key + Secret) cho "Kết nối TikTok" – khai báo một lần */
  "integrations.tiktok": def()(none),
  "integrations.setTiktok": def()(
    z.object({
      clientKey: z.string().trim().min(8, "Client Key không hợp lệ").max(100),
      clientSecret: z.string().trim().max(200).nullish(),
      redirectUri: z.string().trim().url("Redirect URI không hợp lệ").max(500).nullish().or(z.literal("")),
      scopes: z.string().trim().max(300).regex(/^[a-z._,\s]*$/, "Scope gồm chữ thường, dấu chấm, phẩy").nullish()
    })
  ),
  /** Đăng nhập TikTok (OAuth + PKCE) → tạo/cập nhật tài khoản + kênh TikTok */
  "accounts.connectTiktok": def()(
    z.object({ accountId: id.optional(), workspaceId: id.nullish() }).default({})
  ),
  /** Đăng nhập Facebook (OAuth) → tạo/cập nhật tài khoản VIA + mọi Fanpage/Instagram được cấp quyền */
  "accounts.connectFacebook": def()(
    z.object({ accountId: id.optional(), workspaceId: id.nullish() }).default({})
  ),
  "channels.disconnect": def()(byId),
  /** Nhập mọi Fanpage (+ Instagram Business liên kết) từ User token của VIA; App ID/Secret → đổi token dài hạn */
  "accounts.importFacebook": def()(
    z.object({
      accountId: id,
      userToken: z.string().trim().min(20).max(4e3),
      appId: z.string().trim().max(40).nullish(),
      appSecret: z.string().trim().max(100).nullish()
    })
  ),
  "channels.list": def()(
    z.object({ workspaceId: id.nullish(), platform: platform.optional() }).default({})
  ),
  "proxies.list": def()(optionalWorkspace),
  "proxies.create": def()(ProxyInput),
  "proxies.delete": def()(byId),
  // Kho nội dung
  "content.list": def()(
    z.object({ workspaceId: id.nullish(), status: z.array(contentStatus).optional(), search: z.string().max(200).optional() }).default({})
  ),
  "content.create": def()(ContentInput),
  "content.delete": def()(byId),
  "content.update": def()(z.object({ id, patch: ContentInput.partial() })),
  "content.bulkMove": def()(z.object({ ids: z.array(id).min(1).max(500), workspaceId: id.nullable() })),
  "content.bulkDelete": def()(z.object({ ids: z.array(id).min(1).max(500) })),
  "content.stats": def()(optionalWorkspace),
  /** AI Spin: sinh `count` biến thể caption cho mỗi nội dung (chạy tuần tự) */
  "content.spin": def()(
    z.object({ ids: z.array(id).min(1).max(50), count: z.number().int().min(1).max(10).default(3) })
  ),
  "content.variants": def()(byId),
  /** Dùng biến thể làm caption + hashtag chính của nội dung */
  "content.applyVariant": def()(byId),
  "content.deleteVariant": def()(byId),
  /** Chấm điểm Hook (40% kỹ thuật + 60% AI giám khảo). platform bỏ trống = đoán theo kênh đã lên lịch / định dạng; force = chấm lại dù bài chưa đổi */
  "content.hookScore": def()(
    z.object({ id, platform: z.enum(["facebook", "tiktok", "instagram", "youtube"]).optional(), force: z.boolean().default(false) })
  ),
  "content.hashtags": def()(z.object({ ids: z.array(id).min(1).max(50) })),
  // Xưởng Video AI
  "studio.projects": def()(optionalWorkspace),
  "studio.get": def()(byId),
  "studio.create": def()(ProjectInput),
  "studio.update": def()(z.object({ id, patch: ProjectInput.partial() })),
  "studio.delete": def()(byId),
  /** Ghi đè toàn bộ danh sách phân cảnh theo đúng thứ tự gửi lên */
  "studio.saveScenes": def()(z.object({ projectId: id, scenes: z.array(SceneInput).max(200) })),
  /** Tạo (hoặc cập nhật) mục Kho nội dung gắn với dự án */
  "studio.toContent": def()(byId),
  /** Dữ liệu soạn prompt thủ công cho Google Vids / Flow (không gọi AI) */
  "studio.promptExport": def()(byId),
  /** Sinh kịch bản + phân cảnh bằng LLM; ghi đè phân cảnh hiện có */
  "studio.generateScript": def()(byId),
  /** Lập lại bộ nhận diện hình ảnh theo ảnh tham chiếu (AI xem ảnh) → cập nhật prompt hình các cảnh; updated = số cảnh đổi prompt */
  "studio.bibleFromRefs": def()(byId),
  /** Lưu bộ nhận diện người dùng sửa (tiếng Việt) → AI dịch sang tiếng Anh cho prompt hình → cập nhật prompt các cảnh */
  "studio.updateBible": def()(
    z.object({
      id,
      bible: z.object({
        style: z.string().trim().max(800),
        characters: z.array(z.object({ name: z.string().trim().min(1).max(60), look: z.string().trim().min(1).max(800) })).max(8),
        product: z.object({ name: z.string().trim().min(1).max(80), look: z.string().trim().min(1).max(800) }).nullable()
      })
    })
  ),
  /** Video dài: viết (lại) phân cảnh của một hồi theo dàn ý */
  "studio.writeAct": def()(z.object({ projectId: id, act: z.number().int().min(0).max(9) })),
  // Phân tích & mục tiêu kênh
  "analytics.overview": def()(
    z.object({ workspaceId: id.nullish(), channelId: id.nullish(), days: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(30) })
  ),
  "analytics.goals": def()(z.object({ workspaceId: id.nullish(), channelId: id.nullish() }).default({})),
  "analytics.saveGoal": def()(
    z.object({
      id: id.optional(),
      channelId: id,
      metric: z.enum(["followers", "watch_minutes_60d", "views_30d", "videos_30d", "engagements_30d"]),
      target: z.number().int().min(1).max(1e9),
      label: z.string().trim().max(120).nullish()
    })
  ),
  "analytics.deleteGoal": def()(byId),
  // Kế hoạch nội dung (ngày dạng YYYY-MM-DD)
  "plan.list": def()(z.object({ workspaceId: id.nullish(), from: isoDate, to: isoDate })),
  /** AI lập kế hoạch N ngày theo ngách + bài hiệu quả của page (+ xu hướng tìm kiếm nếu bật) */
  "plan.generate": def()(
    z.object({
      workspaceId: id.nullish(),
      startDate: isoDate,
      days: z.number().int().min(1).max(30),
      perDay: z.number().int().min(1).max(3),
      formats: z.array(z.string().max(80)).max(20).default([]),
      useTrends: z.boolean().default(false)
    })
  ),
  "plan.save": def()(
    z.object({
      id: id.optional(),
      workspaceId: id.nullish(),
      plannedDate: isoDate.nullish(),
      title: z.string().trim().min(1).max(200),
      format: z.string().max(80).default("free"),
      hook: z.string().trim().max(300).nullish(),
      description: z.string().trim().max(1e3).nullish(),
      status: z.enum(["idea", "in_progress", "done", "dropped"]).optional()
    })
  ),
  "plan.delete": def()(byId),
  "plan.toVideo": def()(byId),
  "plan.toPost": def()(byId),
  // Series phim ngắn AI
  "series.list": def()(optionalWorkspace),
  "series.get": def()(byId),
  "series.create": def()(SeriesInput),
  "series.update": def()(z.object({ id, patch: SeriesInput.partial() })),
  "series.delete": def()(byId),
  /** Series kiểu Phim: tạo (hoặc mở) phim của tập trong Xưởng Phim → id phim */
  "series.makeFilm": def()(z.object({ episodeId: id })),
  /** AI: thêm nhân vật còn thiếu + dàn ý N tập tiếp theo (tối đa 30; > 10 tập chia đợt 10, có mạch cả mùa – có thể mất vài phút) */
  "series.develop": def()(z.object({ id, episodes: z.number().int().min(1).max(30).default(5) })),
  "series.saveCharacter": def()(
    z.object({
      id: id.optional(),
      seriesId: id,
      name: z.string().trim().min(1).max(60),
      role: z.string().trim().max(80).nullish(),
      appearance: z.string().trim().max(600),
      personality: z.string().trim().max(400).nullish(),
      /** Tuyến phát triển qua các tập */
      arc: z.string().trim().max(600).nullish(),
      voiceId: z.string().max(120).nullish(),
      /** Series kiểu Phim: nguồn giọng cố định + hồ sơ giọng (tiếng Anh) – dùng chung mọi tập */
      voiceProvider: z.string().max(40).nullish(),
      voiceProfile: z.string().max(300).nullish(),
      /** "Sửa prompt tiếng Anh (nâng cao)": true → dùng nguyên imagePrompt; false → AI viết lại từ mô tả tiếng Việt */
      promptManual: z.boolean().optional(),
      /** Chỉ dùng khi promptManual = true */
      imagePrompt: z.string().trim().max(1500).nullish()
    })
  ),
  /** Prompt ảnh nhân vật chuẩn (tiếng Anh) – AI viết từ mô tả tiếng Việt; còn khớp mô tả thì dùng lại */
  "series.characterPrompt": def()(z.object({ id, force: z.boolean().default(false) })),
  "series.deleteCharacter": def()(byId),
  /** Tạo ảnh tham chiếu nhân vật bằng ảnh AI (Nano Banana / Fal) */
  "series.characterImage": def()(byId),
  /** Ảnh nhân vật tải từ máy (đường dẫn chọn qua system.pickImage); null = gỡ ảnh */
  "series.setCharacterImage": def()(z.object({ id, sourcePath: z.string().min(1).max(1e3).nullable() })),
  "series.saveEpisode": def()(
    z.object({
      id: id.optional(),
      seriesId: id,
      title: z.string().trim().min(1).max(120),
      synopsis: z.string().trim().max(1500),
      cliffhanger: z.string().trim().max(400).nullish()
    })
  ),
  "series.deleteEpisode": def()(byId),
  /** AI viết kịch bản tập → dự án Xưởng video (thoại theo nhân vật, giọng riêng) */
  "series.writeEpisode": def()(byId),
  // Lịch đăng (from/to: epoch ms)
  "posts.range": def()(z.object({ from: z.number().int(), to: z.number().int(), workspaceId: id.nullish() })),
  "posts.schedule": def()(z.object({ contentItemId: id, channelId: id, scheduledAt: z.number().int() })),
  /** Trả giờ đăng thật (có thể bị lùi vài phút do giãn cách bài trùng giờ) */
  "posts.reschedule": def()(z.object({ id, scheduledAt: z.number().int() })),
  "posts.cancel": def()(byId),
  /** Đăng ngay / thử lại bài đang chờ hoặc bị lỗi */
  "posts.publishNow": def()(byId),
  "posts.worker": def()(none),
  /** Đồng bộ số liệu thật (Insights) của mọi kênh đã kết nối API */
  "insights.sync": def()(none),
  "insights.last": def()(none),
  /** Giờ vàng học từ số liệu bài đã đăng (90 ngày) */
  "insights.bestHours": def()(optionalWorkspace),
  "posts.setWorker": def()(z.object({ enabled: z.boolean() })),
  /** Giãn cách bài trùng giờ giữa các kênh (áp dụng khi xếp / dời lịch) */
  "posts.stagger": def()(none),
  "posts.setStagger": def()(
    z.object({ enabled: z.boolean().optional(), minMinutes: z.number().int().min(1).max(60).optional(), maxMinutes: z.number().int().min(1).max(120).optional() })
  ),
  /**
   * Tự xếp lịch: mỗi nội dung → kênh phù hợp định dạng (ít bài nhất 7 ngày tới) trong Pocket của nó,
   * vào khung giờ vàng sớm nhất còn trống, cách bài khác cùng kênh ≥ spacingHours.
   */
  "posts.autoSchedule": def()(
    z.object({ contentIds: z.array(id).min(1).max(200), spacingHours: z.number().min(1).max(24).default(4) })
  ),
  // Hộp thư hợp nhất
  "inbox.conversations": def()(
    z.object({ workspaceId: id.nullish(), platform: platform.optional(), unreadOnly: z.boolean().optional() }).default({})
  ),
  "inbox.messages": def()(z.object({ conversationId: id })),
  "inbox.markRead": def()(z.object({ conversationId: id })),
  "inbox.quickReplies": def()(optionalWorkspace),
  "inbox.stats": def()(optionalWorkspace),
  /** Xếp tin trả lời vào outbox ("Chờ gửi"); worker gửi thật qua Graph API ngay sau đó. */
  "inbox.send": def()(
    z.object({
      conversationId: id,
      body: z.string().trim().max(4e3),
      /** Tệp đính kèm đã chép vào media/inbox (inbox.pickAttachments) */
      attachments: z.array(z.string().max(300)).max(5).default([])
    }).refine((v) => v.body.length > 0 || v.attachments.length > 0, "Nhập nội dung hoặc đính kèm tệp")
  ),
  /** Chọn ảnh / tệp để gửi kèm tin nhắn → chép vào media/inbox, trả đường dẫn */
  "inbox.pickAttachments": def()(z.object({ images: z.boolean().default(false), multiple: z.boolean().default(true) })),
  "inbox.update": def()(
    z.object({
      conversationId: id,
      tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
      status: z.enum(["open", "pending", "resolved"]).optional()
    })
  ),
  "inbox.rules": def()(optionalWorkspace),
  "inbox.toggleRule": def()(z.object({ id, enabled: z.boolean() })),
  /** Tạo (không có id) hoặc sửa luật tự động */
  "inbox.saveRule": def()(
    z.object({
      id: id.optional(),
      workspaceId: id.nullish(),
      channelId: id.nullish(),
      name: z.string().trim().min(1).max(80),
      keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
      action: z.enum(["reply_comment", "send_dm", "hide_comment"]),
      template: z.string().trim().max(1e3).nullish(),
      minDelaySec: z.number().int().min(0).max(600),
      maxDelaySec: z.number().int().min(0).max(600),
      enabled: z.boolean().optional()
    })
  ),
  "inbox.deleteRule": def()(byId),
  /** Đồng bộ ngay (một kênh hoặc tất cả kênh FB/IG đã kết nối) */
  "inbox.sync": def()(z.object({ channelId: id.optional() }).default({})),
  "inbox.worker": def()(none),
  "inbox.setAutoSync": def()(z.object({ enabled: z.boolean() })),
  /** Gửi lại tin bị lỗi */
  "inbox.resend": def()(byId),
  /** AI tự trả lời + Page tự thích bình luận + gắn nhãn khách tiềm năng */
  "inbox.aiSettings": def()(none),
  "inbox.setAiSettings": def()(
    z.object({
      mode: z.enum(["off", "draft", "auto"]).optional(),
      comments: z.boolean().optional(),
      messages: z.boolean().optional(),
      minConfidence: z.number().min(0.5).max(1).optional(),
      minDelaySec: z.number().int().min(0).max(600).optional(),
      maxDelaySec: z.number().int().min(0).max(900).optional(),
      maxPerHour: z.number().int().min(1).max(500).optional(),
      autoLike: z.boolean().optional(),
      tagLeads: z.boolean().optional()
    })
  ),
  /** Duyệt câu trả lời AI (có thể sửa) → gửi ngay */
  "inbox.approveDraft": def()(z.object({ id, body: z.string().trim().max(4e3).nullish() })),
  "inbox.discardDraft": def()(byId),
  /** AI Co-Pilot: gợi ý câu trả lời tiếp theo (không tự gửi) */
  "inbox.suggestReply": def()(z.object({ conversationId: id })),
  // Tổng quan / cảnh báo / nhật ký
  "dashboard.summary": def()(optionalWorkspace),
  "dashboard.topChannels": def()(
    z.object({ workspaceId: id.nullish(), limit: z.number().int().min(1).max(20).default(3) }).default({})
  ),
  "dashboard.daemon": def()(optionalWorkspace),
  "alerts.open": def()(none),
  "alerts.resolve": def()(byId),
  "activity.recent": def()(z.object({ limit: z.number().int().min(1).max(200).default(20) }).default({})),
  // BYOK – chỉ metadata; key thật chỉ được đọc trong main (P3)
  "ai.providers": def()(none),
  "ai.updateProvider": def()(
    z.object({
      id,
      patch: z.object({
        defaultModel: z.string().max(120).optional(),
        enabled: z.boolean().optional(),
        /** Endpoint tùy chỉnh (gateway/proxy nội bộ); null = mặc định của nhà cung cấp */
        baseUrl: z.string().url().max(300).nullable().optional()
      })
    })
  ),
  /** Lưu API key vào két (AES-256-GCM). Key không bao giờ quay lại renderer. */
  /** Lưu key rồi tự kiểm tra kết nối + tải danh sách model (cả nhà cung cấp dùng chung key) */
  "ai.setKey": def()(z.object({ providerId: id, key: z.string().trim().min(8).max(500) })),
  /** Gọi thử model đang chọn bằng một câu rất ngắn – phát hiện model 404 / quá tải trước khi dùng thật */
  "ai.testModel": def()(byId),
  "ai.removeKey": def()(z.object({ providerId: id })),
  /** Gọi endpoint xác thực của nhà cung cấp (không phát sinh phí), đo độ trễ, lấy danh sách model */
  "ai.test": def()(byId),
  "ai.testAll": def()(none),
  "ai.routing": def()(none),
  /** AI NT (AI văn bản mặc định của cloud): đang dùng không (chưa có key văn bản riêng) + hạn mức còn lại */
  "ai.omnira": def()(none),
  /** Sắp lại thứ tự ưu tiên các nhà cung cấp text (đầu danh sách = gọi trước) */
  "ai.reorder": def()(z.object({ ids: z.array(id).min(1).max(20) })),
  "ai.setFallback": def()(z.object({ enabled: z.boolean() })),
  "ai.pricing": def()(none),
  "ai.setPrice": def()(
    z.object({ model: z.string().trim().min(1).max(120), price: z.object({ input: z.number().min(0).max(1e3), output: z.number().min(0).max(1e3) }).nullable() })
  ),
  "vault.info": def()(none),
  "settings.budget": def()(none),
  "settings.setBudget": def()(z.object({ hardCapUsd: z.number().min(0).max(1e5), circuitBreaker: z.boolean() })),
  // Media Engine (P4)
  "media.info": def()(none),
  /** Dò lại encoder phần cứng (mỗi encoder mã hóa thử 0.2s) */
  "media.detect": def()(none),
  "media.setEncoder": def()(z.object({ encoder: z.enum(["auto", "h264_nvenc", "h264_amf", "h264_qsv", "libx264"]) })),
  "media.status": def()(none),
  "media.voices": def()(z.object({ provider: z.string().max(40) })),
  /** Giọng đọc local (VieNeu-TTS, GPU NVIDIA): trạng thái engine (detect = dò lại GPU) */
  // ── Xưởng Phim (shared/film.ts) ──
  /** Đủ điều kiện mở Xưởng Phim: key Veo (Gemini) hoặc Seedance (fal) + nguồn ảnh */
  "film.gate": def()(none),
  "film.list": def()(optionalWorkspace),
  "film.create": def()(
    z.object({
      title: z.string().trim().min(1).max(160),
      idea: z.string().max(4e3).default(""),
      style: z.string().max(400).default(""),
      genre: z.string().trim().max(120).nullish(),
      visualStyle: z.string().trim().max(300).nullish(),
      dialogueLanguage: z.string().trim().min(1).max(60).default("Tiếng Việt"),
      subtitleVi: z.boolean().optional(),
      notes: z.string().max(2e3).nullish(),
      aspect: z.enum(["9:16", "16:9", "1:1"]).default("16:9"),
      targetSec: z.number().int().min(15).max(900).default(120),
      videoEngine: z.enum(["seedance", "veo"]).optional(),
      workspaceId: id.nullish()
    })
  ),
  "film.get": def()(byId),
  "film.update": def()(
    z.object({
      id,
      patch: z.object({
        title: z.string().trim().min(1).max(160),
        idea: z.string().max(4e3),
        logline: z.string().max(600).nullable(),
        voiceMode: z.enum(["clip", "convert", "dub"]),
        style: z.string().max(600),
        genre: z.string().trim().max(120).nullable(),
        visualStyle: z.string().trim().max(300).nullable(),
        dialogueLanguage: z.string().trim().min(1).max(60),
        subtitleVi: z.boolean(),
        notes: z.string().max(2e3).nullable(),
        aspect: z.enum(["9:16", "16:9", "1:1"]),
        targetSec: z.number().int().min(15).max(900),
        videoEngine: z.enum(["seedance", "veo"]),
        imageEngine: z.enum(["google", "fal"]),
        takesPerRun: z.number().int().min(1).max(4),
        videoResolution: z.enum(["480p", "720p", "1080p"]),
        videoAudio: z.boolean(),
        videoTier: z.enum(["fast", "standard"]),
        workspaceId: id.nullable()
      }).partial()
    })
  ),
  "film.delete": def()(byId),
  /** AI viết kịch bản → thay toàn bộ nhân vật, bối cảnh, cảnh quay */
  "film.generateScript": def()(byId),
  /** Duyệt nhân vật AI đề xuất: episode = chỉ tập này, series = thêm vào dàn nhân vật series, drop = bỏ */
  "film.resolveProposals": def()(
    z.object({ filmId: id, decisions: z.array(z.object({ assetId: id, action: z.enum(["episode", "series", "drop"]) })).min(1).max(20) })
  ),
  /** Bối cảnh đã có ảnh ở các tập khác của cùng series (để dùng lại cho tập này) */
  "film.seriesLocations": def()(z.object({ filmId: id })),
  /** Dùng bối cảnh của tập khác: chép ảnh đã chọn (+ mô tả nếu copyText) vào bối cảnh `assetId` của phim này */
  "film.adoptLocation": def()(z.object({ filmId: id, assetId: id, sourceAssetId: id, copyText: z.boolean().default(true) })),
  /** Bảng nhân vật đã chọn → ảnh chuẩn của nhân vật series (các tập sau dùng) */
  "film.promoteToSeries": def()(z.object({ assetId: id })),
  /** Thêm (không có id) / sửa một mục */
  "film.saveAsset": def()(
    z.object({
      filmId: id,
      id: id.optional(),
      kind: z.enum(["character", "location", "shot"]),
      patch: z.object({
        name: z.string().trim().min(1).max(80),
        summary: z.string().max(600),
        description: z.string().max(1500),
        characterIds: z.array(id).max(6),
        locationId: id.nullable(),
        camera: z.string().max(300),
        durationSec: z.number().int().min(3).max(15),
        dialogue: z.string().max(800).nullable(),
        /** Cảnh quay: phụ đề tiếng Việt */
        subtitle: z.string().max(800).nullable(),
        /** Nhân vật: hồ sơ giọng (tiếng Anh) + giọng cố định */
        voiceProfile: z.string().max(300).nullable(),
        voiceProvider: z.string().max(40).nullable(),
        voiceId: z.string().max(120).nullable(),
        /** Bật = dùng nguyên prompt tiếng Anh người dùng sửa; tắt = AI dịch lại từ tóm tắt tiếng Việt khi tạo */
        promptManual: z.boolean()
      }).partial()
    })
  ),
  /** Cập nhật ngay prompt tiếng Anh của một mục theo tóm tắt tiếng Việt hiện tại (để xem trước) */
  "film.refreshPrompt": def()(z.object({ filmId: id, id })),
  "film.deleteAsset": def()(byId),
  "film.reorder": def()(z.object({ filmId: id, ids: z.array(id).max(200) })),
  /** Ước tính chi phí trước khi xếp hàng (takes: số bản mỗi mục, mặc định theo phim) */
  "film.estimate": def()(
    z.object({ filmId: id, assetIds: z.array(id).min(1).max(200), takes: z.number().int().min(1).max(4).optional(), kind: z.enum(["image", "video"]).default("image") })
  ),
  /** Xếp hàng tạo ảnh (mặc định) hoặc video (cảnh quay, khung đầu = khung hình đã chọn) */
  "film.generate": def()(
    z.object({ filmId: id, assetIds: z.array(id).min(1).max(200), takes: z.number().int().min(1).max(4).optional(), kind: z.enum(["image", "video"]).default("image") })
  ),
  /** Chọn bản (ảnh hoặc video – theo loại của bản). takeId null + video → bỏ chọn video */
  /** Nâng cấp độ phân giải video đã tạo (1080p / 4K) bằng Google Flow hoặc FFmpeg trên máy → bản tạo mới */
  "film.upscale": def()(z.object({ takeId: id, quality: z.enum(["1080p", "4k"]), method: z.enum(["flow", "local"]) })),
  "film.selectTake": def()(z.object({ assetId: id, takeId: id.nullable(), video: z.boolean().optional() })),
  "film.deleteTake": def()(byId),
  "film.cancel": def()(z.object({ filmId: id, takeIds: z.array(id).max(500).optional() })),
  /** Ghép tập: video đã chọn của các cảnh → MP4 (chạy nền, theo dõi qua film.assembleStatus) */
  "film.assemble": def()(
    z.object({
      filmId: id,
      options: z.object({
        transition: z.enum(["cut", "fade_black"]),
        clipAudio: z.boolean(),
        clipVolume: z.number().min(0).max(2),
        bgmTrack: z.string().max(200).nullable(),
        bgmVolume: z.number().min(0).max(1),
        subtitleStyle: z.string().max(60)
      })
    })
  ),
  "film.assembleStatus": def()(z.object({ filmId: id })),
  "film.assembleCancel": def()(z.object({ filmId: id })),
  "film.renders": def()(z.object({ filmId: id })),
  "film.deleteRender": def()(z.object({ filmId: id, file: z.string().max(400) })),
  /** Lưu bản ghép vào Kho nội dung → trả id nội dung */
  "film.renderToContent": def()(z.object({ filmId: id, file: z.string().max(400) })),
  /** Tối ưu lại từ khóa phong cách (tiếng Anh) từ thể loại / phong cách / ghi chú */
  "film.optimizeStyle": def()(byId),
  "film.queue": def()(z.object({ filmId: id.nullish() }).default({})),
  "film.setQueue": def()(
    z.object({ paused: z.boolean().optional(), imageConcurrency: z.number().int().min(1).max(8).optional(), videoConcurrency: z.number().int().min(1).max(4).optional() })
  ),
  /** Google Flow: tạo video Veo bằng tài khoản Google của khách (Chrome trên máy) thay cho Veo API */
  "flow.status": def()(none),
  "flow.setSource": def()(z.object({ source: z.enum(["api", "flow"]) })),
  "flow.setPrefs": def()(z.object({ hidden: z.boolean().optional(), concurrency: z.number().int().min(1).max(4).optional(), images: z.boolean().optional() })),
  "flow.setModel": def()(z.object({ model: z.enum(["Veo 3.1 - Fast", "Veo 3.1 - Lite", "Veo 3.1 - Quality", "Omni 1.1 Flash"]) })),
  /** Mở Chrome (profile riêng) ở trang Flow để người dùng tự đăng nhập Google */
  "flow.openLogin": def()(none),
  "flow.check": def()(none),
  /** Đọc lại credit Google Flow còn lại (mở Chrome ẩn nếu cần; đang tạo video thì giữ số cũ) */
  "flow.refreshCredits": def()(none),
  "flow.close": def()(none),
  /** Đăng xuất: đóng Chrome + xóa profile (phiên Google) khỏi máy */
  "flow.reset": def()(none),
  /** dryRun: kiểm tra giao diện (mọi bước trừ bấm tạo – không tốn credit, kèm tải khung hình mẫu) → diagnostics = thư mục ảnh chụp */
  "flow.test": def()(
    z.object({ prompt: z.string().trim().min(3).max(1e3), aspect: z.enum(["9:16", "16:9", "1:1"]).default("16:9"), dryRun: z.boolean().default(false) })
  ),
  "flow.cancelTest": def()(none),
  "flow.openDiagnostics": def()(none),
  "localtts.status": def()(z.object({ detect: z.boolean().default(false) }).default({})),
  /** Bắt đầu tải & cài engine (chạy nền – theo dõi qua localtts.status) */
  "localtts.install": def()(none),
  "localtts.cancel": def()(none),
  "localtts.uninstall": def()(none),
  "localtts.clones": def()(none),
  /** Chọn file giọng mẫu → giọng clone mới (null = hủy). consent: người dùng xác nhận có quyền dùng giọng này */
  "localtts.addClone": def()(z.object({ name: z.string().max(60), consent: z.literal(true) })),
  "localtts.renameClone": def()(z.object({ id, name: z.string().trim().min(1).max(60) })),
  "localtts.removeClone": def()(byId),
  /** Nghe thử giọng: đọc câu mẫu (lưu file vào media/voice-samples – lần sau phát lại, không gọi API); trả đường dẫn media tương đối */
  "media.previewVoice": def()(z.object({ provider: z.string().max(40), voiceId: z.string().max(120).nullish(), workspaceId: id.nullish() })),
  "media.bgmList": def()(none),
  /** Chọn file nhạc → chép vào media/bgm; trả tên file (null = hủy) */
  "media.importBgm": def()(none),
  /** Xóa file tạm của job cũ & cache media không dùng > 30 ngày */
  "media.cleanup": def()(none),
  /** Nhạc nền AI (tùy chọn) → lưu vào thư viện nhạc nền; trả tên file */
  "media.generateMusic": def()(
    z.object({
      provider: z.enum(["google_lyria", "elevenlabs_music"]),
      prompt: z.string().trim().min(3).max(500),
      durationSec: z.number().min(10).max(180).default(30),
      instrumental: z.boolean().default(true),
      workspaceId: id.nullish()
    })
  ),
  /** Nguồn ảnh AI ưu tiên cho chế độ Bán tự động */
  "media.imageEngine": def()(none),
  "media.setImageEngine": def()(z.object({ engine: z.enum(["auto", "google_image", "fal"]) })),
  "render.start": def()(z.object({ projectId: id })),
  /** Ước tính chi phí render (Veo, ảnh AI, giọng đọc trả phí) – cảnh đã có trong cache không tính */
  "render.estimate": def()(z.object({ projectId: id })),
  /** Chọn clip/ảnh của người dùng → chép vào thư mục media/uploads, trả đường dẫn để gắn vào cảnh */
  "media.importClips": def()(z.object({ multiple: z.boolean().default(false), images: z.boolean().default(false) }).default({})),
  "render.cancel": def()(byId),
  "render.jobs": def()(z.object({ projectId: id.nullish(), limit: z.number().int().min(1).max(100).default(20) }).default({})),
  /** Mở thư mục chứa file (chỉ trong thư mục media) */
  "media.showInFolder": def()(z.object({ path: z.string().min(1).max(500) })),
  /** Nâng cấp độ phân giải video (đường dẫn trong thư mục media) – xem shared/upscale.ts */
  "media.upscaleInfo": def()(z.object({ path: z.string().min(1).max(500) })),
  "media.upscale": def()(z.object({ path: z.string().min(1).max(500), quality: z.enum(["1080p", "4k"]), method: z.enum(["flow", "local"]) })),
  "media.upscaleProgress": def()(z.object({ path: z.string().min(1).max(500) })),
  "media.cancelUpscale": def()(z.object({ path: z.string().min(1).max(500) })),
  // Hệ thống
  "system.dbInfo": def()(none),
  /** Hộp thoại chọn ảnh (watermark…); null = hủy */
  "system.pickImage": def()(none),
  /** Chọn nhiều file ảnh/video để đăng (hộp thoại hệ thống) */
  "system.pickMedia": def()(none),
  "system.storage": def()(none),
  /** Thư mục & file log của ứng dụng */
  "system.logInfo": def()(none),
  "system.openLogs": def()(none),
  /** Chạy nền dưới khay hệ thống / khởi động cùng Windows (theo máy) */
  "system.background": def()(none),
  "system.setBackground": def()(z.object({ closeToTray: z.boolean().optional(), launchAtLogin: z.boolean().optional() }))
};
