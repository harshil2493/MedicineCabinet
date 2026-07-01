const BASE_URL = import.meta.env.VITE_APPS_SCRIPT_URL;
const PW_KEY = "cabinet_pw";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function getPassword() {
  return sessionStorage.getItem(PW_KEY) || "";
}

export function setPassword(pw) {
  if (pw) sessionStorage.setItem(PW_KEY, pw);
  else sessionStorage.removeItem(PW_KEY);
}

async function post(action, extra) {
  if (!BASE_URL) throw new ApiError("VITE_APPS_SCRIPT_URL is not set", 0);
  const password = getPassword();
  if (!password) throw new ApiError("Unauthorized", 401);

  const res = await fetch(BASE_URL, {
    method: "POST",
    // text/plain avoids a CORS preflight (Apps Script Web Apps don't answer OPTIONS)
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, password, ...extra }),
    redirect: "follow",
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`Bad response from server (HTTP ${res.status})`, res.status);
  }

  if (data?.error === "Unauthorized") {
    setPassword("");
    throw new ApiError("Wrong password", 401);
  }
  if (!res.ok || data?.error) {
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  }
  return data;
}

export function listMedicines() {
  return post("list");
}

export function replaceMedicines(medicines) {
  return post("replace", { medicines });
}
