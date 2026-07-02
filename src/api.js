const BASE_URL = import.meta.env.VITE_APPS_SCRIPT_URL;
const PW_KEY = "cabinet_pw";
const ROLE_KEY = "cabinet_role";
const USER_KEY = "cabinet_user";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function getPassword() {
  return sessionStorage.getItem(PW_KEY) || "";
}
export function getUsername() {
  return sessionStorage.getItem(USER_KEY) || "";
}
export function getRole() {
  return sessionStorage.getItem(ROLE_KEY) || "";
}

export function setCredentials(username, password) {
  sessionStorage.setItem(USER_KEY, username || "");
  sessionStorage.setItem(PW_KEY, password || "");
}

export function clearCredentials() {
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(PW_KEY);
  sessionStorage.removeItem(ROLE_KEY);
}

function setRole(role) {
  if (role) sessionStorage.setItem(ROLE_KEY, role);
  else sessionStorage.removeItem(ROLE_KEY);
}

function setUsernameFromServer(name) {
  if (name) sessionStorage.setItem(USER_KEY, name);
}

async function post(action, extra) {
  if (!BASE_URL) throw new ApiError("VITE_APPS_SCRIPT_URL is not set", 0);
  const password = getPassword();
  if (!password) throw new ApiError("Unauthorized", 401);
  const username = getUsername();

  const res = await fetch(BASE_URL, {
    method: "POST",
    // text/plain avoids a CORS preflight (Apps Script Web Apps don't answer OPTIONS)
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, username, password, ...extra }),
    redirect: "follow",
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`Bad response from server (HTTP ${res.status})`, res.status);
  }

  if (data?.error === "Unauthorized") {
    clearCredentials();
    throw new ApiError("Wrong username or password", 401);
  }
  if (!res.ok || data?.error) {
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  }
  if (data?.role) setRole(data.role);
  if (data?.username) setUsernameFromServer(data.username);
  return data;
}

export function listMedicines() {
  return post("list");
}

export function replaceMedicines(medicines) {
  return post("replace", { medicines });
}

export function lookupMedicine(name, strength) {
  return post("lookup", { name, strength });
}

export function getSettings() {
  return post("get_settings");
}

export function saveSettings(settings) {
  return post("save_settings", { settings });
}
