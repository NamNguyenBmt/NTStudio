import { eq } from "drizzle-orm";
import {
  workspaces,
  proxies,
  browserProfiles,
  accounts,
  channels,
  channelMetricsDaily,
  aiProviders,
  aiUsage,
  contentItems,
  videoProjects,
  videoScenes,
  scheduledPosts,
  conversations,
  messages,
  quickReplies,
  autoReplyRules,
  alerts,
  activityLog,
  settings,
} from "./db/schema";
import { getDb, newId } from "./db/index";

const SEED_KEY = "demo.seeded";
const DAY = 864e5;
const HOUR = 36e5;

export function isSeeded() {
  return getDb().select().from(settings).where(eq(settings.key, SEED_KEY)).get() != null;
}

export function seedIfEmpty() {
  const allowed = process.env["OMNI_SEED"] === "1";
  if (!allowed) return false;
  const db = getDb();
  if (db.select({ id: workspaces.id }).from(workspaces).limit(1).get()) return false;
  db.transaction((tx) => seed(tx, Date.now()));
  return true;
}

function rng(seed2) {
  let t = seed2 >>> 0;
  return () => {
    t += 1831565813;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function at(base, dayOffset, hhmm) {
  const d = new Date(base + dayOffset * DAY);
  const [h, m] = hhmm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

function seed(db, now) {
  const ago = (ms) => new Date(now - ms);
  const goldenFashion = [
    { start: "06:00", end: "08:30", weight: 0.14 },
    { start: "11:00", end: "13:30", weight: 0.39 },
    { start: "14:00", end: "17:30", weight: 0.12 },
    { start: "19:30", end: "22:00", weight: 0.42 },
  ];
  const ws = { fashion: newId(), beauty: newId(), game: newId(), health: newId() };
  db.insert(workspaces)
    .values([
      {
        id: ws.fashion,
        name: "Thời Trang Nữ & Công sở",
        color: "#c0c1ff",
        icon: "shirt",
        description: "Dàn kênh thời trang công sở, váy cưới, phụ kiện",
        brandVoice: 'Thân thiện, xưng "em" – gọi khách là "chị/nàng", ngắn gọn, nhấn mạnh tôn dáng & chất liệu.',
        goldenHours: goldenFashion,
        tags: ["#Fashion", "#Reels", "#TikTokShop"],
        aiBudgetUsd: 40,
        watermarkPath: "watermark_glamour_v2.png",
        sortOrder: 0,
      },
      {
        id: ws.beauty,
        name: "Mỹ phẩm & Chăm sóc da",
        color: "#4edea3",
        icon: "sparkles",
        description: "Mỹ phẩm organic, skincare, son",
        brandVoice: "Chuyên gia dịu dàng, giải thích thành phần rõ ràng, không cam kết công dụng y khoa.",
        goldenHours: [
          { start: "12:00", end: "13:00", weight: 0.3 },
          { start: "20:00", end: "22:30", weight: 0.5 },
        ],
        tags: ["#Beauty", "#KOC", "#Review"],
        aiBudgetUsd: 20,
        sortOrder: 1,
      },
      {
        id: ws.game,
        name: "Game & Công nghệ Giải trí",
        color: "#4cd7f6",
        icon: "gamepad-2",
        description: "Review game, tin công nghệ",
        brandVoice: "Năng động, dùng thuật ngữ game thủ, hài hước vừa phải.",
        goldenHours: [{ start: "21:00", end: "23:59", weight: 0.6 }],
        tags: ["#Gaming", "#Esports", "#Shorts"],
        aiBudgetUsd: 25,
        sortOrder: 2,
      },
      {
        id: ws.health,
        name: "Sức khỏe & Healthy Living",
        color: "#F59E0B",
        icon: "heart-pulse",
        description: "Gym, dinh dưỡng, lối sống lành mạnh",
        goldenHours: [
          { start: "05:30", end: "07:00", weight: 0.35 },
          { start: "18:00", end: "20:00", weight: 0.4 },
        ],
        tags: ["#Health", "#Yoga", "#Gym"],
        aiBudgetUsd: 15,
        sortOrder: 3,
      },
    ])
    .run();
  const px = (workspaceId, label, host, port, country, latencyMs, health, kind = "residential") => {
    const id = newId();
    db.insert(proxies)
      .values({
        id,
        workspaceId,
        label,
        host,
        port,
        country,
        latencyMs,
        health,
        kind,
        exitIp: host,
        lastCheckedAt: ago(5 * 6e4),
      })
      .run();
    return id;
  };
  const proxy = {
    vnFpt: px(ws.fashion, "VN-FPT-01", "103.14.129.44", 9080, "VN", 42, "ok"),
    us02: px(ws.fashion, "US-02 Residential", "198.54.110.12", 4430, "US", 482, "warn"),
    sg04: px(ws.fashion, "SG-04", "128.199.70.21", 1080, "SG", 61, "ok", "datacenter"),
    usDallas: px(ws.fashion, "US-Dallas-01", "45.92.17.208", 1080, "US", 188, "ok"),
    usMiami: px(ws.fashion, "US-Miami-02", "45.92.19.77", 1080, "US", 236, "ok"),
    vnHn: px(ws.fashion, "VN-HN-02", "113.160.4.9", 1080, "VN", null, "error", "mobile"),
    vnVnpt: px(ws.fashion, "VN-VNPT-08", "14.177.66.3", 1080, "VN", 55, "ok"),
    vnHcm: px(ws.beauty, "VN-HCM-04", "103.14.130.12", 9080, "VN", 38, "ok"),
    vnViettel: px(ws.beauty, "VN-Viettel-03", "27.72.98.15", 1080, "VN", 47, "ok", "mobile"),
    sgGame: px(ws.game, "SG-GAME-01", "159.89.192.4", 1080, "SG", 72, "ok", "datacenter"),
    vnHealth: px(ws.health, "VN-FPT-07", "103.14.131.90", 9080, "VN", 40, "ok"),
  };
  const profile = (workspaceId, name, userAgent) => {
    const id = newId();
    db.insert(browserProfiles).values({ id, workspaceId, name, userAgent, webglVendor: "Google Inc. (NVIDIA)" }).run();
    return id;
  };
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const prof = {
    fashion: profile(ws.fashion, "Win10 Chrome 126 #9812", ua),
    beauty: profile(ws.beauty, "Win11 Chrome 126 #4410", ua),
    game: profile(ws.game, "Win10 Chrome 125 #7731", ua),
    health: profile(
      ws.health,
      "macOS Chrome 126 #2209",
      ua.replace("Windows NT 10.0; Win64; x64", "Macintosh; Intel Mac OS X 10_15_7"),
    ),
  };
  const channelIds = [];
  const addAccount = (a, chans) => {
    const accountId = newId();
    db.insert(accounts)
      .values({ id: accountId, ...a })
      .run();
    const kind = a.platform === "facebook" ? "fb_page" : a.platform === "tiktok" ? "tiktok_account" : "ig_account";
    const ids = chans.map((c2) => {
      const id = newId();
      db.insert(channels)
        .values({ id, accountId, platform: a.platform, workspaceId: a.workspaceId, kind, ...c2 })
        .run();
      channelIds.push({ id, platform: a.platform, followers: c2.followers ?? 0, name: c2.name });
      return id;
    });
    return { accountId, channelIds: ids };
  };
  const tokenOk = { tokenStatus: "valid", tokenExpiresAt: new Date(now + 58 * DAY), health: "ok" };
  const old = ago(90 * DAY);
  const via1 = addAccount(
    {
      workspaceId: ws.fashion,
      platform: "facebook",
      displayName: "NguyenVanA (VIA Cổ Kháng 902)",
      externalId: "1000849201",
      proxyId: proxy.vnFpt,
      browserProfileId: prof.fashion,
      twoFactorEnabled: true,
      sessionStatus: "valid",
      health: "ok",
      createdAt: old,
    },
    [
      {
        name: "Thời Trang Nữ Công Sở",
        externalId: "fb_page_99182",
        role: "admin",
        followers: 128400,
        nicheTag: "Công sở",
        ...tokenOk,
        createdAt: old,
      },
      {
        name: "Váy Cưới Cao Cấp Luxury",
        externalId: "fb_page_99183",
        role: "editor",
        followers: 54200,
        nicheTag: "Váy cưới",
        ...tokenOk,
        createdAt: old,
      },
      {
        name: "Đầm Dạ Hội Hà Nội",
        externalId: "fb_page_99184",
        role: "admin",
        followers: 37900,
        nicheTag: "Đầm dạ hội",
        ...tokenOk,
        createdAt: ago(3 * DAY),
      },
    ],
  );
  const via2 = addAccount(
    {
      workspaceId: ws.fashion,
      platform: "facebook",
      displayName: "TranThiB (VIA Ngoại US Nuôi 6 Tháng)",
      externalId: "1000723145",
      proxyId: proxy.us02,
      browserProfileId: prof.fashion,
      twoFactorEnabled: true,
      sessionStatus: "expiring",
      sessionExpiresAt: new Date(now - 40 * 6e4),
      health: "warn",
      note: "Cư dân US",
      createdAt: old,
    },
    [
      {
        name: "Giày Nữ HOT Trend",
        externalId: "fb_page_88102",
        role: "admin",
        followers: 21300,
        nicheTag: "Giày",
        tokenStatus: "expired",
        tokenExpiresAt: ago(2 * HOUR),
        status: "paused",
        health: "error",
        createdAt: old,
      },
      {
        name: "Túi Xách Quảng Châu Cao Cấp",
        externalId: "fb_page_88103",
        role: "admin",
        followers: 44800,
        nicheTag: "Túi xách",
        ...tokenOk,
        createdAt: old,
      },
    ],
  );
  const via3 = addAccount(
    {
      workspaceId: ws.beauty,
      platform: "facebook",
      displayName: "LeHoangNam (VIA XMDT BM50)",
      externalId: "1000912448",
      proxyId: proxy.vnHcm,
      browserProfileId: prof.beauty,
      twoFactorEnabled: true,
      sessionStatus: "valid",
      health: "ok",
      createdAt: old,
    },
    [
      {
        name: "Mỹ Phẩm Organic Việt",
        externalId: "fb_page_77201",
        role: "admin",
        followers: 66100,
        nicheTag: "Organic",
        ...tokenOk,
        createdAt: old,
      },
      {
        name: "Son Kem Lì Store",
        externalId: "fb_page_77202",
        role: "admin",
        followers: 31500,
        nicheTag: "Son",
        ...tokenOk,
        createdAt: ago(5 * DAY),
      },
    ],
  );
  const via4 = addAccount(
    {
      workspaceId: ws.game,
      platform: "facebook",
      displayName: "PhamDucGame (VIA Cổ 2015)",
      externalId: "1000655310",
      proxyId: proxy.sgGame,
      browserProfileId: prof.game,
      twoFactorEnabled: false,
      sessionStatus: "valid",
      health: "ok",
      createdAt: old,
    },
    [
      {
        name: "Game Thủ Việt",
        externalId: "fb_page_66301",
        role: "admin",
        followers: 212e3,
        nicheTag: "Game",
        ...tokenOk,
        createdAt: old,
      },
      {
        name: "Tech Review 247",
        externalId: "fb_page_66302",
        role: "editor",
        followers: 48700,
        nicheTag: "Công nghệ",
        ...tokenOk,
        createdAt: old,
      },
    ],
  );
  const via5 = addAccount(
    {
      workspaceId: ws.health,
      platform: "facebook",
      displayName: "VuThiHoa (VIA Healthy)",
      externalId: "1000588217",
      proxyId: proxy.vnHealth,
      browserProfileId: prof.health,
      twoFactorEnabled: true,
      sessionStatus: "valid",
      health: "ok",
      createdAt: old,
    },
    [
      {
        name: "Fanpage Sức Khỏe Mỗi Ngày",
        externalId: "fb_page_55401",
        role: "admin",
        followers: 73400,
        nicheTag: "Gym",
        ...tokenOk,
        createdAt: old,
      },
    ],
  );
  const session = (days) => ({ sessionStatus: "valid", sessionExpiresAt: new Date(now + days * DAY) });
  const tt1 = addAccount(
    {
      workspaceId: ws.fashion,
      platform: "tiktok",
      displayName: "Thời Trang Eva Official",
      handle: "thoitrangeva",
      externalId: "tt_70011",
      proxyId: proxy.usDallas,
      browserProfileId: prof.fashion,
      health: "ok",
      ...session(28),
      createdAt: old,
    },
    [
      {
        name: "Thời Trang Eva Official",
        handle: "thoitrangeva",
        externalId: "tt_70011",
        followers: 142500,
        nicheTag: "Công sở",
        tokenStatus: "valid",
        health: "ok",
        createdAt: old,
      },
    ],
  );
  addAccount(
    {
      workspaceId: ws.fashion,
      platform: "tiktok",
      displayName: "Phối Đồ Nàng Thơ",
      handle: "outfit_congso_giare",
      externalId: "tt_70012",
      proxyId: proxy.usMiami,
      browserProfileId: prof.fashion,
      health: "warn",
      note: "1 clip mute âm thanh",
      ...session(12),
      createdAt: old,
    },
    [
      {
        name: "Phối Đồ Nàng Thơ",
        handle: "outfit_congso_giare",
        externalId: "tt_70012",
        followers: 45200,
        nicheTag: "Nữ sinh",
        tokenStatus: "valid",
        health: "warn",
        createdAt: old,
      },
    ],
  );
  const tt3 = addAccount(
    {
      workspaceId: ws.beauty,
      platform: "tiktok",
      displayName: "Mẹo Đẹp Da",
      handle: "tips_lamdep_moingay",
      externalId: "tt_70013",
      proxyId: proxy.vnHcm,
      browserProfileId: prof.beauty,
      health: "ok",
      ...session(21),
      createdAt: old,
    },
    [
      {
        name: "Mẹo Đẹp Da",
        handle: "tips_lamdep_moingay",
        externalId: "tt_70013",
        followers: 89100,
        nicheTag: "Skincare",
        tokenStatus: "valid",
        health: "ok",
        createdAt: old,
      },
    ],
  );
  const tt4 = addAccount(
    {
      workspaceId: ws.fashion,
      platform: "tiktok",
      displayName: "Kho Sỉ Đầm Váy Giá Xưởng",
      handle: "kho_si_damvay",
      externalId: "tt_70014",
      proxyId: proxy.vnHn,
      browserProfileId: prof.fashion,
      sessionStatus: "expired",
      sessionExpiresAt: ago(1 * DAY),
      health: "error",
      note: "Tự động đăng nhập lại thất bại",
      createdAt: old,
    },
    [
      {
        name: "Kho Sỉ Đầm Váy Giá Xưởng",
        handle: "kho_si_damvay",
        externalId: "tt_70014",
        followers: 22800,
        nicheTag: "Đầm váy",
        tokenStatus: "expired",
        status: "error",
        health: "error",
        createdAt: old,
      },
    ],
  );
  const ig1 = addAccount(
    {
      workspaceId: ws.fashion,
      platform: "instagram",
      displayName: "Aura Luxe Fashion",
      handle: "auraluxe_official",
      externalId: "ig_481028",
      proxyId: proxy.sg04,
      browserProfileId: prof.fashion,
      health: "ok",
      ...session(45),
      createdAt: old,
    },
    [
      {
        name: "Aura Luxe Fashion",
        handle: "auraluxe_official",
        externalId: "ig_481028",
        followers: 38400,
        nicheTag: "Luxury",
        tokenStatus: "valid",
        health: "ok",
        createdAt: old,
      },
    ],
  );
  addAccount(
    {
      workspaceId: ws.fashion,
      platform: "instagram",
      displayName: "Eva Lookbook Daily",
      handle: "eva_lookbook_daily",
      externalId: "ig_481030",
      proxyId: proxy.vnVnpt,
      browserProfileId: prof.fashion,
      health: "ok",
      ...session(30),
      createdAt: ago(2 * DAY),
    },
    [
      {
        name: "Eva Lookbook Daily",
        handle: "eva_lookbook_daily",
        externalId: "ig_481030",
        followers: 12600,
        nicheTag: "Lookbook",
        tokenStatus: "valid",
        health: "ok",
        createdAt: ago(2 * DAY),
      },
    ],
  );
  addAccount(
    {
      workspaceId: ws.beauty,
      platform: "instagram",
      displayName: "Mỹ Phẩm Hữu Cơ",
      handle: "beauty_organic_vn",
      externalId: "ig_481029",
      proxyId: proxy.vnViettel,
      browserProfileId: prof.beauty,
      health: "ok",
      ...session(40),
      createdAt: old,
    },
    [
      {
        name: "Mỹ Phẩm Hữu Cơ",
        handle: "beauty_organic_vn",
        externalId: "ig_481029",
        followers: 19200,
        nicheTag: "Organic",
        tokenStatus: "valid",
        health: "ok",
        createdAt: old,
      },
    ],
  );
  const rand = rng(20251001);
  const metricRows = [];
  for (const c2 of channelIds) {
    const base = c2.followers * (c2.platform === "tiktok" ? 0.35 : c2.platform === "facebook" ? 0.06 : 0.12);
    for (let i = 59; i >= 0; i--) {
      const trend = 1 + ((59 - i) / 59) * 0.6;
      const weekend = [0, 6].includes(new Date(now - i * DAY).getDay()) ? 1.2 : 1;
      const views = Math.round(base * trend * weekend * (0.7 + rand() * 0.6));
      metricRows.push({
        channelId: c2.id,
        day: new Date(now - i * DAY).toISOString().slice(0, 10),
        views,
        engagements: Math.round(views * (0.05 + rand() * 0.04)),
        followers: Math.round(c2.followers * (0.9 + ((59 - i) / 59) * 0.1)),
      });
    }
  }
  for (let i = 0; i < metricRows.length; i += 200)
    db.insert(channelMetricsDaily)
      .values(metricRows.slice(i, i + 200))
      .run();
  const content = (v) => {
    const id = newId();
    db.insert(contentItems)
      .values({ id, ...v })
      .run();
    return id;
  };
  const c = {
    tips5: content({
      workspaceId: ws.fashion,
      kind: "video",
      title: "5 mẹo phối đồ công sở hack dáng",
      caption: "Nàng nấm lùn lưu ngay 5 mẹo này nhé!",
      hashtags: ["#congso", "#phoido", "#hackdang"],
      aspect: "9:16",
      durationSec: 28,
      status: "scheduled",
      source: "studio",
      aiReviewed: true,
    }),
    son: content({
      workspaceId: ws.beauty,
      kind: "carousel",
      title: "BST Son Kem Lì Kháng Nước Mùa Hè",
      caption: "4 tông màu hot nhất hè này",
      hashtags: ["#sonkem", "#makeup"],
      aspect: "4:5",
      status: "scheduled",
      source: "manual",
    }),
    desk: content({
      workspaceId: ws.game,
      kind: "reel",
      title: "3 mẹo tự động hóa bàn làm việc",
      aspect: "9:16",
      durationSec: 32,
      status: "published",
      source: "studio",
    }),
    gym: content({
      workspaceId: ws.health,
      kind: "carousel",
      title: "Lịch tập Gym giảm mỡ 7 ngày khoa học cho người mới bắt đầu",
      aspect: "4:5",
      status: "ready",
      source: "manual",
      aiReviewed: true,
    }),
    tee: content({
      workspaceId: ws.fashion,
      kind: "image",
      title: "Xả kho áo thun unisex chỉ 79k",
      caption: "Số lượng có hạn – inbox shop ngay!",
      aspect: "1:1",
      status: "published",
      source: "manual",
    }),
    aloe: content({
      workspaceId: ws.beauty,
      kind: "video",
      title: "Hướng dẫn làm trắng da ban đêm bằng nha đam tươi nguyên chất",
      aspect: "9:16",
      durationSec: 32,
      status: "ready",
      source: "studio",
    }),
    review: content({
      workspaceId: ws.beauty,
      kind: "text",
      title: "Review son kem lì không lem khi ăn uống, chống trôi 12h",
      status: "ready",
      source: "manual",
      spinVariants: 24,
      aiReviewed: true,
    }),
    outfit: content({
      workspaceId: ws.fashion,
      kind: "reel",
      title: "Top 3 outfit dạo phố cuối tuần cho nàng công sở năng động",
      aspect: "9:16",
      durationSec: 24,
      status: "ready",
      source: "studio",
    }),
    flash: content({
      workspaceId: ws.fashion,
      kind: "image",
      title: "Flash sale cuối tháng – giảm 50% toàn bộ áo khoác",
      aspect: "1:1",
      status: "scheduled",
      source: "manual",
    }),
    highlight: content({
      workspaceId: ws.game,
      kind: "video",
      title: "Highlight giải đấu cuối tuần",
      aspect: "16:9",
      durationSec: 58,
      status: "failed",
      source: "import",
    }),
    tweed: content({
      workspaceId: ws.fashion,
      kind: "carousel",
      title: "BST Thu Đông 2024: Áo khoác Tweed Parisian",
      aspect: "4:5",
      status: "published",
      source: "manual",
    }),
  };
  const [fbCongSo, , fbDamDa] = via1.channelIds;
  const [fbGiay] = via2.channelIds;
  const [fbOrganic] = via3.channelIds;
  const [fbGame] = via4.channelIds;
  const [fbHealth] = via5.channelIds;
  const post = (contentItemId, channelId, when, status, extra = {}) =>
    db
      .insert(scheduledPosts)
      .values({
        id: newId(),
        contentItemId,
        channelId,
        scheduledAt: when,
        status,
        publishedAt: status === "published" ? when : null,
        ...extra,
      })
      .run();
  post(c.tee, fbCongSo, at(now, -9, "08:00"), "published", { isGoldenHour: true, externalPostId: "fb_post_1" });
  post(c.tweed, fbCongSo, at(now, -4, "19:00"), "published", { isGoldenHour: true, externalPostId: "fb_post_2" });
  post(c.desk, fbGame, at(now, -3, "21:30"), "published", { isGoldenHour: true, externalPostId: "fb_post_3" });
  post(c.tweed, ig1.channelIds[0], at(now, -2, "14:00"), "published", { externalPostId: "ig_post_1" });
  post(c.highlight, fbGame, at(now, -1, "21:00"), "failed", {
    attempts: 3,
    error: "Lỗi Proxy – kết nối bị từ chối (thử lại)",
  });
  post(c.tips5, tt1.channelIds[0], at(now, 0, "11:30"), "queued", { isGoldenHour: true });
  post(c.flash, fbGiay, at(now, 1, "19:45"), "queued");
  post(c.son, fbOrganic, at(now, 2, "20:30"), "queued", { isGoldenHour: true });
  post(c.son, tt3.channelIds[0], at(now, 3, "12:00"), "queued", { isGoldenHour: true });
  post(c.tips5, fbDamDa, at(now, 5, "19:00"), "queued", { isGoldenHour: true });
  post(c.flash, fbCongSo, at(now, 8, "08:30"), "queued");
  post(c.gym, fbHealth, at(now, 10, "06:00"), "queued", { isGoldenHour: true });
  const convo = (v, msgs) => {
    const id = newId();
    const last = msgs[msgs.length - 1];
    db.insert(conversations)
      .values({
        id,
        ...v,
        lastMessageAt: ago(last.minutesAgo * 6e4),
        lastMessagePreview: msgs.filter((m) => m.direction === "in").at(-1)?.body ?? last.body,
      })
      .run();
    db.insert(messages)
      .values(
        msgs.map((m) => ({
          id: newId(),
          conversationId: id,
          direction: m.direction,
          author: m.author,
          body: m.body,
          deliveryStatus: m.direction === "out" ? "sent" : null,
          createdAt: ago(m.minutesAgo * 6e4),
        })),
      )
      .run();
  };
  convo(
    {
      workspaceId: ws.fashion,
      channelId: fbCongSo,
      platform: "facebook",
      source: "comment",
      customerName: "Minh Thảo",
      customerExternalId: "CUS-88492",
      contextPostTitle: "BST Thu Đông 2024: Áo khoác Tweed Parisian",
      tags: ["Hỏi giá", "VIP Khách cũ"],
      unreadCount: 1,
    },
    [
      {
        direction: "in",
        author: "customer",
        body: "Set dạ tweed màu be còn size M không shop? Có giao Hỏa tốc trong chiều nay qua Landmark 81 được không ạ? Mình cần gấp tối nay đi tiệc.",
        minutesAgo: 3,
      },
      {
        direction: "out",
        author: "bot",
        body: "Dạ chào chị Minh Thảo! Set dạ Tweed Parisian hiện shop vẫn còn sẵn 02 bộ size M tại kho trung tâm ạ. Shop đã nhắn tin riêng để hỗ trợ điều phối shipper giao gấp cho chị nhé!",
        minutesAgo: 2,
      },
    ],
  );
  convo(
    {
      workspaceId: ws.fashion,
      channelId: tt1.channelIds[0],
      platform: "tiktok",
      source: "direct",
      customerName: "Hoàng Long Auto",
      tags: ["Tích cực", "TikTok Ads"],
      unreadCount: 1,
    },
    [
      {
        direction: "in",
        author: "customer",
        body: "Chất vải dày dặn đúng chuẩn clip review, tư vấn mình size L cho nam cao 1m75 nhé",
        minutesAgo: 4,
      },
    ],
  );
  convo(
    {
      workspaceId: ws.fashion,
      channelId: ig1.channelIds[0],
      platform: "instagram",
      source: "direct",
      customerName: "Thanh Mai Vũ",
      tags: ["Tư vấn size"],
      status: "pending",
      unreadCount: 0,
    },
    [
      {
        direction: "in",
        author: "customer",
        body: "Cao 1m62 nặng 54kg thì vừa mẫu nào shop ơi? Váy xếp ly phối với áo blazer được không?",
        minutesAgo: 18,
      },
    ],
  );
  convo(
    {
      workspaceId: ws.fashion,
      channelId: fbCongSo,
      platform: "facebook",
      source: "comment",
      customerName: "Đức Cường Trần",
      contextPostTitle: "Xả kho áo thun unisex chỉ 79k",
      tags: ["Khiếu nại"],
      unreadCount: 1,
    },
    [
      {
        direction: "in",
        author: "customer",
        body: "Shipper gọi mà không giao kịp giờ hẹn trước 12h như lúc chốt đơn. Shop xử lý giúp mình với.",
        minutesAgo: 35,
      },
    ],
  );
  convo(
    {
      workspaceId: ws.beauty,
      channelId: fbOrganic,
      platform: "facebook",
      source: "messenger",
      customerName: "Lan Phương",
      tags: ["Hỏi giá"],
      unreadCount: 2,
    },
    [
      {
        direction: "in",
        author: "customer",
        body: "Serum nha đam dùng cho da dầu mụn được không shop?",
        minutesAgo: 65,
      },
      { direction: "in", author: "customer", body: "Giá combo 2 chai bao nhiêu ạ?", minutesAgo: 64 },
    ],
  );
  db.insert(quickReplies)
    .values([
      {
        id: newId(),
        workspaceId: ws.fashion,
        shortcut: "/size",
        title: "Bảng size chuẩn",
        body: "Dạ chị tham khảo bảng size: S (45-50kg), M (50-55kg), L (55-60kg), XL (60-66kg) ạ.",
      },
      {
        id: newId(),
        workspaceId: null,
        shortcut: "/ship",
        title: "Phí ship Hỏa tốc",
        body: "Dạ nội thành giao Hỏa tốc 1-2h, phí 25-35k tùy khoảng cách ạ.",
      },
      {
        id: newId(),
        workspaceId: null,
        shortcut: "/doitra",
        title: "Chính sách đổi trả",
        body: "Shop hỗ trợ đổi size/mẫu trong 7 ngày, sản phẩm còn tem mác và chưa qua sử dụng ạ.",
      },
    ])
    .run();
  db.insert(autoReplyRules)
    .values([
      {
        id: newId(),
        workspaceId: ws.fashion,
        name: "Hỏi giá → nhắn tin riêng",
        keywords: ["giá", "bao nhiêu", "ib", "size", "còn không"],
        action: "send_dm",
        template: "Dạ shop đã nhắn tin riêng báo giá và ưu đãi cho {name} rồi ạ!",
        minDelaySec: 15,
        maxDelaySec: 35,
      },
      {
        id: newId(),
        workspaceId: ws.fashion,
        name: "Ẩn bình luận chứa số điện thoại",
        keywords: ["{phone}"],
        action: "hide_comment",
        minDelaySec: 0,
        maxDelaySec: 1,
      },
    ])
    .run();
  db.insert(alerts)
    .values([
      {
        id: newId(),
        severity: "error",
        kind: "cookie_expired",
        entityType: "account",
        entityId: via2.accountId,
        title: "Nick VIA: TranThiB",
        message: "Phiên đăng nhập Facebook hết hạn 40 phút trước. Cần làm mới cookie hoặc đăng nhập lại.",
        createdAt: ago(40 * 6e4),
      },
      {
        id: newId(),
        severity: "warn",
        kind: "proxy_latency",
        entityType: "proxy",
        entityId: proxy.us02,
        title: "Proxy US-02 Residential",
        message: "Độ trễ 482ms (>450ms), có rủi ro nghẽn khi đăng tải Reels dung lượng lớn.",
        createdAt: ago(25 * 6e4),
      },
      {
        id: newId(),
        severity: "error",
        kind: "token_invalid",
        entityType: "channel",
        entityId: fbGiay,
        title: "Page: Giày Nữ HOT Trend",
        message: "Token Page mất quyền (hết hạn 2 giờ trước). Lịch đăng 3 bài bị hoãn.",
        createdAt: ago(2 * HOUR),
      },
      {
        id: newId(),
        severity: "error",
        kind: "checkpoint",
        entityType: "account",
        entityId: tt4.accountId,
        title: "TikTok: @kho_si_damvay",
        message: "Hết hạn phiên, tự động đăng nhập lại thất bại. Cần đăng nhập thủ công.",
        createdAt: ago(1 * DAY),
      },
    ])
    .run();
  db.insert(activityLog)
    .values([
      { level: "info", scope: "auto-reply", message: "Tự động trả lời 42 bình luận", createdAt: ago(1 * DAY) },
      { level: "warn", scope: "proxy", message: "Proxy US-02 Residential: độ trễ 482ms", createdAt: ago(25 * 6e4) },
      { level: "ok", scope: "token", message: "Kiểm tra Token Graph API: 8/9 hợp lệ", createdAt: ago(9 * HOUR) },
      {
        level: "ok",
        scope: "publish",
        message: 'Đăng bài tự động lên Page "Thời Trang Nữ Công Sở"',
        createdAt: ago(4 * HOUR),
      },
    ])
    .run();
  db.insert(aiProviders)
    .values([
      {
        id: newId(),
        provider: "openai",
        category: "text",
        label: "OpenAI GPT-4o",
        defaultModel: "gpt-4o",
        priority: 1,
      },
      {
        id: newId(),
        provider: "gemini",
        category: "text",
        label: "Gemini Flash",
        defaultModel: "gemini-2.5-flash",
        priority: 2,
      },
      {
        id: newId(),
        provider: "deepseek",
        category: "text",
        label: "DeepSeek V3 / R1",
        defaultModel: "deepseek-chat",
        priority: 0,
      },
      {
        id: newId(),
        provider: "anthropic",
        category: "text",
        label: "Claude",
        defaultModel: "claude-opus-5-5",
        priority: 3,
      },
      {
        id: newId(),
        provider: "elevenlabs",
        category: "tts",
        label: "ElevenLabs",
        defaultModel: "eleven_multilingual_v2",
        priority: 0,
      },
      {
        id: newId(),
        provider: "openai_tts",
        category: "tts",
        label: "OpenAI Audio",
        defaultModel: "gpt-4o-mini-tts",
        priority: 1,
      },
      {
        id: newId(),
        provider: "edge_tts",
        category: "tts",
        label: "Edge-TTS (Miễn phí)",
        defaultModel: "vi-VN-HoaiMyNeural",
        priority: 2,
        status: "valid",
      },
      {
        id: newId(),
        provider: "fal",
        category: "media",
        label: "Fal.ai (Flux)",
        defaultModel: "fal-ai/flux/schnell",
        priority: 0,
      },
      { id: newId(), provider: "replicate", category: "media", label: "Replicate", priority: 1 },
      { id: newId(), provider: "pexels", category: "media", label: "Pexels Stock", priority: 2 },
    ])
    .run();
  const providerId = (name) =>
    db.select({ id: aiProviders.id }).from(aiProviders).where(eq(aiProviders.provider, name)).get()?.id;
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const usageRows = [];
  const usage = (workspaceId, provider, model, feature, costUsd, n) => {
    const pid = providerId(provider);
    for (let i = 0; i < n; i++) {
      usageRows.push({
        id: newId(),
        providerId: pid,
        workspaceId,
        model,
        feature,
        inputTokens: provider === "elevenlabs" ? 0 : 1800,
        outputTokens: provider === "elevenlabs" ? 0 : 650,
        characters: provider === "elevenlabs" ? 900 : 0,
        costUsd: Math.round((costUsd / n) * 1e4) / 1e4,
        createdAt: new Date(Math.min(now, monthStart + rand() * Math.max(1, now - monthStart))),
      });
    }
  };
  usage(ws.fashion, "deepseek", "deepseek-chat", "script", 3.1, 18);
  usage(ws.fashion, "elevenlabs", "eleven_multilingual_v2", "tts", 2.4, 6);
  usage(ws.beauty, "openai", "gpt-4o", "caption", 1.2, 5);
  usage(ws.game, "deepseek", "deepseek-chat", "script", 0.6, 4);
  if (usageRows.length) db.insert(aiUsage).values(usageRows).run();
  const projectId = newId();
  db.insert(videoProjects)
    .values({
      id: projectId,
      workspaceId: ws.fashion,
      contentItemId: c.tips5,
      targetChannelId: tt1.channelIds[0],
      topic: "5 mẹo phối đồ công sở mùa đông hack dáng cao thêm 5cm cho nàng nấm lùn",
      targetDurationSec: 30,
      ttsProvider: "elevenlabs",
      voiceId: "Ngọc Mai",
      renderMode: "stock",
      bgmTrack: "Chill Lofi #12",
      status: "scripted",
    })
    .run();
  db.insert(videoScenes)
    .values([
      {
        id: newId(),
        projectId,
        position: 0,
        label: "Hook Giật gân",
        voiceover: "Đừng mặc áo khoác dạ nếu nàng cao dưới 1m55 mà chưa biết mẹo này!",
        durationSec: 4,
        mediaPrompt: "woman coat street hanoi autumn",
        mediaSource: "stock",
      },
      {
        id: newId(),
        projectId,
        position: 1,
        label: "Mẹo #1 · Tỷ lệ 1/3",
        voiceover:
          "Quy tắc vàng: Chiều dài áo chỉ qua gối 5cm, kết hợp cùng boots cao cổ cùng tông màu để tạo hiệu ứng kéo dài chân.",
        durationSec: 8,
        mediaPrompt: "knee-length coat office woman",
        mediaSource: "stock",
      },
      {
        id: newId(),
        projectId,
        position: 2,
        label: "Mẹo #2 · Thắt eo cao",
        voiceover:
          "Tuyệt đối chọn áo có đai thắt cao hơn rốn 3cm. Điểm thắt này sẽ tái định vị vòng eo, ăn gian tỉ lệ cơ thể.",
        durationSec: 8,
        mediaPrompt: "high waist belt coat",
        mediaSource: "stock",
      },
      {
        id: newId(),
        projectId,
        position: 3,
        label: "CTA Chốt đơn",
        voiceover: "Lưu ngay video này và ghé shop để chọn mẫu áo khoác hack dáng nhé!",
        durationSec: 8,
        mediaPrompt: "fashion store coats rack",
        mediaSource: "stock",
      },
    ])
    .run();
  db.insert(settings)
    .values([
      { key: "budget.monthlyHardCapUsd", value: 50 },
      { key: "ai.fallbackOnError", value: true },
      { key: SEED_KEY, value: { at: now } },
    ])
    .run();
}
