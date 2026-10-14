import { useState } from "react";
import { useApiQuery, useApiMutation } from "../../lib/api";
import { Plus, RotateCcw, Tag, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";

function PriceRow({ model, input, output, custom, onSave, onReset }) {
  const [i, setI] = useState(String(input));
  const [o, setO] = useState(String(output));
  const ni = Number(i);
  const no = Number(o);
  const valid = i !== "" && o !== "" && Number.isFinite(ni) && Number.isFinite(no) && ni >= 0 && no >= 0;
  const dirty = ni !== input || no !== output;
  return (
    <li className="grid grid-cols-[1fr_64px_64px_auto] items-center gap-1">
      <span
        className={cn("truncate font-mono text-code", custom ? "text-secondary" : "text-on-surface")}
        title={custom ? "Đơn giá tùy chỉnh" : "Đơn giá mặc định"}
      >
        {model}
      </span>
      <Input
        value={i}
        onChange={(e) => setI(e.target.value)}
        inputMode="decimal"
        className="h-7 text-right font-mono text-code"
        aria-label={`Giá input ${model}`}
      />
      <Input
        value={o}
        onChange={(e) => setO(e.target.value)}
        inputMode="decimal"
        className="h-7 text-right font-mono text-code"
        aria-label={`Giá output ${model}`}
      />
      <span className="flex w-14 justify-end">
        {dirty && valid ? (
          <Button size="sm" variant="primary" onClick={() => onSave(ni, no)}>
            Lưu
          </Button>
        ) : custom && onReset ? (
          <IconButton icon={RotateCcw} label="Về giá mặc định" onClick={onReset} />
        ) : null}
      </span>
    </li>
  );
}

export function PricingCard() {
  const { data } = useApiQuery("ai.pricing");
  const setPrice = useApiMutation("ai.setPrice", ["ai.", "settings."]);
  const [newModel, setNewModel] = useState("");
  if (!data) return <Card className="h-40 animate-pulse" />;
  const models = [...new Set([...Object.keys(data.defaults), ...Object.keys(data.overrides)])];
  return (
    <Card className="flex flex-col gap-space-sm p-space-md">
      <h3 className="flex items-center gap-space-sm text-label-md text-on-surface">
        <Tag size={15} className="text-secondary" />
        {" Đơn giá model (USD / 1M token)"}
      </h3>
      {data.unpricedModels.length > 0 && (
        <p className="flex items-start gap-1 rounded-lg bg-warning/10 p-space-sm text-label-sm text-warning">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          {" Chưa có đơn giá – chi phí đang ghi $0: "}
          {data.unpricedModels.join(", ")}
        </p>
      )}
      <div className="grid grid-cols-[1fr_64px_64px_auto] gap-1 text-label-sm text-outline">
        <span>Model</span>
        <span className="text-right">Input</span>
        <span className="text-right">Output</span>
        <span className="w-14" />
      </div>
      <ul className="flex flex-col gap-1">
        {[...data.unpricedModels, ...models.filter((m) => !data.unpricedModels.includes(m))].map((m) => {
          const p = data.overrides[m] ?? data.defaults[m] ?? { input: 0, output: 0 };
          return (
            <PriceRow
              key={`${m}-${p.input}-${p.output}`}
              model={m}
              input={p.input}
              output={p.output}
              custom={m in data.overrides}
              onSave={(input, output) => setPrice.mutate({ model: m, price: { input, output } })}
              onReset={m in data.defaults ? () => setPrice.mutate({ model: m, price: null }) : void 0}
            />
          );
        })}
      </ul>
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (newModel.trim())
            setPrice.mutate(
              { model: newModel.trim(), price: { input: 0, output: 0 } },
              { onSuccess: () => setNewModel("") },
            );
        }}
      >
        <Input
          value={newModel}
          onChange={(e) => setNewModel(e.target.value)}
          placeholder="Thêm model khác…"
          className="h-7 font-mono text-code"
          aria-label="Tên model"
        />
        <Button size="sm" type="submit" variant="subtle" disabled={!newModel.trim()}>
          <Plus size={12} />
        </Button>
      </form>
      <p className="text-label-sm text-outline">
        Giá Claude theo bảng Anthropic (09/2026); OpenAI, DeepSeek, Gemini tra cứu 10/2026 – nhà cung cấp có thể đổi
        giá.
      </p>
    </Card>
  );
}
