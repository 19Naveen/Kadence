interface BrandMarkProps {
  size?: "sm" | "md" | "lg";
  inverted?: boolean;
}

export function BrandMark({ size = "md", inverted = false }: BrandMarkProps) {
  const sizes = {
    sm: { tile: "h-7 w-7 rounded-lg text-xs", text: "text-sm" },
    md: { tile: "h-8 w-8 rounded-xl text-sm", text: "text-base" },
    lg: { tile: "h-10 w-10 rounded-xl text-base", text: "text-xl" },
  };

  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex items-center justify-center ${sizes[size].tile} ${
          inverted
            ? "bg-white text-primary"
            : "bg-primary text-white shadow-lg shadow-primary/20"
        }`}
      >
        <span className="font-bold">K</span>
      </div>
      <span
        className={`font-bold tracking-tight ${sizes[size].text} ${
          inverted ? "text-white" : "text"
        }`}
      >
        Kadence
      </span>
    </div>
  );
}
