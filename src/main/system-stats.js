import os from "node:os";
import { app } from "electron";

function sampleCpu() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { idle, total };
}

export function startSystemStats(emit, intervalMs = 2e3) {
  let prev = sampleCpu();
  const tick = () => {
    const cur = sampleCpu();
    const totalDiff = cur.total - prev.total;
    const cpu = totalDiff > 0 ? (1 - (cur.idle - prev.idle) / totalDiff) * 100 : 0;
    prev = cur;
    const appMemoryKb = app.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0);
    emit({
      cpu: Math.round(cpu * 10) / 10,
      appMemoryMb: Math.round(appMemoryKb / 1024),
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
    });
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(timer);
}
