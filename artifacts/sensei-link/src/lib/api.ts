const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

export function getApiBase(): string {
  const host = window.location.origin;
  return `${host}${BASE_URL}/api`;
}

type TokenGetter = () => Promise<string | null> | string | null;
let _authTokenGetter: TokenGetter | null = null;

export function setFetchAuthTokenGetter(getter: TokenGetter | null): void {
  _authTokenGetter = getter;
}

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const existingHeaders = (options.headers ?? {}) as Record<string, string>;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...existingHeaders,
  };

  if (_authTokenGetter && !headers["Authorization"] && !headers["authorization"]) {
    const token = await _authTokenGetter();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });
}
