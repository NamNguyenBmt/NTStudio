export const FORMAT_GROUPS = [
  { id: "product", label: "Sản phẩm & thương hiệu" },
  { id: "story", label: "Kể chuyện & phim" },
  { id: "knowledge", label: "Kiến thức & hướng dẫn" },
  { id: "entertainment", label: "Giải trí & tin tức" }
];

export const CONTENT_FORMATS = [
  {
    id: "free",
    group: "entertainment",
    label: "Tự do",
    hint: "Không theo khuôn cố định",
    guide: "Cấu trúc tự do, mở đầu gây tò mò, kết thúc kêu gọi theo dõi.",
    kind: "video"
  },
  {
    id: "episode",
    group: "story",
    label: "Tập phim ngắn",
    hint: "Một tập trong series phim ngắn AI",
    guide: "Kể chuyện có thoại nhân vật, có xung đột, kết bằng tình huống treo để người xem chờ tập sau.",
    kind: "video"
  },
  {
    id: "top_list",
    group: "entertainment",
    label: "Top danh sách",
    hint: "Top 5 / Top 10 …",
    guide: "Cảnh mở nêu chủ đề và hứa hẹn vị trí số 1 bất ngờ; mỗi cảnh một hạng mục đếm ngược; cảnh cuối là hạng số 1 và câu hỏi cho khán giả.",
    kind: "video"
  },
  {
    id: "news",
    group: "entertainment",
    label: "Tin nhanh",
    hint: "Điểm tin ngắn, đúng trọng tâm",
    guide: "Câu đầu là thông tin quan trọng nhất; các cảnh sau giải thích bối cảnh và ảnh hưởng; không suy đoán, nêu rõ nguồn nếu có.",
    kind: "video"
  },
  {
    id: "quiz",
    group: "entertainment",
    label: "Đố vui / thử thách",
    hint: "Câu hỏi – đếm ngược – đáp án",
    guide: "Đặt câu hỏi ngay cảnh đầu, mời người xem bình luận đáp án, đếm ngược, công bố đáp án và giải thích ngắn.",
    kind: "video"
  },
  {
    id: "story",
    group: "story",
    label: "Kể chuyện / sự thật thú vị",
    hint: "Câu chuyện, giai thoại, sự thật ít ai biết",
    guide: "Mở bằng chi tiết gây tò mò, kể theo trình tự có cao trào, kết bằng bài học hoặc sự thật bất ngờ.",
    kind: "video"
  },
  {
    id: "explainer",
    group: "knowledge",
    label: "Giải thích / kiến thức",
    hint: "Giải thích một khái niệm, cách làm",
    guide: "Nêu câu hỏi người xem hay thắc mắc, giải thích từng bước bằng ví dụ dễ hiểu, tóm tắt một câu ở cuối.",
    kind: "video"
  },
  {
    id: "lyric",
    group: "entertainment",
    label: "Video lời bài hát",
    hint: "Nhạc AI hoặc nhạc bạn có bản quyền",
    guide: "Mỗi cảnh một câu/đoạn lời, hình ảnh minh họa theo cảm xúc bài hát; chỉ dùng lời và nhạc do người dùng sở hữu hoặc nhạc AI.",
    kind: "video"
  },
  {
    id: "match_recap",
    group: "entertainment",
    label: "Tóm tắt trận đấu",
    hint: "Từ kết quả & số liệu, không dùng hình ảnh có bản quyền",
    guide: "Tỉ số và điểm nhấn ngay cảnh đầu; diễn biến chính theo thời gian; số liệu nổi bật; nhận định ngắn. Hình minh họa là đồ họa/AI, không dùng cảnh quay trận đấu.",
    kind: "video"
  },
  {
    id: "quote",
    group: "story",
    label: "Trích dẫn / truyền cảm hứng",
    hint: "Câu nói hay, thông điệp ngắn",
    guide: "Một thông điệp chính, nhịp chậm, hình ảnh giàu cảm xúc, kết bằng lời mời chia sẻ.",
    kind: "video"
  },
  // ── Sản phẩm & thương hiệu ──
  {
    id: "product_review",
    group: "product",
    label: "Review sản phẩm",
    hint: "Đánh giá trung thực: điểm nổi bật, điểm cần lưu ý, ai nên dùng",
    guide: 'Cảnh 1 là hook: một khoảnh khắc/vấn đề người xem gặp hằng ngày hoặc cảnh cận sản phẩm ấn tượng. Tiếp theo giới thiệu sản phẩm (tên, dành cho ai). Mỗi cảnh sau là MỘT điểm nổi bật kèm cảnh minh họa đang sử dụng sản phẩm. Có một cảnh nêu điểm cần lưu ý (trung thực, không phóng đại). Kết: ai nên dùng + CTA (bình luận, theo dõi). CHỈ dùng thông tin sản phẩm người dùng cung cấp – không bịa thông số, giá, khuyến mãi, cam kết công dụng. mediaPrompt mô tả "the product" (theo ảnh tham chiếu) ở góc máy cận/trung, ánh sáng studio hoặc bối cảnh sử dụng thực tế.',
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "semi_ai" },
    refsHint: "Ảnh sản phẩm 2–3 góc, nền sạch – AI dựng cảnh giữ đúng hình dáng, màu sắc sản phẩm",
    topicPlaceholder: "Tai nghe XYZ Pro: chống ồn tốt, pin 30 giờ, hơi nặng; dành cho người hay đi tàu xe"
  },
  {
    id: "unboxing",
    group: "product",
    label: "Mở hộp (Unboxing)",
    hint: "Từ hộp kín tới lần dùng đầu tiên",
    guide: 'Hook: hộp còn nguyên seal và câu hỏi "bên trong có gì?". Lần lượt mở hộp, giới thiệu từng món trong hộp, cảm nhận chất liệu – thiết kế, bật/dùng thử lần đầu, cảm nhận ban đầu ngắn gọn, CTA. Không bịa thông số. mediaPrompt: cận tay mở hộp, sản phẩm theo ảnh tham chiếu, ánh sáng mềm.',
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "semi_ai" },
    refsHint: "Ảnh hộp và sản phẩm",
    topicPlaceholder: "Mở hộp máy ảnh ABC bản giới hạn màu xanh rêu"
  },
  {
    id: "comparison",
    group: "product",
    label: "So sánh A vs B",
    hint: "Đặt hai lựa chọn cạnh nhau theo từng tiêu chí",
    guide: 'Hook nêu câu hỏi "chọn A hay B?". Mỗi cảnh một tiêu chí (thiết kế, hiệu năng, trải nghiệm, giá trị…) so sánh công bằng, chỉ dùng thông tin người dùng cung cấp. Kết: A hợp với ai, B hợp với ai, mời khán giả bình luận lựa chọn. mediaPrompt: hai sản phẩm đặt cạnh nhau hoặc chia đôi khung hình.',
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "semi_ai" },
    refsHint: "Ảnh của cả hai sản phẩm",
    topicPlaceholder: "So sánh máy lọc không khí A và B cho phòng ngủ 20m²"
  },
  {
    id: "teaser",
    group: "product",
    label: "Teaser / Trailer",
    hint: "Giới thiệu phim, sự kiện, sản phẩm sắp ra mắt",
    guide: "Nhịp nhanh, nhiều cảnh ngắn 2–4 giây, lời dẫn ít chữ và giàu cảm xúc, giữ bí ẩn; cao trào ở 2/3 video; cảnh cuối là tên + thời điểm ra mắt và lời hẹn. mediaPrompt điện ảnh: góc máy ấn tượng, chuyển động camera, ánh sáng tương phản.",
    kind: "video",
    defaults: { targetDurationSec: 30, aspect: "16:9", renderMode: "full_ai" },
    refsHint: "Ảnh poster, nhân vật hoặc sản phẩm chính (tùy chọn)",
    topicPlaceholder: 'Trailer series phim ngắn "Làng sương" – ra mắt tập 1 tối thứ Sáu'
  },
  // ── Kiến thức & đời sống ──
  {
    id: "how_to",
    group: "knowledge",
    label: "Hướng dẫn từng bước",
    hint: "Làm được ngay sau khi xem",
    guide: 'Hook: kết quả cuối cùng trước. Nêu cần chuẩn bị gì. Mỗi cảnh MỘT bước, đánh số rõ ràng, câu ngắn ra lệnh ("Bước 2: …"). Có một mẹo/lỗi hay gặp. Kết: tóm tắt + CTA lưu video.',
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "semi_ai" },
    topicPlaceholder: "Cách chụp ảnh chân dung đẹp bằng điện thoại trong 5 bước"
  },
  {
    id: "recipe",
    group: "knowledge",
    label: "Công thức nấu ăn",
    hint: "Nguyên liệu – các bước – thành phẩm",
    guide: "Hook: món thành phẩm hấp dẫn. Cảnh nguyên liệu (liệt kê ngắn). Mỗi cảnh một bước nấu với thời gian/nhiệt độ cụ thể nếu có. Kết: thành phẩm + mẹo + CTA. mediaPrompt: góc máy từ trên xuống hoặc cận món ăn, ánh sáng tự nhiên ấm.",
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "semi_ai" },
    topicPlaceholder: "Bánh flan caramel không cần lò nướng"
  },
  {
    id: "before_after",
    group: "knowledge",
    label: "Trước – sau",
    hint: "Sự thay đổi rõ ràng sau một quá trình",
    guide: 'Hook: cảnh "trước" và hứa hẹn kết quả. Quá trình thay đổi qua từng giai đoạn. Cảnh "sau" đặt cạnh "trước". Kết: điều rút ra + CTA. Không phóng đại kết quả.',
    kind: "video",
    defaults: { targetDurationSec: 30, aspect: "9:16", renderMode: "full_ai" },
    refsHint: 'Ảnh "trước" và "sau" – dùng làm khung đầu / khung cuối cho Veo',
    topicPlaceholder: "Cải tạo ban công cũ thành góc cà phê nhỏ"
  },
  // ── Giải trí ──
  {
    id: "vlog",
    group: "entertainment",
    label: "Vlog / Du lịch",
    hint: "Một ngày, một chuyến đi, một trải nghiệm",
    guide: "Kể ở ngôi thứ nhất, giọng thân mật. Hook: khoảnh khắc đẹp nhất. Đi theo trình tự thời gian, mỗi cảnh một địa điểm/khoảnh khắc với cảm nhận ngắn. Kết: cảm xúc + CTA.",
    kind: "video",
    defaults: { targetDurationSec: 60, aspect: "9:16", renderMode: "stock" },
    topicPlaceholder: "Một ngày ở phố cổ Hội An mùa mưa"
  },
  {
    id: "poll_post",
    label: "Bình chọn / hỏi khán giả",
    hint: "Bài viết kêu gọi bình luận",
    guide: "Bài viết ngắn đặt một câu hỏi hai-ba lựa chọn rõ ràng để khán giả bình luận.",
    kind: "post"
  }
];

const CUSTOM = /^custom(-post)?:(.+)$/s;
export const CUSTOM_FORMAT_MAX = 60;
export const customFormatId = (label, kind) => `${kind === "post" ? "custom-post" : "custom"}:${label.replace(/\s+/g, " ").trim().slice(0, CUSTOM_FORMAT_MAX)}`;
export const isCustomFormat = (id) => !!id && CUSTOM.test(id);

export const formatById = (id) => {
  const m = id?.match(CUSTOM);
  if (m) {
    const label = m[2].trim();
    return {
      id,
      label,
      hint: "Định dạng tự nhập",
      guide: `Theo định dạng "${label}" do người dùng đặt: dựng nội dung đúng tinh thần định dạng này, mở đầu gây tò mò, kết thúc có lời kêu gọi.`,
      kind: m[1] ? "post" : "video"
    };
  }
  return CONTENT_FORMATS.find((f) => f.id === id) ?? CONTENT_FORMATS[0];
};
