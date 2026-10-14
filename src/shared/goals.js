export const GOAL_METRICS = {
  followers: { label: "Người theo dõi", unit: "người", hint: "Số người theo dõi hiện tại của kênh" },
  watch_minutes_60d: { label: "Phút xem 60 ngày", unit: "phút", hint: "Tổng phút xem video 60 ngày gần nhất (Facebook)" },
  views_30d: { label: "Lượt xem 30 ngày", unit: "lượt", hint: "Tổng lượt xem/tiếp cận 30 ngày gần nhất" },
  videos_30d: { label: "Video đăng 30 ngày", unit: "video", hint: "Số video/Reels đã đăng qua app trong 30 ngày" },
  engagements_30d: { label: "Tương tác 30 ngày", unit: "lượt", hint: "Tổng tương tác 30 ngày gần nhất" }
};

export const GOAL_PRESETS = [
  {
    id: "fb_instream_legacy",
    label: "Facebook – mốc quảng cáo trong video (từng công bố)",
    note: "Mốc Meta từng công bố cho quảng cáo trong video; điều kiện hiện hành có thể khác – kiểm tra trong Meta Business Suite.",
    goals: [
      { metric: "followers", target: 5e3 },
      { metric: "watch_minutes_60d", target: 6e4 },
      { metric: "videos_30d", target: 5 }
    ]
  },
  {
    id: "growth_10k",
    label: "Tăng trưởng – 10.000 người theo dõi",
    note: "Mốc tự đặt để theo dõi tăng trưởng.",
    goals: [
      { metric: "followers", target: 1e4 },
      { metric: "videos_30d", target: 30 }
    ]
  }
];
