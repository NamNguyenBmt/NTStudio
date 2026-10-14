import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../lib/api";
import { toast } from "../../components/ui/toast";

export function useCharacterBatch() {
  const qc = useQueryClient();
  const [jobs, setJobs] = useState({});
  const queue = useRef([]);
  const active = useRef(0);
  const order = useRef(0);
  const failed = useRef([]);
  const patch = (id, p) => setJobs((j) => ({ ...j, [id]: { ...j[id], ...p } }));
  const worker = async (names) => {
    active.current++;
    try {
      for (;;) {
        const id = queue.current.shift();
        if (!id) break;
        patch(id, { status: "running", startedAt: Date.now() });
        try {
          await call("series.characterImage", { id });
          patch(id, { status: "done" });
          void qc.invalidateQueries({
            predicate: (q) => typeof q.queryKey[0] === "string" && /^(series|film)\./.test(q.queryKey[0]),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          patch(id, { status: "failed", error: msg });
          failed.current.push(`${names[id] ?? "Nhân vật"}: ${msg}`);
        }
      }
    } finally {
      active.current--;
      if (active.current === 0 && failed.current.length) {
        toast.error(`${failed.current.length} ảnh lỗi – ${failed.current[0]}`);
        failed.current = [];
      }
    }
  };
  const start = (ids, concurrency, names) => {
    const fresh = ids.filter((id) => !queue.current.includes(id) && jobs[id]?.status !== "running");
    if (!fresh.length) return;
    queue.current.push(...fresh);
    setJobs((j) => {
      const next = { ...j };
      for (const id of fresh) next[id] = { status: "queued", order: order.current++ };
      return next;
    });
    const spawn = Math.max(0, Math.min(concurrency - active.current, queue.current.length));
    for (let i = 0; i < spawn; i++) void worker(names);
  };
  const busy = Object.values(jobs).some((j) => j.status === "queued" || j.status === "running");
  return { jobs, start, busy };
}
