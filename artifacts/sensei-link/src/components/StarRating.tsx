import { Star } from "lucide-react";

interface StarRatingProps {
  value: number;
  max?: number;
  size?: number;
  interactive?: boolean;
  onChange?: (value: number) => void;
}

export function StarRating({ value, max = 5, size = 16, interactive, onChange }: StarRatingProps) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }, (_, i) => {
        const filled = i < value;
        return (
          <Star
            key={i}
            size={size}
            className={`transition-colors ${
              filled ? "text-yellow-400 fill-yellow-400" : "text-gray-200 fill-gray-200"
            } ${interactive ? "cursor-pointer hover:text-yellow-400 hover:fill-yellow-400" : ""}`}
            onClick={() => interactive && onChange?.(i + 1)}
          />
        );
      })}
    </div>
  );
}
