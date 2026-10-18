interface BrandMarkProps {
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: { tile: "size-6 text-[13px]", word: "text-[15px]" },
  md: { tile: "size-7 text-sm", word: "text-base" },
  lg: { tile: "size-8 text-base", word: "text-lg" },
};

/** Same mark as the app shell: blue square with a white "K" plus the wordmark. */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const s = sizes[size];
  return (
    <div className="flex items-center gap-2">
      <span className={`flex items-center justify-center rounded-md bg-primary font-semibold text-white ${s.tile}`} aria-hidden="true">
        K
      </span>
      <span className={`font-semibold text-text ${s.word}`}>Kadence</span>
    </div>
  );
}
