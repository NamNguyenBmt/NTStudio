import { useApiQuery, useApiMutation } from "../../lib/api";
import { LoaderCircle } from "lucide-react";
import { Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { Switch } from "../../components/ui/Switch";
import { PlatformIcon } from "../../components/PlatformIcon";
import { toast } from "../../components/ui/toast";

const CATEGORIES = [
  ["22", "Mọi người & Blog"],
  ["24", "Giải trí"],
  ["1", "Phim & Hoạt hình"],
  ["10", "Âm nhạc"],
  ["17", "Thể thao"],
  ["20", "Trò chơi"],
  ["26", "Hướng dẫn & Phong cách"],
  ["27", "Giáo dục"],
  ["28", "Khoa học & Công nghệ"],
  ["25", "Tin tức & Chính trị"],
  ["19", "Du lịch & Sự kiện"],
  ["23", "Hài kịch"],
];

export function InstagramSetting() {
  const { data: meta } = useApiQuery("integrations.meta");
  const set = useApiMutation("integrations.setInstagram", ["integrations."]);
  return (
    <div className="flex items-start gap-space-sm rounded-xl border border-overlay/[0.08] bg-surface-container-lowest p-space-md">
      <PlatformIcon platform="instagram" size={18} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-label-md text-on-surface">Kết nối cả Instagram khi kết nối Facebook</div>
        <p className="text-body-sm text-on-surface-variant">
          Tài khoản Instagram chuyên nghiệp đã liên kết với Fanpage sẽ được thêm cùng lúc. Kết nối lại Facebook sau khi
          bật để chọn tài khoản Instagram.
        </p>
      </div>
      {set.isPending && <LoaderCircle size={14} className="mt-1 animate-spin text-on-surface-variant" />}
      <Switch
        checked={!!meta?.instagram}
        disabled={!meta || set.isPending}
        label="Kết nối cả Instagram"
        onChange={(v) =>
          set.mutate(
            { enabled: v },
            {
              onSuccess: () =>
                toast.success(v ? "Đã bật – kết nối lại Facebook để chọn tài khoản Instagram" : "Đã tắt Instagram"),
              onError: (e) => toast.error(e.message),
            },
          )
        }
      />
    </div>
  );
}

export function YoutubePublishSettings() {
  const { data: app } = useApiQuery("integrations.youtube");
  const save = useApiMutation("integrations.setYoutubePublish", ["integrations."]);
  const pub = app?.publish;
  if (!pub) return null;
  return (
    <div className="flex flex-col gap-space-md rounded-xl border border-overlay/[0.08] bg-surface-container-lowest p-space-md">
      <div className="flex items-center gap-space-sm text-label-md text-on-surface">
        <PlatformIcon platform="youtube" size={18} />
        {" Khi đăng video lên YouTube"}
      </div>
      <div className="grid grid-cols-1 gap-space-md md:grid-cols-2">
        <Field label="Chế độ hiển thị">
          {(id) => (
            <Select id={id} value={pub.privacy} onChange={(e) => save.mutate({ privacy: e.target.value })}>
              <option value="public">Công khai</option>
              <option value="unlisted">Không công khai (ai có link mới xem được)</option>
              <option value="private">Riêng tư</option>
            </Select>
          )}
        </Field>
        <Field label="Danh mục video">
          {(id) => (
            <Select id={id} value={pub.categoryId} onChange={(e) => save.mutate({ categoryId: e.target.value })}>
              {CATEGORIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-start gap-space-sm text-body-sm text-on-surface-variant">
          <Switch
            checked={pub.declareSynthetic}
            onChange={(v) => save.mutate({ declareSynthetic: v })}
            label="Gắn nhãn nội dung AI"
          />
          <span>
            <b className="text-on-surface">Gắn nhãn "nội dung tạo bằng AI"</b>
            {" cho video làm trong Xưởng video (YouTube yêu cầu khai báo nội dung tổng hợp trông như thật)"}
          </span>
        </label>
        <label className="flex items-start gap-space-sm text-body-sm text-on-surface-variant">
          <Switch
            checked={pub.notifySubscribers}
            onChange={(v) => save.mutate({ notifySubscribers: v })}
            label="Thông báo người đăng ký"
          />
          <span>
            <b className="text-on-surface">Thông báo cho người đăng ký</b>
            {" khi có video mới"}
          </span>
        </label>
      </div>
      <p className="text-label-sm text-outline">Video dọc ≤ 3 phút tự đăng thành Shorts.</p>
    </div>
  );
}
