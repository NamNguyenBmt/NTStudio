export function PageHeader({
  icon: Icon,
  title,
  description,
  status,
  actions
}) {
  return <div className="flex flex-wrap items-center justify-between gap-space-md rounded-xl bg-surface-container-low p-space-md">
    <div className="flex min-w-0 items-center gap-space-md">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary">
        <Icon size={22} strokeWidth={1.75} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-space-sm">
          <h1 className="truncate text-headline-md text-on-surface">{title}</h1>
          {status}
        </div>
        {description && <p className="text-body-sm text-on-surface-variant">{description}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-space-sm">{actions}</div>}
  </div>;
}
