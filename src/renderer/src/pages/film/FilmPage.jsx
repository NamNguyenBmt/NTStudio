import { useState } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { useNavigate, useParams } from "react-router-dom";
import { Clapperboard, Film, KeyRound, LoaderCircle, Plus } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Dialog } from "../../components/ui/Dialog";
import { Input, Textarea, Select } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { toast } from "../../components/ui/toast";
import { useUiStore } from "../../stores/ui";
import { mediaUrl } from "../../lib/media";
import { formatRelative } from "../../lib/format";
import { ASPECT_LABEL, durationLabel } from "../../../../shared/video";
import { EMPTY_FILM_STYLE } from "../../../../shared/film";
import { StyleFields } from "../../components/film/StyleFields";
import { FilmWorkspace } from "./FilmWorkspace";

const LENGTHS = [30, 60, 120, 180, 300, 600];

export function FilmPage() {
  const { id } = useParams();
  const { data: gate } = useApiQuery("film.gate", void 0, { staleTime: 0 });
  if (!gate) return <div className="p-space-lg text-on-surface-variant">Đang kiểm tra…</div>;
  if (!gate.ok) return <GateScreen gate={gate} />;
  return id ? <FilmWorkspace id={id} gate={gate} /> : <FilmList gate={gate} />;
}

function GateScreen({ gate }) {
  const navigate = useNavigate();
  const row = (ok, label, hint) => (
    <li className="flex items-start gap-space-sm">
      <Badge tone={ok ? "success" : "neutral"}>{ok ? "Có" : "Chưa"}</Badge>
      <span className="flex flex-col">
        <span className="text-on-surface">{label}</span>
        <span className="text-label-sm text-on-surface-variant">{hint}</span>
      </span>
    </li>
  );
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-space-md py-space-xl">
      <Card className="flex flex-col gap-space-md p-space-lg">
        <h1 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
          <Film size={20} className="text-secondary" />
          {" Xưởng Phim"}
        </h1>
        <p className="text-body-md text-on-surface-variant">
          Làm phim AI theo quy trình chuyên nghiệp: kịch bản → nhân vật → bối cảnh → khung hình → video → ghép tập. Cần
          tài khoản model video AI của riêng bạn (BYOK).
        </p>
        <ul className="flex flex-col gap-space-sm text-body-sm">
          {row(
            gate.veo || gate.seedance,
            "Model video: Google Veo hoặc Seedance 2.0",
            "Veo dùng key Gemini (cần bật thanh toán) hoặc tài khoản Google Flow · Seedance dùng key Fal.ai",
          )}
          {row(
            gate.imageGoogle || gate.imageFal || gate.imageFlow,
            "Nguồn tạo ảnh: Nano Banana",
            "Qua Google Flow (ưu tiên, 0 tín dụng), key Gemini, hoặc Fal.ai",
          )}
        </ul>
        <Button variant="primary" className="self-start" onClick={() => navigate("/settings?tab=ai")}>
          <KeyRound size={14} />
          {" Nhập key ở Cài đặt"}
        </Button>
      </Card>
    </div>
  );
}

