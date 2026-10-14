import { cn } from "../../lib/cn";
import { Select } from "../../components/ui/Input";
import { providerInfo } from "../../../../shared/providers";

export function ModelSelect({ provider, onChange }) {
  const known = providerInfo(provider.provider).models;
  const label = (id) => known.find((k) => k.id === id)?.label ?? id;
  const models = provider.liveModels.length ? provider.liveModels.map((id) => ({ id, label: label(id) })) : known;
  const value = provider.defaultModel ?? models[0]?.id ?? "";
  const missing = value && !models.some((m) => m.id === value);
  return (
    <Select
      aria-label={`Model ${provider.label}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(missing && "text-error")}
    >
      {missing && (
        <option value={value}>
          {label(value)}
          {" (không còn khả dụng)"}
        </option>
      )}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </Select>
  );
}
