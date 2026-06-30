import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

const STEPS = ["Role", "About", "Languages", "Location", "Pricing"];

const CARDS = [
  {
    value: "shadow_teacher",
    emoji: "🧑‍🏫",
    title: "Shadow Teacher",
    desc: "I support children with special needs inside school, helping them participate in mainstream classrooms.",
    selectedBg: "#F0FDFB",
    selectedBorder: "#0D9488",
    selectedRing: "rgba(13,148,136,0.18)",
    iconBg: "#CCFBF1",
  },
  {
    value: "home_tutor",
    emoji: "📚",
    title: "Home Tutor",
    desc: "I teach academic subjects to children with learning differences at home, at their pace.",
    selectedBg: "#EFF6FF",
    selectedBorder: "#3B82F6",
    selectedRing: "rgba(59,130,246,0.18)",
    iconBg: "#DBEAFE",
  },
  {
    value: "therapist",
    emoji: "🩺",
    title: "Therapist / Special Educator",
    desc: "I provide speech, OT, behavioural (ABA), or special education therapy. RCI registration required.",
    selectedBg: "#F5F3FF",
    selectedBorder: "#7C3AED",
    selectedRing: "rgba(124,58,237,0.18)",
    iconBg: "#EDE9FE",
  },
];

export function RolePicker() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(160deg, #F4FAF9 0%, #FFFFFF 60%)",
        fontFamily: "'Inter', system-ui, sans-serif",
        overflow: "hidden",
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px 10px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 13,
            color: "#9CA3AF",
            fontWeight: 500,
            cursor: "default",
            userSelect: "none",
          }}
        >
          ← Back
        </span>

        <span
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: 19,
            fontWeight: 700,
            color: "#0D9488",
            letterSpacing: "-0.02em",
          }}
        >
          includly
        </span>

        <span style={{ width: 52 }} />
      </div>

      {/* Progress bar */}
      <div style={{ padding: "0 20px 16px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 5 }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 999,
                background: i === 0 ? "#0D9488" : "#E5E7EB",
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {STEPS.map((label, i) => (
            <span
              key={i}
              style={{
                fontSize: 10,
                fontWeight: i === 0 ? 600 : 400,
                color: i === 0 ? "#0D9488" : "#9CA3AF",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Step header */}
      <div style={{ padding: "0 20px 18px", flexShrink: 0 }}>
        <h1
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: 24,
            fontWeight: 700,
            color: "#111827",
            margin: 0,
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
          }}
        >
          What brings you here?
        </h1>
        <p
          style={{
            fontSize: 13.5,
            color: "#6B7280",
            margin: "7px 0 0",
            lineHeight: 1.5,
          }}
        >
          Choose the role that best describes your work with children.
        </p>
      </div>

      {/* Scrollable cards */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 20px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {CARDS.map((card) => {
          const isSelected = selected === card.value;
          return (
            <button
              key={card.value}
              onClick={() => setSelected(card.value)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "15px 14px",
                border: `2px solid ${isSelected ? card.selectedBorder : "#E5E7EB"}`,
                borderRadius: 16,
                background: isSelected ? card.selectedBg : "#FFFFFF",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                boxShadow: isSelected
                  ? `0 0 0 4px ${card.selectedRing}`
                  : "0 1px 3px rgba(0,0,0,0.06)",
                transition: "all 0.18s ease",
                position: "relative",
                minHeight: 80,
                outline: "none",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 13,
                  background: isSelected ? card.iconBg : "#F9FAFB",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                  flexShrink: 0,
                  transition: "background 0.18s ease",
                }}
              >
                {card.emoji}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#111827",
                    marginBottom: 4,
                    lineHeight: 1.25,
                  }}
                >
                  {card.title}
                </div>
                <div style={{ fontSize: 12.5, color: "#6B7280", lineHeight: 1.5 }}>
                  {card.desc}
                </div>
              </div>

              {isSelected && (
                <div style={{ position: "absolute", top: 10, right: 10 }}>
                  <CheckCircle2
                    size={20}
                    style={{ color: card.selectedBorder, fill: card.selectedBg }}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Sticky CTA — part of normal flex flow */}
      <div
        style={{
          flexShrink: 0,
          padding: "14px 20px 24px",
          background: "linear-gradient(to top, #fff 80%, rgba(255,255,255,0))",
          borderTop: "1px solid rgba(229,231,235,0.5)",
        }}
      >
        <button
          disabled={!selected}
          style={{
            width: "100%",
            height: 52,
            borderRadius: 14,
            border: "none",
            background: selected ? "#0D9488" : "#E5E7EB",
            color: selected ? "#FFFFFF" : "#9CA3AF",
            fontSize: 16,
            fontWeight: 600,
            cursor: selected ? "pointer" : "not-allowed",
            transition: "all 0.18s ease",
            letterSpacing: "0.01em",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          Continue
          {selected && (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
        </button>
        <p
          style={{
            textAlign: "center",
            fontSize: 11.5,
            color: "#9CA3AF",
            margin: "9px 0 0",
          }}
        >
          Step 1 of 5 · Takes about 3 minutes
        </p>
      </div>
    </div>
  );
}
