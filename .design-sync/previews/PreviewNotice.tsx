import { PreviewNotice } from "kadence";

export const Default = () => (
  <div style={{ width: 760, padding: 24 }}>
    <PreviewNotice />
  </div>
);

export const CustomText = () => (
  <div style={{ width: 760, padding: 24 }}>
    <PreviewNotice>Predictions are simulated from sample models. Nothing here is sent to a model service.</PreviewNotice>
  </div>
);
