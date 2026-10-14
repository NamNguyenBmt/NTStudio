import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call, useApiQuery, useApiMutation } from "../../lib/api";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Clapperboard, Plus, RotateCcwClock, Trash } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { confirmDialog } from "../../components/ui/confirm";
import { Select } from "../../components/ui/Input";
import { toast } from "../../components/ui/toast";
import { useUiStore } from "../../stores/ui";
import { PreviewPanel } from "./PreviewPanel";
import { isLongForm, durationLabel } from "../../../../shared/video";
import { RefsContext } from "./refs";
import { ConfigPanel } from "./ConfigPanel";
import { pickClips } from "./MediaSourceField";
import { Storyboard } from "./Storyboard";
import { RenderHistory } from "./RenderHistory";
import { RenderConfirmDialog } from "./RenderConfirmDialog";
import { ActBoard } from "./ActBoard";
import { PromptExportDialog } from "./PromptExportDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { SceneProgressPanel } from "./SceneProgressPanel";

const sceneToDraft = (s) => ({
  key: s.id,
  label: s.label ?? "",
  voiceover: s.voiceover,
  durationSec: s.durationSec,
  mediaPrompt: s.mediaPrompt ?? "",
  speakerId: s.speakerId,
  voiceId: s.voiceId,
  act: s.act,
  mediaPath: s.mediaPath,
  mediaMode: s.mediaMode,
  startImage: s.startImage,
  endImage: s.endImage,
  sceneRefs: s.sceneRefs,
  searchQuery: s.searchQuery
});

const toDrafts = (p) => p.scenes.map(sceneToDraft);

