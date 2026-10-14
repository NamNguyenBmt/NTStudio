import { Button } from "./Button";
import "./Card";
import { create } from "zustand";
import { Dialog } from "./Dialog";

const useConfirmStore = create((set) => ({
  req: null,
  set: (req) => set({ req })
}));

export function confirmDialog(opts) {
  return new Promise((resolve) => {
    useConfirmStore.getState().req?.resolve(false);
    useConfirmStore.getState().set({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const req = useConfirmStore((s) => s.req);
  const set = useConfirmStore((s) => s.set);
  const close = (ok) => {
    req?.resolve(ok);
    set(null);
  };
  return <Dialog
    open={req != null}
    onClose={() => close(false)}
    title={req?.title ?? ""}
    width={420}
    footer={<>
      <Button variant="subtle" onClick={() => close(false)}>Hủy</Button>
      <Button variant={req?.danger ? "danger" : "primary"} onClick={() => close(true)}>
        {req?.confirmLabel ?? "Đồng ý"}
      </Button>
    </>}
  >
    <p className="whitespace-pre-line text-body-md text-on-surface-variant">{req?.message}</p>
  </Dialog>;
}
