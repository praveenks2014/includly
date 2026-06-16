import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useGetMyChildren } from "@workspace/api-client-react";
import type { ChildResponseType } from "@workspace/api-client-react";

export const CHILD_PROFILE_SKIP_KEY = "includly:skipChildProfile";
const STORAGE_KEY = "includly:selectedChildId";

interface SelectedChildContextValue {
  childProfiles: ChildResponseType[];
  childrenLoading: boolean;
  childrenFetching: boolean;
  selectedChildId: number | null;
  selectedChild: ChildResponseType | undefined;
  setSelectedChildId: (id: number) => void;
}

const SelectedChildContext = createContext<SelectedChildContextValue>({
  childProfiles: [],
  childrenLoading: false,
  childrenFetching: false,
  selectedChildId: null,
  selectedChild: undefined,
  setSelectedChildId: () => {},
});

export function SelectedChildProvider({ children }: { children: ReactNode }) {
  const { data: childProfiles = [], isLoading: childrenLoading, isFetching: childrenFetching } = useGetMyChildren();

  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored, 10) : null;
  });

  useEffect(() => {
    if (childrenLoading || childProfiles.length === 0) return;
    const valid = childProfiles.find((c) => c.id === selectedId);
    if (!valid) {
      const first = childProfiles[0];
      if (first) {
        setSelectedId(first.id);
        localStorage.setItem(STORAGE_KEY, String(first.id));
      }
    }
  }, [childProfiles, childrenLoading, selectedId]);

  function setSelectedChildId(id: number) {
    setSelectedId(id);
    localStorage.setItem(STORAGE_KEY, String(id));
  }

  const selectedChild = childProfiles.find((c) => c.id === selectedId);

  return (
    <SelectedChildContext.Provider
      value={{
        childProfiles,
        childrenLoading,
        childrenFetching,
        selectedChildId: selectedId,
        selectedChild,
        setSelectedChildId,
      }}
    >
      {children}
    </SelectedChildContext.Provider>
  );
}

export function useSelectedChild() {
  return useContext(SelectedChildContext);
}
