const BASE_URL = import.meta.env.VITE_APPS_SCRIPT_URL;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, params, body) {
  if (!BASE_URL) throw new ApiError("VITE_APPS_SCRIPT_URL is not set in .env", 0);

  const url = new URL(BASE_URL);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method,
    headers: body ? { "Content-Type": "text/plain;charset=utf-8" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "follow",
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`Bad response from server (HTTP ${res.status})`, res.status);
  }

  if (!res.ok || data?.error) {
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  }
  return data;
}

export function listMedicines() {
  return request("GET", { action: "list" });
}

export function replaceMedicines(medicines) {
  return request("POST", null, { action: "replace", medicines });
}
