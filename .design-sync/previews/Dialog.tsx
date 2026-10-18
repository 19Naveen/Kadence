import { Dialog } from "kadence";

export const FormDialog = () => (
  <Dialog
    open
    onClose={() => {}}
    title="Save"
    description="Runs 3 steps on the full orders dataset in the background."
    footer={
      <>
        <button className="btn btn-ghost">Cancel</button>
        <button className="btn btn-primary">Save</button>
      </>
    }
  >
    <fieldset className="space-y-1">
      <legend className="field-label">Save as</legend>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-surface-2">
        <input type="radio" name="save-as" defaultChecked className="mt-0.5 accent-primary" />
        <span>
          <span className="block text-[13px] font-medium">New version of orders</span>
          <span className="block text-xs text-text-secondary">Earlier versions stay available.</span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-surface-2">
        <input type="radio" name="save-as" className="mt-0.5 accent-primary" />
        <span>
          <span className="block text-[13px] font-medium">New dataset</span>
          <span className="block text-xs text-text-secondary">Leaves the original untouched.</span>
        </span>
      </label>
    </fieldset>
    <label className="mt-3 block">
      <span className="field-label">Dataset name</span>
      <input className="input" defaultValue="orders_shaped" />
    </label>
  </Dialog>
);

export const Confirmation = () => (
  <Dialog
    open
    size="sm"
    onClose={() => {}}
    title="Delete customers?"
    footer={
      <>
        <button className="btn btn-ghost">Cancel</button>
        <button className="btn btn-danger">Delete dataset</button>
      </>
    }
  >
    <p className="text-[13px] text-text-secondary">All versions and stored files are removed. This can't be undone.</p>
  </Dialog>
);