function FilmList({ gate }) {
  const navigate = useNavigate();
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const { data: films = [] } = useApiQuery("film.list", { workspaceId });
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex flex-col gap-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h1 className="flex items-center gap-space-sm text-headline-sm text-on-surface">
          <Film size={18} className="text-secondary" />
          {" Xưởng Phim"}
        </h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={14} />
          {" Phim mới"}
        </Button>
      </div>
      {films.length === 0 ? (
        <Card className="flex flex-col items-center gap-space-sm p-space-xl text-center">
          <Clapperboard size={28} className="text-outline" />
          <p className="max-w-md text-body-md text-on-surface-variant">
            Chưa có phim nào. Tạo phim mới, nhập ý tưởng để AI viết kịch bản, rồi tạo nhân vật, bối cảnh và khung hình
            song song nhiều luồng.
          </p>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} />
            {" Tạo phim đầu tiên"}
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
          {films.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => navigate(`/film/${f.id}`)}
              className="flex flex-col overflow-hidden rounded-xl border border-overlay/[0.08] bg-surface-container text-left transition-colors hover:bg-surface-container-high"
            >
              <div className="aspect-video w-full bg-surface-container-lowest">
                {f.cover ? (
                  <img src={mediaUrl(f.cover)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Film size={28} className="m-auto mt-[18%] text-outline" />
                )}
              </div>
              <div className="flex flex-col gap-1 p-space-sm">
                <span className="truncate text-label-md text-on-surface">{f.title}</span>
                <span className="line-clamp-2 min-h-[2.5em] text-label-sm text-on-surface-variant">
                  {f.logline || f.idea || "Chưa có kịch bản"}
                </span>
                <span className="flex flex-wrap gap-1 font-mono text-[10px] text-outline">
                  {f.characters}
                  {" nhân vật · "}
                  {f.locations}
                  {" bối cảnh · "}
                  {f.shots}
                  {" cảnh · "}
                  {durationLabel(f.targetSec)}
                  {" · "}
                  {f.aspect}
                  {" · "}
                  {formatRelative(f.updatedAt)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      <NewFilmDialog
        open={creating}
        onClose={() => setCreating(false)}
        gate={gate}
        workspaceId={workspaceId}
        onCreated={(id) => navigate(`/film/${id}`)}
      />
    </div>
  );
}

function NewFilmDialog({ open, onClose, gate, workspaceId, onCreated }) {
  const create = useApiMutation("film.create", ["film."]);
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [targetSec, setTargetSec] = useState(120);
  const [engine, setEngine] = useState(gate.seedance ? "seedance" : "veo");
  const [look, setLook] = useState(EMPTY_FILM_STYLE);
  const submit = () =>
    create.mutate(
      {
        title: title.trim() || "Phim chưa đặt tên",
        idea,
        aspect,
        targetSec,
        videoEngine: engine,
        workspaceId,
        ...look,
      },
      {
        onSuccess: (f) => (onClose(), setTitle(""), setIdea(""), setLook(EMPTY_FILM_STYLE), onCreated(f.id)),
        onError: (e) => toast.error(e.message),
      },
    );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Phim mới"
      width={620}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" disabled={create.isPending} onClick={submit}>
            {create.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />}
            {" Tạo phim"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-space-md">
        <Field label="Tên phim">
          {(id) => (
            <Input
              id={id}
              value={title}
              maxLength={160}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Có thể để AI đặt"
            />
          )}
        </Field>
        <Field label="Ý tưởng" hint="Cốt truyện, nhân vật, không khí… càng cụ thể AI viết kịch bản càng sát">
          {(id) => (
            <Textarea
              id={id}
              value={idea}
              maxLength={4e3}
              onChange={(e) => setIdea(e.target.value)}
              className="min-h-[110px]"
            />
          )}
        </Field>
        <StyleFields value={look} onChange={(p) => setLook((l) => ({ ...l, ...p }))} />
        <div className="grid grid-cols-3 gap-space-sm">
          <Field label="Khung hình">
            {(id) => (
              <Select id={id} value={aspect} onChange={(e) => setAspect(e.target.value)}>
                {Object.keys(ASPECT_LABEL).map((a) => (
                  <option key={a} value={a}>
                    {ASPECT_LABEL[a]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Thời lượng">
            {(id) => (
              <Select id={id} value={targetSec} onChange={(e) => setTargetSec(Number(e.target.value))}>
                {LENGTHS.map((s) => (
                  <option key={s} value={s}>
                    {durationLabel(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Model video">
            {(id) => (
              <Select id={id} value={engine} onChange={(e) => setEngine(e.target.value)}>
                <option value="seedance" disabled={!gate.seedance}>
                  Seedance 2.0{gate.seedance ? "" : " (thiếu key Fal)"}
                </option>
                <option value="veo" disabled={!gate.veo}>
                  Veo 3.1
                  {gate.veoFlow
                    ? ` (Google Flow${gate.veo ? "" : " – chưa đăng nhập"})`
                    : gate.veo
                      ? ""
                      : " (thiếu key Gemini)"}
                </option>
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
