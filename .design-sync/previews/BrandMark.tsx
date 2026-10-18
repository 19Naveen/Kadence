import { BrandMark } from "kadence";

export const Sizes = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 32, padding: 24 }}>
    <BrandMark size="sm" />
    <BrandMark size="md" />
    <BrandMark size="lg" />
  </div>
);
