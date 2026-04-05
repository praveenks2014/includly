import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
setBaseUrl(`${window.location.origin}${basePath}`);

createRoot(document.getElementById("root")!).render(<App />);
