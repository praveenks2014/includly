---
name: WebGL detection in Replit sandbox
description: Replit's preview iframe has no GPU/WebGL — Three.js constructor throws synchronously before React ErrorBoundary can catch it; must detect WebGL before Canvas mounts
---

## Rule
Never render `<Canvas>` from `@react-three/fiber` without first checking WebGL availability client-side via `useEffect`.

## Why
Replit's screenshot/sandbox environment has no GPU. `THREE.WebGLRenderer` throws synchronously in its constructor (`Error creating WebGL context`). Vite's `plugin:runtime-error-plugin` intercepts this *before* React's ErrorBoundary runs, causing the error overlay to appear on every page load. A class ErrorBoundary alone does NOT prevent this.

## How to apply
In the 3D component itself, gate the `<Canvas>` behind a `useState<boolean | null>` initialized to `null`:

```tsx
const [webglOk, setWebglOk] = useState<boolean | null>(null);

useEffect(() => {
  try {
    const c = document.createElement("canvas");
    setWebglOk(!!(c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch {
    setWebglOk(false);
  }
}, []);

if (!webglOk) return null;   // null = loading OR not supported → no Canvas
return <Canvas ...>...</Canvas>;
```

This prevents Three.js from ever instantiating a WebGLRenderer in unsupported environments. Add an `Orb3DBoundary` (class ErrorBoundary) as a secondary safety net in the parent.
