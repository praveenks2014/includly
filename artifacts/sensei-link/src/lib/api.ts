const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

export function getApiBase(): string {
  const host = window.location.origin;
  return `${host}${BASE_URL}/api`;
}

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "include",
  });
}
