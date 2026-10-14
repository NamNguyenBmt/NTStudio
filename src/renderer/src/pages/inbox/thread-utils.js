export const sourceLabel = { comment: "Bình luận bài viết công khai", messenger: "Messenger", direct: "Tin nhắn Direct" };
export const time = (d) => d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

export const dayLabel = (d) => {
  const today = new Date();
  const y = new Date(today.getTime() - 864e5);
  if (d.toDateString() === today.toDateString()) return `Hôm nay, ${time(d)}`;
  if (d.toDateString() === y.toDateString()) return `Hôm qua, ${time(d)}`;
  return d.toLocaleDateString("vi-VN");
};
