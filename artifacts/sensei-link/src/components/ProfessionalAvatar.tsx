/**
 * Shared photo-or-initials avatar for professional cards — matches the
 * teal-circle treatment already established on professional-profile.tsx's
 * header, reused here so candidate cards get a real visual anchor instead
 * of a name-only text row.
 */
import { useState } from "react";

function initials(name?: string | null): string {
  if (!name) return "?";
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export function avatarSrc(avatarUrl?: string | null): string | null {
  if (!avatarUrl) return null;
  return `/api/storage/avatars/${avatarUrl.replace(/^\/objects\//, "")}`;
}

const SIZES = {
  sm: "w-12 h-12 text-base",
  md: "w-16 h-16 text-lg",
  lg: "w-24 h-24 sm:w-28 sm:h-28 text-2xl sm:text-3xl",
} as const;

export function ProfessionalAvatar({
  avatarUrl,
  fullName,
  size = "md",
  className = "",
}: {
  avatarUrl?: string | null;
  fullName?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = avatarSrc(avatarUrl);

  return (
    <div
      className={`rounded-full bg-[#2EC4A5] border-2 border-white shadow-md flex items-center justify-center shrink-0 overflow-hidden ${SIZES[size]} ${className}`}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={fullName ?? "Profile photo"}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-white font-bold font-serif">{initials(fullName)}</span>
      )}
    </div>
  );
}