export function StudioPage() {
  const navigate = useNavigate();
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const { data: projects = [] } = useApiQuery("studio.projects", { workspaceId });
  const { data: channels = [] } = useApiQuery("channels.list", { workspaceId });
  const { data: providers = [] } = useApiQuery("ai.providers");
  const [params] = useSearchParams();
  const linkedProject = params.get("project");
  const [projectId, setProjectId] = useState(linkedProject);
  const [streaming, setStreaming] = useState(false);
  const { data: project } = useApiQuery("studio.get", { id: projectId ?? "" }, { enabled: projectId != null, refetchInterval: streaming ? 2500 : false });
  const updateProject = useApiMutation("studio.update", ["studio."]);
  const createProject = useApiMutation("studio.create", ["studio."]);
  const deleteProject = useApiMutation("studio.delete", ["studio."]);
  const toContent = useApiMutation("studio.toContent", ["studio.", "content.", "workspaces."]);
  const generate = useApiMutation("studio.generateScript", ["studio.", "settings.", "dashboard."]);
  const writeActM = useApiMutation("studio.writeAct", ["studio.", "settings.", "dashboard."]);
  const [writingAct, setWritingAct] = useState(null);
  const [lastGen, setLastGen] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [saveState, setSaveState] = useState("saved");
  const [activeScene, setActiveScene] = useState(0);
  const saveTimer = useRef();
  const loadedFor = useRef(null);
  useEffect(() => {
    if (projectId && projectId === linkedProject) return;
    if (!projects.some((p) => p.id === projectId)) setProjectId(projects[0]?.id ?? null);
  }, [projects, projectId]);
  useEffect(() => {
    if (project && streaming) {
      setScenes(toDrafts(project));
      return;
    }
    if (project && loadedFor.current !== project.id) {
      loadedFor.current = project.id;
      setScenes(toDrafts(project));
      setSaveState("saved");
      setActiveScene(0);
    }
  }, [project]);
  const qcEarly = useQueryClient();
  const qcRef = useRef(qcEarly);
  const persistScenes = useCallback(async (pid, list) => {
    setSaveState("saving");
    try {
      await call("studio.saveScenes", {
        projectId: pid,
        scenes: list.map((s) => ({
          label: s.label || null,
          voiceover: s.voiceover,
          durationSec: s.durationSec,
          mediaPrompt: s.mediaPrompt || null,
          mediaSource: "stock",
          speakerId: s.speakerId ?? null,
          voiceId: s.voiceId ?? null,
          act: s.act ?? 0,
          mediaMode: s.mediaMode ?? "auto",
          mediaPath: s.mediaMode === "upload" ? s.mediaPath ?? null : null,
          startImage: s.startImage ?? null,
          endImage: s.endImage ?? null,
          sceneRefs: s.sceneRefs ?? null,
          searchQuery: s.searchQuery?.trim() || null
        }))
      });
      setSaveState("saved");
      void qcRef.current.invalidateQueries({ queryKey: ["render.estimate"] });
    } catch {
      setSaveState("error");
    }
  }, []);
  const changeScenes = (list) => {
    setScenes(list);
    if (!projectId) return;
    setSaveState("dirty");
    clearTimeout(saveTimer.current);
    const pid = projectId;
    saveTimer.current = setTimeout(() => void persistScenes(pid, list), 700);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  const patch = (p) => {
    if (project) updateProject.mutate({ id: project.id, patch: p }, { onSuccess: () => void qcRef.current.invalidateQueries({ queryKey: ["render.estimate"] }) });
  };
  const [exportAct, setExportAct] = useState(void 0);
  const openExport = async (act) => {
    if (!project) return;
    clearTimeout(saveTimer.current);
    if (saveState !== "saved") await persistScenes(project.id, scenes);
    void qcRef.current.invalidateQueries({ queryKey: ["studio.promptExport"] });
    setExportAct(act);
  };
  const attachClips = async (act) => {
    const clips = await pickClips(true);
    if (!clips.length) return;
    const idx = scenes.map((s, i) => ({ s, i })).filter((x) => (x.s.act ?? 0) === act);
    const byIndex = new Map(idx.slice(0, clips.length).map((x, k) => [x.i, clips[k]]));
    changeScenes(scenes.map((s, i) => byIndex.has(i) ? { ...s, mediaMode: "upload", mediaPath: byIndex.get(i).path } : s));
    toast.success(`Đã gắn ${byIndex.size} clip vào hồi ${act + 1}${clips.length > idx.length ? ` – thừa ${clips.length - idx.length} file (hồi chỉ có ${idx.length} cảnh)` : ""}`);
  };
  const [newOpen, setNewOpen] = useState(false);
  const newProject = () => setNewOpen(true);
  const runGenerate = async () => {
    if (!project || generate.isPending) return;
    document.activeElement?.blur();
    const hasText = scenes.some((s) => s.voiceover.trim());
    const long = isLongForm(project.targetDurationSec);
    if (hasText && !await confirmDialog({
      title: "Sinh kịch bản mới",
      message: long ? `Kịch bản mới sẽ thay thế toàn bộ phân cảnh hiện có. AI viết dàn ý rồi viết lần lượt từng hồi (${durationLabel(project.targetDurationSec)} – có thể mất vài phút). Tiếp tục?` : "Kịch bản mới sẽ thay thế toàn bộ phân cảnh hiện có. Tiếp tục?",
      confirmLabel: "Sinh kịch bản"
    }))
      return;
    clearTimeout(saveTimer.current);
    setStreaming(long);
    generate.mutate(
      { id: project.id },
      {
        onSuccess: ({ scenes: list, meta }) => {
          setScenes(list.map(sceneToDraft));
          setSaveState("saved");
          setActiveScene(0);
          const cost = meta.costUsd != null ? `$${meta.costUsd.toFixed(4)}` : "chưa có đơn giá";
          setLastGen(`Sinh bởi ${meta.provider} (${meta.model}) · ${cost}`);
          toast.success(`Đã sinh ${list.length} phân cảnh`);
        },
        onError: (e) => toast.error(e.message),
        onSettled: () => {
          setStreaming(false);
          loadedFor.current = null;
          void qc.invalidateQueries({ queryKey: ["studio.get"] });
        }
      }
    );
  };
  const runWriteAct = async (act) => {
    if (!project || writingAct != null) return;
    const has = scenes.some((s) => (s.act ?? 0) === act && s.voiceover.trim());
    if (has && !await confirmDialog({
      title: `Viết lại hồi ${act + 1}`,
      message: "AI sẽ viết lại toàn bộ cảnh của hồi này theo dàn ý (các hồi khác giữ nguyên). Tiếp tục?",
      confirmLabel: "Viết lại"
    }))
      return;
    clearTimeout(saveTimer.current);
    if (saveState !== "saved") await persistScenes(project.id, scenes);
    setWritingAct(act);
    writeActM.mutate(
      { projectId: project.id, act },
      {
        onSuccess: ({ scenes: list, meta }) => {
          setScenes(list.map(sceneToDraft));
          setSaveState("saved");
          const first = list.findIndex((s) => s.act === act);
          if (first >= 0) setActiveScene(first);
          const cost = meta.costUsd != null ? `$${meta.costUsd.toFixed(4)}` : "chưa có đơn giá";
          toast.success(`Đã viết hồi ${act + 1} · ${list.filter((s) => s.act === act).length} cảnh · ${cost}`);
        },
        onError: (e) => toast.error(e.message),
        onSettled: () => setWritingAct(null)
      }
    );
  };
  const { data: jobs = [] } = useApiQuery(
    "render.jobs",
    { projectId: projectId ?? void 0, limit: 20 },
    {
      enabled: projectId != null,
      // Poll khi có job đang chờ/chạy
      refetchInterval: (q) => q.state.data?.some((j) => j.status === "queued" || j.status === "running") ? 1e3 : false
    }
  );
  const latestJob = jobs[0] ?? null;
  const startRender = useApiMutation("render.start", ["render.", "media."]);
  const cancelRender = useApiMutation("render.cancel", ["render.", "media."]);
  const qc = useQueryClient();
  const prevStatus = useRef(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  useEffect(() => {
    const st = latestJob?.status ?? null;
    if (prevStatus.current === "running" && st && st !== "running") {
      const prefixes = ["studio.", "content.", "dashboard.", "workspaces.", "settings.", "alerts."];
      void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && prefixes.some((pre) => q.queryKey[0].startsWith(pre)) });
      if (st === "done") toast.success(`Render xong: ${latestJob.projectTopic.slice(0, 50)}`);
      else if (st === "failed") toast.error(`Render lỗi: ${latestJob.error ?? ""}`);
    }
    prevStatus.current = st;
  }, [latestJob?.status, latestJob, qc]);
  const runRender = async () => {
    if (!project || startRender.isPending) return;
    clearTimeout(saveTimer.current);
    if (saveState !== "saved") await persistScenes(project.id, scenes);
    let est = null;
    try {
      est = await call("render.estimate", { projectId: project.id });
    } catch {
    }
    setConfirm({ estimate: est });
  };
  const confirmRender = () => {
    setConfirm(null);
    if (!project) return;
    startRender.mutate({ projectId: project.id }, { onSuccess: () => toast.info("Đã đưa vào hàng đợi render"), onError: (e) => toast.error(e.message) });
  };
  useEffect(() => {
    const onKey = (e) => {
      if (newOpen || confirm) return;
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void runGenerate();
      } else if (e.key === "F9") {
        e.preventDefault();
        if (!latestJob || latestJob.status !== "queued" && latestJob.status !== "running") void runRender();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const channel = channels.find((c) => c.id === project?.targetChannelId);
  const ttsProviders = providers.filter((p) => p.category === "tts" && p.enabled);
  return <div className="flex h-[calc(100vh-2.5rem-1.75rem-1.5rem)] min-h-[640px] flex-col gap-space-md">
    <Card className="flex flex-wrap items-center justify-between gap-space-md p-space-sm pl-space-md">
      <div className="flex items-center gap-space-md">
        <Clapperboard size={22} className="text-secondary" />
        <h1 className="text-headline-md text-on-surface">AI Video Generator Studio</h1>
        <Badge tone="secondary" mono={true}>PIPELINE 3 CỘT</Badge>
      </div>
      <div className="flex items-center gap-space-sm">
        <div className="w-72">
          <Select aria-label="Chọn dự án" value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)}>
            {projects.length === 0 && <option value="">Chưa có dự án</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>
              {p.topic.slice(0, 48)}
              {p.topic.length > 48 ? "…" : ""}
              {" · "}
              {p.sceneCount}
              {" cảnh"}
            </option>)}
          </Select>
        </div>
        <Button variant="primary" onClick={newProject} disabled={createProject.isPending}>
          <Plus size={15} />
          {" Dự án mới"}
        </Button>
        {project && <Button
          variant="subtle"
          aria-label="Xóa dự án"
          onClick={() => void confirmDialog({ title: "Xóa dự án", message: `Xóa dự án "${project.topic}" và toàn bộ phân cảnh?`, confirmLabel: "Xóa", danger: true }).then(
            (ok) => ok && deleteProject.mutate({ id: project.id }, { onSuccess: () => setProjectId(null) })
          )}
        >
          <Trash size={15} />
        </Button>}
        <Button onClick={() => setHistoryOpen(true)} disabled={!project}>
          <RotateCcwClock size={15} />
          {" Lịch sử render"}
          {jobs.length ? ` (${jobs.length})` : ""}
        </Button>
      </div>
    </Card>
    {!project ? <Card className="flex flex-1 flex-col items-center justify-center gap-space-md text-body-md text-on-surface-variant">
      {projects.length === 0 ? "Chưa có dự án video nào trong Pocket này." : "Đang tải dự án…"}
      {projects.length === 0 && <Button variant="primary" onClick={newProject}><Plus size={15} />{" Tạo dự án đầu tiên"}</Button>}
    </Card> : <RefsContext.Provider value={{ projectRefs: project.referenceImages, characterRefs: project.characterRefs }}>
      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_320px] gap-space-md">
        <ConfigPanel
          project={project}
          channels={channels}
          ttsProviders={ttsProviders}
          onChange={patch}
          onGenerate={() => void runGenerate()}
          generating={generate.isPending}
          lastGen={lastGen}
        />
        <div className={"flex min-h-0 min-w-0 flex-col gap-space-md [&>*:last-child]:min-h-0 [&>*:last-child]:flex-1"}>
          {latestJob?.scenes?.length ? <SceneProgressPanel job={latestJob} labels={scenes.map((s) => s.label)} onFocusScene={setActiveScene} /> : null}
          {isLongForm(project.targetDurationSec) ? <ActBoard
            acts={project.acts ?? []}
            scenes={scenes}
            targetSec={project.targetDurationSec}
            activeIndex={activeScene}
            saveState={saveState}
            generating={generate.isPending}
            writingAct={writingAct}
            onChange={changeScenes}
            onFocusScene={setActiveScene}
            onActsChange={(acts) => patch({ acts })}
            onWriteAct={(i) => void runWriteAct(i)}
            renderMode={project.renderMode}
            onAttachClips={(i) => void attachClips(i)}
            onExportPrompts={(i) => void openExport(i)}
          /> : <Storyboard
            scenes={scenes}
            targetSec={project.targetDurationSec}
            renderMode={project.renderMode}
            narration={project.narration}
            activeIndex={activeScene}
            saveState={saveState}
            onChange={changeScenes}
            onFocusScene={setActiveScene}
          />}
        </div>
        <PreviewPanel
          project={project}
          scenes={scenes}
          activeIndex={activeScene}
          channelHandle={channel?.handle ?? null}
          onPatch={patch}
          onFocusScene={setActiveScene}
          contentLinked={project.contentItemId != null}
          toContentPending={toContent.isPending}
          onToContent={async () => {
            if (latestJob?.status === "done") return navigate("/content");
            clearTimeout(saveTimer.current);
            await persistScenes(project.id, scenes);
            toContent.mutate({ id: project.id }, { onSuccess: () => navigate("/content") });
          }}
          latestJob={latestJob}
          onRender={() => void runRender()}
          onCancelRender={(id) => cancelRender.mutate({ id })}
          renderPending={startRender.isPending}
          onExportPrompts={() => void openExport(null)}
        />
      </div>
    </RefsContext.Provider>}
    {project && <PromptExportDialog projectId={project.id} open={exportAct !== void 0} initialAct={exportAct ?? null} onClose={() => setExportAct(void 0)} />}
    <RenderHistory open={historyOpen} onClose={() => setHistoryOpen(false)} jobs={jobs} onCancel={(id) => cancelRender.mutate({ id })} />
    {project && <RenderConfirmDialog
      open={!!confirm}
      project={project}
      sceneCount={scenes.length}
      totalSec={scenes.reduce((t, sc) => t + sc.durationSec, 0)}
      channelName={channel?.name ?? null}
      ttsLabel={providers.find((p) => p.provider === project.ttsProvider)?.label ?? project.ttsProvider}
      estimate={confirm?.estimate ?? null}
      onConfirm={confirmRender}
      onCancel={() => setConfirm(null)}
    />}
    <NewProjectDialog
      open={newOpen}
      workspaceId={workspaceId}
      onClose={() => setNewOpen(false)}
      onCreated={(id) => {
        setProjectId(id);
        setNewOpen(false);
      }}
    />
  </div>;
}
