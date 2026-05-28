import { createRoot } from "react-dom/client";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { setFetchAuthTokenGetter } from "@/lib/api";
import App from "./App";
import "./index.css";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
setBaseUrl(`${window.location.origin}${basePath}/api`);

// Register the Clerk token getter BEFORE React mounts so there is no race
// condition between React Query's first fetch and ClerkAuthBridge's useEffect.
// window.Clerk is set by @clerk/react after Clerk initialises; by the time
// the user is signed-in and pages start fetching, it is always available.
const clerkTokenGetter = async (): Promise<string | null> => {
  const clerk = (window as unknown as { Clerk?: { session?: { getToken: () => Promise<string | null> } } }).Clerk;
  return (await clerk?.session?.getToken?.()) ?? null;
};
setAuthTokenGetter(clerkTokenGetter);
setFetchAuthTokenGetter(clerkTokenGetter);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${basePath}/sw.js`).catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(<App />);
