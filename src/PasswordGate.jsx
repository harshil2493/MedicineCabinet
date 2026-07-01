import { useState } from "react";
import { Pill } from "lucide-react";
import { getPassword, setPassword, listMedicines } from "./api.js";

export default function PasswordGate({ children }) {
  const [hasPw, setHasPw] = useState(Boolean(getPassword()));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError("");
    setPassword(input.trim());
    try {
      await listMedicines();
      setHasPw(true);
    } catch (err) {
      setPassword("");
      setError(err?.status === 401 ? "Wrong password" : (err?.message || "Couldn't reach the server"));
    } finally {
      setBusy(false);
    }
  }

  if (hasPw) return children;

  return (
    <div style={styles.page}>
      <form onSubmit={submit} style={styles.card}>
        <div style={styles.brandMark}>
          <Pill size={22} color="#F6F5F1" strokeWidth={2.2} />
        </div>
        <h1 style={styles.title}>The Cabinet</h1>
        <p style={styles.subtitle}>Enter your cabinet password.</p>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
          style={styles.input}
          placeholder="password"
        />
        <button type="submit" disabled={busy || !input.trim()} style={styles.btn}>
          {busy ? "Checking…" : "Unlock"}
        </button>
        {error && <p style={styles.error}>{error}</p>}
      </form>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#F6F5F1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    fontFamily: "'Inter', sans-serif",
    color: "#26261F",
  },
  card: {
    background: "#FBFAF6",
    border: "1px solid #E4E1D4",
    borderRadius: 16,
    padding: "32px 28px",
    maxWidth: 380,
    width: "100%",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "#2D6A6E",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto",
  },
  title: {
    fontFamily: "'Fraunces', serif",
    fontSize: 24,
    fontWeight: 600,
    margin: 0,
    letterSpacing: "-0.01em",
  },
  subtitle: { fontSize: 13.5, color: "#7A7A6E", margin: "0 0 4px" },
  input: {
    border: "1px solid #E4E1D4",
    borderRadius: 9,
    padding: "11px 12px",
    fontSize: 14,
    fontFamily: "'Inter', sans-serif",
    background: "#FFFFFF",
  },
  btn: {
    background: "#2D6A6E",
    color: "#F6F5F1",
    border: "none",
    borderRadius: 10,
    padding: "11px 18px",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  error: {
    fontSize: 12.5,
    color: "#8C332B",
    background: "#F7E4E1",
    padding: "8px 12px",
    borderRadius: 8,
    margin: 0,
  },
};
