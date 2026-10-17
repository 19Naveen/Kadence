interface BrandMarkProps {
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: { tile: "size-7 text-sm", word: "text-[17px]" },
  md: { tile: "size-8 text-base", word: "text-lg" },
  lg: { tile: "size-10 text-lg", word: "text-2xl" },
};

/** Same mark as the app shell: teal square with a white "K" plus the wordmark. */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const s = sizes[size];
  return (
    <div className="flex items-center gap-2.5">
      <span className={`flex items-center justify-center rounded-lg bg-primary font-heading font-bold text-white ${s.tile}`} aria-hidden="true">
        K
      </span>
      <span className={`font-heading font-semibold tracking-tight text-text ${s.word}`}>Kadence</span>
    </div>
  );
}
