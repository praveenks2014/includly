import { useSelectedChild } from "@/contexts/SelectedChildContext";

export function ChildSwitcher() {
  const { childProfiles, selectedChildId, setSelectedChildId } = useSelectedChild();
  if (childProfiles.length <= 1) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto px-3 py-2 bg-white border-b border-border shrink-0">
      {childProfiles.map((child) => {
        const active = child.id === selectedChildId;
        return (
          <button
            key={child.id}
            onClick={() => setSelectedChildId(child.id)}
            className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              active
                ? "bg-teal-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {child.name ?? `Child ${child.id}`}
          </button>
        );
      })}
    </div>
  );
}
