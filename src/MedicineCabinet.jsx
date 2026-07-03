import { useState, useEffect, useMemo } from "react";
import { Plus, X, Pill, Calendar, Package, ChevronDown, Search, Trash2, Edit3, Sparkles, Droplet, Syringe, GlassWater, AlertTriangle, Clock, PackageMinus, HeartPulse, Download, SlidersHorizontal, LogOut, Container } from "lucide-react";
import { storage } from "./storage.js";
import { lookupMedicine as apiLookup, getSettings, saveSettings, getRole, getUsername, clearCredentials } from "./api.js";

const DEFAULT_SETTINGS = { expiryDays: 60, lowPill: 10, lowLiquid: 2, miscBox: "", boxLabels: "" };

function lowThresholdFor(type, settings) {
  return (type || "drug") === "drug" ? settings.lowPill : settings.lowLiquid;
}

const EXPORT_COLUMNS = [
  "name", "type", "strength", "dosage", "quantity", "volumeMl",
  "condition", "description", "expiryDate", "box",
];

const BOX_COUNT = 30;

function isLiquidType(t) {
  return t && t !== "drug";
}

function toCSV(rows) {
  const escape = (v) => {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = EXPORT_COLUMNS.join(",");
  const body = rows.map((r) => EXPORT_COLUMNS.map((h) => escape(r[h])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

function downloadCSV(rows) {
  const blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `medicine-cabinet-${toLocalISO(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function toLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeEmpty() {
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const y = lastMonth.getFullYear();
  const m = String(lastMonth.getMonth() + 1).padStart(2, "0");
  return {
    name: "",
    type: "drug",
    strength: "",
    dosage: "",
    quantity: "10",
    volumeMl: "",
    condition: "",
    description: "",
    expiryDate: `${y}-${m}`,
    box: "",
  };
}

const TYPE_OPTIONS = [
  { value: "drug", label: "Tablet / pill", tagLabel: "Tablet" },
  { value: "liquid_oral", label: "Liquid oral", tagLabel: "Liquid" },
  { value: "injection", label: "Injection", tagLabel: "Injection" },
  { value: "eye_drops", label: "Eye drops", tagLabel: "Eye drops" },
  { value: "ear_drops", label: "Ear drops", tagLabel: "Ear drops" },
  { value: "cream", label: "Cream / ointment", tagLabel: "Cream" },
  { value: "powder", label: "Powder / sachet", tagLabel: "Powder" },
];

function typeLabel(type) {
  return TYPE_OPTIONS.find((t) => t.value === type)?.label || "Tablet / pill";
}

function tagLabel(type) {
  return TYPE_OPTIONS.find((t) => t.value === type)?.tagLabel || "Tablet";
}

const TYPE_TONES = {
  drug:        { bg: "#EDE8DA", fg: "#7A6C48" }, // tan / sepia
  liquid_oral: { bg: "#E4EEF2", fg: "#4E7D8A" }, // light blue
  injection:   { bg: "#F4DDD9", fg: "#A0554C" }, // muted red
  eye_drops:   { bg: "#DFEAE1", fg: "#517062" }, // sage
  ear_drops:   { bg: "#E8DFEC", fg: "#6E5980" }, // muted purple
  cream:       { bg: "#F4E4D9", fg: "#8B5E3C" }, // warm peach / brown
  powder:      { bg: "#F0EBD4", fg: "#7A6E45" }, // soft mustard
};

function TypeIcon({ type, size = 14, color }) {
  const props = { size, color, strokeWidth: 2.2 };
  if (type === "eye_drops" || type === "ear_drops") return <Droplet {...props} />;
  if (type === "liquid_oral") return <GlassWater {...props} />;
  if (type === "injection") return <Syringe {...props} />;
  if (type === "cream") return <Container {...props} />;
  if (type === "powder") return <Package {...props} />;
  return <Pill {...props} />;
}

// Parses a quantity string like "10 tablets" into { num, unit }
function parseQuantity(str) {
  if (!str) return null;
  const match = String(str).trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return null;
  return { num: parseFloat(match[1]), unit: match[2].trim().toLowerCase() };
}

// Combines two quantity strings, summing numbers when units match/are compatible
function mergeQuantities(a, b) {
  const pa = parseQuantity(a);
  const pb = parseQuantity(b);
  if (pa && pb) {
    if (!pa.unit || !pb.unit || pa.unit === pb.unit) {
      const unit = pa.unit || pb.unit;
      const sum = pa.num + pb.num;
      return unit ? `${sum} ${unit}` : `${sum}`;
    }
  }
  if (!a) return b;
  if (!b) return a;
  return `${a} + ${b}`;
}

// Normalizes a field for duplicate comparison
const norm = (v) => (v || "").trim().toLowerCase();

// Same batch = same name + type + strength + expiry + box. Merge quantities on save.
// Different box (or expiry) with same name/type/strength → separate row in the same group.
function isDuplicate(a, b) {
  return (
    norm(a.name) === norm(b.name) &&
    norm(a.type || "drug") === norm(b.type || "drug") &&
    norm(a.strength) === norm(b.strength) &&
    norm(a.expiryDate) === norm(b.expiryDate) &&
    norm(a.box) === norm(b.box)
  );
}

function groupKey(m) {
  return norm(m.name) + "|" + (m.type || "drug") + "|" + norm(m.strength);
}

// Extract {year, month} from any form the sheet might send back:
//   "2026-08"                                → month-year picker
//   "2026-08-15"                             → legacy full date
//   "Mon Jun 01 2026 00:00:00 GMT-0700 ..."  → cell formatted as Date
function parseYearMonth(dateStr) {
  if (!dateStr) return null;
  const match = String(dateStr).match(/^(\d{4})-(\d{2})/);
  if (match) return { y: Number(match[1]), m: Number(match[2]) };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

// A month expires at the LAST day of that month (matches how medicine
// packaging works: "Exp 08/2026" means safe through August 31).
function daysUntil(dateStr) {
  const ym = parseYearMonth(dateStr);
  if (!ym) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(ym.y, ym.m, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function formatMonthYear(dateStr) {
  const ym = parseYearMonth(dateStr);
  if (!ym) return dateStr || "";
  return new Date(ym.y, ym.m - 1, 1)
    .toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function statusFor(dateStr, expiryDays = 60) {
  const d = daysUntil(dateStr);
  if (d === null) return { label: "No expiry set", tone: "neutral", d };
  if (d < 0) return { label: `Expired ${Math.abs(d)}d ago`, tone: "expired", d };
  if (d <= expiryDays) return { label: `${d}d left`, tone: "soon", d };
  return { label: `${d}d left`, tone: "fresh", d };
}

const toneStyles = {
  fresh: { bg: "#EAF1E8", fg: "#3C5C3A", dot: "#6E9868" },
  soon: { bg: "#FBEEDD", fg: "#8A5420", dot: "#C77D2E" },
  expired: { bg: "#F7E4E1", fg: "#8C332B", dot: "#B8433A" },
  neutral: { bg: "#EDEDE8", fg: "#5C5C54", dot: "#9B9B90" },
};

export default function MedicineCabinet() {
  const [meds, setMeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(makeEmpty);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("expiry");
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [viewFilter, setViewFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [boxFilter, setBoxFilter] = useState("");
  const canEdit = getRole() !== "reader";
  const username = getUsername();

  function logout() {
    clearCredentials();
    window.location.reload();
  }
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState("");

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric",
    }),
    []
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("medicines");
        if (res && res.value) {
          setMeds(JSON.parse(res.value));
        }
        try {
          const { settings: fetched } = await getSettings();
          if (fetched) setSettings({ ...DEFAULT_SETTINGS, ...fetched });
        } catch {
          // settings tab not created yet, or old Apps Script — use defaults
        }
      } catch (e) {
        setError(e?.message || "Couldn't load your cabinet.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function updateSettings(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await saveSettings(next);
    } catch (e) {
      setError(e?.message || "Couldn't save settings.");
    }
  }

  async function persist(next) {
    setMeds(next);
    try {
      const result = await storage.set("medicines", JSON.stringify(next));
      if (!result) setError("Couldn't save. Try again.");
      else setError("");
    } catch (e) {
      setError(e?.message || "Couldn't save. Try again.");
    }
  }

  async function lookupMedicine() {
    if (!form.name.trim()) return;
    setLookingUp(true);
    setLookupError("");
    try {
      // Build a per-box inventory summary so Gemini can group meds with similar existing ones
      const inventory = {};
      meds.forEach((m) => {
        if (!m.box) return;
        const label = [m.name, m.strength].filter(Boolean).join(" ").trim();
        if (!label) return;
        if (!inventory[m.box]) inventory[m.box] = [];
        if (!inventory[m.box].includes(label)) inventory[m.box].push(label);
      });
      const parsed = await apiLookup(form.name.trim(), form.strength.trim(), inventory);
      if (!parsed.condition && !parsed.description && !parsed.dosage && !parsed.strength && !parsed.box) {
        setLookupError("Couldn't find that one — try the generic name, or fill it in yourself.");
      } else {
        setForm((f) => ({
          ...f,
          type: parsed.type || f.type,
          strength: parsed.strength || f.strength,
          dosage: parsed.dosage || f.dosage,
          volumeMl: parsed.volumeMl || f.volumeMl,
          condition: parsed.condition || f.condition,
          description: parsed.description || f.description,
          box: parsed.box || f.box,
        }));
      }
    } catch (e) {
      setLookupError(e?.message || "Lookup failed. You can fill this in manually.");
    } finally {
      setLookingUp(false);
    }
  }

  function openAdd() {
    setForm(makeEmpty());
    setEditingId(null);
    setLookupError("");
    setShowForm(true);
  }

  function openEdit(med) {
    setForm(med);
    setEditingId(med.id);
    setLookupError("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setForm(makeEmpty());
    setEditingId(null);
    setLookupError("");
  }

  function submitForm(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (editingId) {
      persist(meds.map((m) => (m.id === editingId ? { ...form, id: editingId } : m)));
    } else {
      const existing = meds.find((m) => isDuplicate(m, form));
      if (existing) {
        persist(
          meds.map((m) =>
            m.id === existing.id
              ? {
                  ...m,
                  quantity: mergeQuantities(m.quantity, form.quantity),
                }
              : m
          )
        );
      } else {
        const newMed = { ...form, id: Date.now().toString(36) + Math.random().toString(36).slice(2) };
        persist([...meds, newMed]);
      }
    }
    closeForm();
  }

  function removeMed(id) {
    const med = meds.find((m) => m.id === id);
    if (!med) return;
    const ok = window.confirm(`Remove "${med.name}" from the cabinet?`);
    if (!ok) return;
    persist(meds.filter((m) => m.id !== id));
  }

  const nameSuggestions = useMemo(() => {
    const q = norm(form.name);
    if (!q) return [];
    const seen = new Map();
    // walk in reverse so the most recently added entry for a name wins
    for (let i = meds.length - 1; i >= 0; i--) {
      const m = meds[i];
      if (norm(m.name).includes(q) && !seen.has(norm(m.name))) {
        seen.set(norm(m.name), m);
      }
    }
    return [...seen.values()].slice(0, 5);
  }, [form.name, meds]);

  function applySuggestion(med) {
    setForm({
      ...form,
      name: med.name,
      type: med.type || "drug",
      strength: med.strength || "",
      dosage: med.dosage || "",
      condition: med.condition || "",
      description: med.description || "",
    });
    setShowSuggestions(false);
  }

  const pendingItems = useMemo(() => {
    const items = [];

    // Sum unexpired quantity per group so the "running low" check uses total
    // unexpired stock, not per-batch. Also tracks the group's display info.
    const unexpiredByGroup = new Map();
    const groupInfo = new Map();
    meds.forEach((m) => {
      const key = groupKey(m);
      if (!groupInfo.has(key)) {
        groupInfo.set(key, { name: m.name, type: m.type || "drug" });
      }
      const days = daysUntil(m.expiryDate);
      const isExpired = days !== null && days < 0;
      const q = parseQuantity(m.quantity);
      if (q && !isExpired) {
        unexpiredByGroup.set(key, (unexpiredByGroup.get(key) || 0) + q.num);
      }
    });

    // Per-batch expiry callouts — each expiring batch still deserves its own line
    meds.forEach((m) => {
      const status = statusFor(m.expiryDate, settings.expiryDays);
      const gKey = groupKey(m);
      if (status.tone === "expired") {
        items.push({
          groupKey: gKey,
          rank: 0,
          icon: "expired",
          text: `${m.name} expired ${Math.abs(status.d)}d ago — safe to discard`,
        });
      } else if (status.tone === "soon") {
        items.push({
          groupKey: gKey,
          rank: 1,
          icon: "soon",
          text: `${m.name} expires in ${status.d}d — worth restocking soon`,
        });
      }
    });

    // Per-group low-quantity — only counts unexpired stock
    groupInfo.forEach((info, key) => {
      const total = unexpiredByGroup.get(key) || 0;
      const threshold = lowThresholdFor(info.type, settings);
      if (total > 0 && total <= threshold) {
        items.push({
          groupKey: key,
          rank: 2,
          icon: "low",
          text: `${info.name} is down to ${total} unexpired — running low`,
        });
      }
    });

    return items.sort((a, b) => a.rank - b.rank);
  }, [meds, settings]);

  const attentionIds = useMemo(
    () => new Set(pendingItems.map((p) => p.groupKey)),
    [pendingItems]
  );

  const boxSuggestions = useMemo(() => {
    const configured = String(settings.boxLabels || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (configured.length) return configured;
    // Fallback: labels already in use + unused numbers 1-30
    const existing = new Set();
    meds.forEach((m) => { if (m.box) existing.add(String(m.box)); });
    const numeric = [];
    for (let i = 1; i <= BOX_COUNT; i++) {
      const s = String(i);
      if (!existing.has(s)) numeric.push(s);
    }
    return [...existing, ...numeric];
  }, [meds, settings.boxLabels]);

  const groups = useMemo(() => {
    const map = new Map();
    meds.forEach((m) => {
      const key = groupKey(m);
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: m.name,
          type: m.type || "drug",
          strength: m.strength || "",
          condition: "",
          description: "",
          dosage: "",
          box: "",
          batches: [],
        });
      }
      const g = map.get(key);
      g.batches.push(m);
      if (!g.condition && m.condition) g.condition = m.condition;
      if (!g.description && m.description) g.description = m.description;
      if (!g.dosage && m.dosage) g.dosage = m.dosage;
      if (!g.box && m.box) g.box = m.box;
    });
    // Sort batches within each group by expiry (earliest first, blanks last)
    map.forEach((g) => {
      g.batches.sort((a, b) => {
        const da = daysUntil(a.expiryDate);
        const db = daysUntil(b.expiryDate);
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
    });
    return [...map.values()];
  }, [meds]);

  const filtered = useMemo(() => {
    let list = groups.filter((g) => {
      const q = query.toLowerCase();
      return (
        g.name.toLowerCase().includes(q) ||
        (g.condition || "").toLowerCase().includes(q)
      );
    });
    if (viewFilter === "attention") {
      list = list.filter((g) => attentionIds.has(g.key));
    }
    if (typeFilter) {
      list = list.filter((g) => g.type === typeFilter);
    }
    if (boxFilter) {
      list = list.filter((g) => String(g.box) === String(boxFilter));
    }
    const totalQty = (g) => g.batches.reduce((s, b) => {
      const q = parseQuantity(b.quantity);
      return q ? s + q.num : s;
    }, 0);
    const earliestDays = (g) => {
      const d = daysUntil(g.batches[0]?.expiryDate);
      return d === null ? Infinity : d;
    };
    if (sortMode === "expiry") {
      list = [...list].sort((a, b) => earliestDays(a) - earliestDays(b));
    } else if (sortMode === "quantity") {
      list = [...list].sort((a, b) => totalQty(a) - totalQty(b));
    } else {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [groups, query, sortMode, viewFilter, typeFilter, boxFilter, attentionIds]);

  const typeCounts = useMemo(() => {
    const counts = {};
    groups.forEach((g) => {
      counts[g.type] = (counts[g.type] || 0) + 1;
    });
    return counts;
  }, [groups]);

  const pendingIcon = {
    expired: <AlertTriangle size={15} color="#B8433A" strokeWidth={2.2} />,
    soon: <Clock size={15} color="#C77D2E" strokeWidth={2.2} />,
    low: <PackageMinus size={15} color="#6E7A8A" strokeWidth={2.2} />,
  };

  const attentionCount = attentionIds.size;

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .med-input:focus, .med-select:focus, .med-btn:focus-visible {
          outline: 2px solid #2D6A6E;
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .med-card, .med-modal { transition: none !important; animation: none !important; }
        }
        @keyframes slideUp {
          from { transform: translateY(12px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @media (max-width: 640px) {
          .med-title { font-size: 20px !important; }
          .med-today { font-size: 15px !important; }
          .med-header-actions { width: 100%; justify-content: flex-end; }
          .med-controls { flex-wrap: wrap; }
          .med-controls .med-search { flex: 1 1 100% !important; min-width: 0 !important; }
          .med-controls .med-sort,
          .med-controls .med-export { flex: 1 1 auto !important; }
          .med-form-row { flex-direction: column !important; gap: 12px !important; }
          .med-modal { max-width: 100% !important; border-radius: 14px 14px 0 0 !important; padding: 16px !important; }
          .med-batch-row,
          .med-batch-head {
            grid-template-columns: 1fr auto !important;
            gap: 8px !important;
          }
          .med-batch-head > span:nth-child(2),
          .med-batch-head > span:nth-child(3),
          .med-batch-row > .med-batch-box,
          .med-batch-row > .med-batch-qty { grid-column: 1 / -1; padding-left: 0; color: #7A7A6E; }
          .med-detail-grid { gap: 12px !important; }
          .med-stat-card { flex: 1 1 auto; }
          .med-name-input-row { flex-wrap: wrap; }
          .med-name-input-row > button { flex: 0 0 auto; }
        }
      `}</style>

      <header style={styles.header}>
        <div style={styles.headerTop}>
          <div style={styles.brandRow}>
            <div style={styles.brandMark}>
              <Pill size={20} color="#F6F5F1" strokeWidth={2.2} />
              <HeartPulse size={12} color="#F6F5F1" strokeWidth={2.5} style={styles.brandAccent} />
            </div>
            <div>
              <h1 className="med-title" style={styles.title}>Harshil's Medicine Cabinet</h1>
              <p className="med-today" style={styles.today}>{todayLabel}</p>
            </div>
          </div>
          <div className="med-header-actions" style={styles.headerActions}>
            {canEdit ? (
              <button className="med-btn" onClick={openAdd} style={styles.addBtn}>
                <Plus size={16} strokeWidth={2.5} /> Add medicine
              </button>
            ) : (
              <span style={styles.readOnlyTag}>Read only</span>
            )}
            <button
              type="button"
              className="med-btn"
              onClick={logout}
              style={styles.logoutBtn}
              title={username ? `Signed in as ${username} · Log out` : "Log out"}
              aria-label="Log out"
            >
              <LogOut size={14} strokeWidth={2.2} />
              {username && <span style={styles.logoutName}>{username}</span>}
            </button>
          </div>
        </div>

        <div style={styles.statRow}>
          <button
            type="button"
            className="med-btn med-stat-card"
            onClick={() => setViewFilter("all")}
            style={{
              ...styles.statCard,
              ...(viewFilter === "all" ? styles.statCardActive : {}),
            }}
          >
            <span style={styles.statNumber}>{meds.length}</span>
            <span style={styles.statLabel}>{meds.length === 1 ? "medicine" : "medicines"} tracked</span>
          </button>
          <button
            type="button"
            className="med-btn med-stat-card"
            onClick={() => setViewFilter("attention")}
            style={{
              ...styles.statCard,
              ...(attentionCount > 0 ? styles.statCardWarn : {}),
              ...(viewFilter === "attention" ? styles.statCardActive : {}),
            }}
          >
            <span style={styles.statNumber}>{attentionCount}</span>
            <span style={styles.statLabel}>need attention</span>
          </button>
          {canEdit && (
            <button
              type="button"
              className="med-btn"
              onClick={() => setShowSettings((v) => !v)}
              style={styles.settingsBtn}
              title="Attention thresholds"
              aria-label="Attention thresholds"
            >
              <SlidersHorizontal size={16} strokeWidth={2.2} />
            </button>
          )}
        </div>

        {showSettings && (
          <div style={styles.settingsPanel}>
            <div style={styles.settingsTitle}>Attention thresholds</div>
            <div style={styles.settingsRow}>
              <label style={styles.settingsLabel}>
                Flag as expiring within
                <div style={styles.settingsInputWrap}>
                  <input
                    type="number"
                    min={1}
                    value={settings.expiryDays}
                    onChange={(e) => updateSettings({ expiryDays: Math.max(1, Number(e.target.value) || 1) })}
                    style={styles.settingsInput}
                  />
                  <span style={styles.settingsUnit}>days</span>
                </div>
              </label>
              <label style={styles.settingsLabel}>
                Pills/tablets low at
                <div style={styles.settingsInputWrap}>
                  <input
                    type="number"
                    min={0}
                    value={settings.lowPill}
                    onChange={(e) => updateSettings({ lowPill: Math.max(0, Number(e.target.value) || 0) })}
                    style={styles.settingsInput}
                  />
                  <span style={styles.settingsUnit}>or fewer</span>
                </div>
              </label>
              <label style={styles.settingsLabel}>
                Drops/liquid low at
                <div style={styles.settingsInputWrap}>
                  <input
                    type="number"
                    min={0}
                    value={settings.lowLiquid}
                    onChange={(e) => updateSettings({ lowLiquid: Math.max(0, Number(e.target.value) || 0) })}
                    style={styles.settingsInput}
                  />
                  <span style={styles.settingsUnit}>or fewer</span>
                </div>
              </label>
              <label style={{ ...styles.settingsLabel, flex: "1 1 100%" }}>
                Your box labels <span style={styles.optionalTag}>comma-separated · AI picks from this list only</span>
                <input
                  type="text"
                  value={settings.boxLabels}
                  onChange={(e) => updateSettings({ boxLabels: e.target.value })}
                  placeholder='e.g. "First aid, Bathroom, Kitchen, Nightstand, Misc"'
                  style={{ ...styles.settingsInput, width: "100%", fontFamily: "'Inter', sans-serif" }}
                />
              </label>
              <label style={{ ...styles.settingsLabel, flex: "1 1 240px" }}>
                Miscellaneous box <span style={styles.optionalTag}>fallback for oddballs</span>
                <input
                  type="text"
                  value={settings.miscBox}
                  onChange={(e) => updateSettings({ miscBox: e.target.value })}
                  placeholder='e.g. "Misc"'
                  style={{ ...styles.settingsInput, width: "100%", fontFamily: "'Inter', sans-serif" }}
                />
              </label>
            </div>
          </div>
        )}
      </header>

      {pendingItems.length > 0 && (
        <section style={styles.pendingSection}>
          <h2 style={styles.pendingTitle}>Needs attention</h2>
          <div style={styles.pendingList}>
            {pendingItems.map((item, i) => (
              <div
                key={item.groupKey + item.icon + i}
                style={styles.pendingItem}
                onClick={() => setExpandedId(item.groupKey)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setExpandedId(item.groupKey)}
              >
                {pendingIcon[item.icon]}
                <span style={styles.pendingText}>{item.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="med-controls" style={styles.controls}>
        <div className="med-search" style={styles.searchBox}>
          <Search size={15} color="#8A8A7F" />
          <input
            className="med-input"
            placeholder="Search by name or condition"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={styles.searchInput}
          />
        </div>
        <select
          className="med-select med-sort"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value)}
          style={styles.sortSelect}
        >
          <option value="expiry">Sort by expiry</option>
          <option value="name">Sort by name</option>
          <option value="quantity">Sort by quantity</option>
        </select>
        <button
          type="button"
          className="med-btn med-export"
          onClick={() => downloadCSV(meds)}
          disabled={!meds.length}
          style={{ ...styles.exportBtn, opacity: meds.length ? 1 : 0.5, cursor: meds.length ? "pointer" : "default" }}
          title="Export all medicines as CSV"
        >
          <Download size={14} strokeWidth={2.2} />
          Export
        </button>
      </div>

      {groups.length > 0 && (
        <div style={styles.chipRow}>
          <button
            type="button"
            className="med-btn"
            onClick={() => setTypeFilter("")}
            style={{ ...styles.chip, ...(typeFilter === "" ? styles.chipActive : {}) }}
          >
            All types
            <span style={styles.chipCount}>{groups.length}</span>
          </button>
          {TYPE_OPTIONS.filter((t) => typeCounts[t.value]).map((t) => {
            const active = typeFilter === t.value;
            const tone = TYPE_TONES[t.value] || TYPE_TONES.drug;
            return (
              <button
                key={t.value}
                type="button"
                className="med-btn"
                onClick={() => setTypeFilter(active ? "" : t.value)}
                style={{
                  ...styles.chip,
                  ...(active ? { background: tone.bg, border: `1px solid ${tone.fg}`, color: tone.fg, fontWeight: 500 } : {}),
                }}
              >
                <TypeIcon type={t.value} size={13} color={active ? tone.fg : "#7A7A6E"} />
                {t.tagLabel}
                <span style={styles.chipCount}>{typeCounts[t.value]}</span>
              </button>
            );
          })}
        </div>
      )}

      {boxFilter && (
        <div style={styles.boxFilterBanner}>
          <span>📦 Showing Box {boxFilter}</span>
          <button type="button" className="med-btn" onClick={() => setBoxFilter("")} style={styles.boxFilterClear}>
            Show all
          </button>
        </div>
      )}

      {error && <div style={styles.errorBanner}>{error}</div>}

      <main style={styles.list}>
        {loading ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>Loading your cabinet…</p>
          </div>
        ) : filtered.length === 0 && meds.length === 0 ? (
          <div style={styles.emptyState}>
            <Package size={28} color="#B8B5A8" strokeWidth={1.5} />
            <p style={styles.emptyTitle}>Cabinet's empty</p>
            <p style={styles.emptyBody}>Add the first strip your dad packed for you.</p>
            {canEdit && (
              <button className="med-btn" onClick={openAdd} style={styles.emptyBtn}>
                <Plus size={15} /> Add medicine
              </button>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>No matches</p>
            <p style={styles.emptyBody}>Try a different search term.</p>
          </div>
        ) : (
          filtered.map((g) => {
            const earliest = g.batches[0];
            const status = statusFor(earliest?.expiryDate, settings.expiryDays);
            const tone = toneStyles[status.tone];
            const isOpen = expandedId === g.key;
            const totalQty = g.batches.reduce((s, b) => {
              const q = parseQuantity(b.quantity);
              return q ? s + q.num : s;
            }, 0);
            const anyUnparseable = g.batches.some((b) => b.quantity && !parseQuantity(b.quantity));
            const totalLabel = anyUnparseable
              ? g.batches.map((b) => b.quantity).filter(Boolean).join(" + ")
              : String(totalQty);
            return (
              <div key={g.key} className="med-card" style={{ ...styles.card, animation: "slideUp 0.25s ease" }}>
                <div style={styles.cardTab(tone)} />
                <div style={styles.cardBody}>
                <div
                  style={styles.cardMain}
                  onClick={() => setExpandedId(isOpen ? null : g.key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setExpandedId(isOpen ? null : g.key)}
                >
                  <div style={styles.cardTop}>
                    <div>
                      <div style={styles.nameRow}>
                        <TypeIcon type={g.type} color={TYPE_TONES[g.type]?.fg || "#5C5C54"} />
                        <h3 style={styles.medName}>{g.name}</h3>
                        <span style={{
                          ...styles.typeTag,
                          background: (TYPE_TONES[g.type] || TYPE_TONES.drug).bg,
                          color: (TYPE_TONES[g.type] || TYPE_TONES.drug).fg,
                        }}>
                          {tagLabel(g.type)}
                        </span>
                        {(() => {
                          const uniqueBoxes = [...new Set(g.batches.map((b) => b.box).filter(Boolean))];
                          if (!uniqueBoxes.length) return null;
                          if (uniqueBoxes.length === 1) {
                            const b = uniqueBoxes[0];
                            return (
                              <button
                                type="button"
                                className="med-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setBoxFilter(boxFilter === String(b) ? "" : String(b));
                                }}
                                style={{
                                  ...styles.boxTag,
                                  ...(boxFilter === String(b) ? styles.boxTagActive : {}),
                                }}
                                title={`Show only Box ${b}`}
                              >
                                📦 Box {b}
                              </button>
                            );
                          }
                          return (
                            <span style={styles.boxTag} title={`In ${uniqueBoxes.length} boxes`}>
                              📦 {uniqueBoxes.length} boxes
                            </span>
                          );
                        })()}
                      </div>
                      <div style={styles.medMeta}>
                        <div style={styles.medMetaPrimary}>
                          {[g.strength, `${totalLabel} on hand`].filter(Boolean).join(" · ")}
                        </div>
                        {(g.batches.length > 1 || earliest?.expiryDate) && (
                          <div style={styles.medMetaSecondary}>
                            {g.batches.length > 1
                              ? `${g.batches.length} batches · next ${formatMonthYear(earliest.expiryDate)}`
                              : `exp ${formatMonthYear(earliest.expiryDate)}`}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={styles.badgeRow}>
                      <span style={{ ...styles.badge, background: tone.bg, color: tone.fg }}>
                        <span style={{ ...styles.badgeDot, background: tone.dot }} />
                        {status.label}
                      </span>
                      <ChevronDown
                        size={16}
                        color="#A6A398"
                        style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
                      />
                    </div>
                  </div>
                  {g.condition && <p style={styles.medCondition}>{g.condition}</p>}
                </div>

                {isOpen && (
                  <div style={styles.cardDetails}>
                    {g.dosage && (
                      <p style={styles.dosageLine}><strong>Dosage: </strong>{g.dosage}</p>
                    )}
                    <div style={styles.batchTable}>
                      <div className="med-batch-head" style={styles.batchHead}>
                        <span>Expires</span>
                        <span>Box</span>
                        <span>Quantity</span>
                        <span></span>
                      </div>
                      {g.batches.map((b) => {
                        const bs = statusFor(b.expiryDate, settings.expiryDays);
                        const bt = toneStyles[bs.tone];
                        return (
                          <div key={b.id} className="med-batch-row" style={styles.batchRow}>
                            <span style={styles.batchExpiry}>
                              {formatMonthYear(b.expiryDate) || "—"}
                              <span style={{ ...styles.batchStatus, color: bt.fg, background: bt.bg }}>
                                {bs.label}
                              </span>
                            </span>
                            <span className="med-batch-box" style={styles.batchBox}>
                              {b.box ? (
                                <button
                                  type="button"
                                  className="med-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setBoxFilter(boxFilter === String(b.box) ? "" : String(b.box));
                                  }}
                                  style={{
                                    ...styles.batchBoxChip,
                                    ...(boxFilter === String(b.box) ? styles.boxTagActive : {}),
                                  }}
                                  title={`Show only Box ${b.box}`}
                                >
                                  📦 {b.box}
                                </button>
                              ) : (
                                <span style={styles.batchBoxEmpty}>—</span>
                              )}
                            </span>
                            <span className="med-batch-qty" style={styles.batchQty}>
                              {b.quantity || "—"}
                              {b.volumeMl && (
                                <span style={styles.batchVolume}> · {b.volumeMl} {(g.type === "cream" || g.type === "powder") ? "g" : "mL"}</span>
                              )}
                            </span>
                            <span style={styles.batchActions}>
                              {canEdit && (
                                <>
                                  <button className="med-btn" onClick={() => openEdit(b)} style={styles.batchIconBtn} title="Edit batch">
                                    <Edit3 size={13} />
                                  </button>
                                  <button className="med-btn" onClick={() => removeMed(b.id)} style={{ ...styles.batchIconBtn, color: "#B8433A" }} title="Remove batch">
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {g.description && <p style={styles.medDescription}>{g.description}</p>}
                  </div>
                )}
                </div>
              </div>
            );
          })
        )}
      </main>

      {showForm && (
        <div style={styles.overlay} onClick={closeForm}>
          <div className="med-modal" style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>{editingId ? "Edit medicine" : "New medicine"}</h2>
              <button className="med-btn" onClick={closeForm} style={styles.closeBtn} aria-label="Close">
                <X size={18} color="#5C5C54" />
              </button>
            </div>
            <form onSubmit={submitForm} style={styles.form}>
              <label style={{ ...styles.label, position: "relative" }}>
                Name
                <div className="med-name-input-row" style={styles.nameInputRow}>
                  <input
                    className="med-input"
                    required
                    value={form.name}
                    onChange={(e) => {
                      setForm({ ...form, name: e.target.value });
                      setShowSuggestions(true);
                      setHighlightIdx(-1);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
                    onKeyDown={(e) => {
                      const list = nameSuggestions;
                      if (!showSuggestions || !list.length) {
                        if (e.key === "Escape") setShowSuggestions(false);
                        return;
                      }
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setHighlightIdx((i) => Math.min(list.length - 1, i + 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setHighlightIdx((i) => Math.max(0, i - 1));
                      } else if (e.key === "Enter" && highlightIdx >= 0) {
                        e.preventDefault();
                        applySuggestion(list[highlightIdx]);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setShowSuggestions(false);
                      }
                    }}
                    placeholder="e.g. Azithral 500"
                    style={{ ...styles.formInput, flex: 1 }}
                    autoComplete="off"
                  />
                  {form.name.trim() && (
                    <button
                      type="button"
                      className="med-btn"
                      onClick={lookupMedicine}
                      disabled={lookingUp}
                      style={{
                        ...styles.inlineLookupBtn,
                        opacity: lookingUp ? 0.55 : 1,
                        cursor: lookingUp ? "default" : "pointer",
                      }}
                      title="Autofill with AI"
                    >
                      <Sparkles size={14} />
                      {lookingUp ? "…" : "Suggest"}
                    </button>
                  )}
                </div>
                {showSuggestions && nameSuggestions.length > 0 && (
                  <div style={styles.suggestBox} role="listbox">
                    {nameSuggestions.map((s, i) => (
                      <div
                        key={s.id}
                        role="option"
                        aria-selected={i === highlightIdx}
                        style={{
                          ...styles.suggestItem,
                          ...(i === highlightIdx ? styles.suggestItemActive : {}),
                        }}
                        onMouseDown={() => applySuggestion(s)}
                        onMouseEnter={() => setHighlightIdx(i)}
                      >
                        <span style={styles.suggestName}>{s.name}</span>
                        {(s.strength || s.dosage) && (
                          <span style={styles.suggestMeta}>
                            {[s.strength, s.dosage].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </label>
              <label style={styles.label}>
                Type
                <select
                  className="med-select"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  style={styles.formInput}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="med-form-row" style={styles.formRow}>
                <label style={{ ...styles.label, flex: 1 }}>
                  Strength <span style={styles.optionalTag}>optional</span>
                  <input
                    className="med-input"
                    value={form.strength}
                    onChange={(e) => setForm({ ...form, strength: e.target.value })}
                    placeholder="500mg"
                    style={styles.formInput}
                  />
                </label>
                <label style={{ ...styles.label, flex: 1 }}>
                  Dosage
                  <input
                    className="med-input"
                    value={form.dosage}
                    onChange={(e) => setForm({ ...form, dosage: e.target.value })}
                    placeholder="1 tablet twice daily, after meals"
                    style={styles.formInput}
                  />
                </label>
              </div>

              {lookupError && <p style={styles.lookupError}>{lookupError}</p>}
              <div className="med-form-row" style={styles.formRow}>
                <label style={{ ...styles.label, flex: 2 }}>
                  What it's for
                  <input
                    className="med-input"
                    value={form.condition}
                    onChange={(e) => setForm({ ...form, condition: e.target.value })}
                    placeholder="Fever, bacterial infection"
                    style={styles.formInput}
                  />
                </label>
                <label style={{ ...styles.label, flex: 1 }}>
                  Quantity
                  <input
                    className="med-input"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    placeholder={isLiquidType(form.type) ? "1 bottle" : "10 tablets"}
                    style={styles.formInput}
                  />
                </label>
              </div>
              {isLiquidType(form.type) && (
                <label style={styles.label}>
                  {(form.type === "cream" || form.type === "powder") ? "Size per tube (g)" : "Volume per unit (mL)"}
                  <span style={styles.optionalTag}>optional</span>
                  <input
                    className="med-input"
                    type="number"
                    min={0}
                    step="any"
                    value={form.volumeMl}
                    onChange={(e) => setForm({ ...form, volumeMl: e.target.value })}
                    placeholder={(form.type === "cream" || form.type === "powder") ? "e.g. 30 or 50" : "e.g. 10 for eye drops, 60 for syrup"}
                    style={styles.formInput}
                  />
                </label>
              )}
              <label style={styles.label}>
                Description / notes <span style={styles.optionalTag}>optional</span>
                <textarea
                  className="med-input"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What it is, how it works, things to remember — or tap Suggest above"
                  style={styles.formTextarea}
                  rows={6}
                />
              </label>
              <div className="med-form-row" style={styles.formRow}>
                <label style={{ ...styles.label, flex: 1 }}>
                  Expiry (month/year)
                  <input
                    className="med-input"
                    type="month"
                    value={(() => {
                      const ym = parseYearMonth(form.expiryDate);
                      return ym ? `${ym.y}-${String(ym.m).padStart(2, "0")}` : "";
                    })()}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                    style={styles.formInput}
                  />
                </label>
                <label style={{ ...styles.label, flex: 1 }}>
                  Storage box <span style={styles.optionalTag}>Suggest picks</span>
                  <input
                    className="med-input"
                    list="box-suggestions"
                    value={form.box || ""}
                    onChange={(e) => setForm({ ...form, box: e.target.value })}
                    placeholder='e.g. "12" or "Top shelf"'
                    style={styles.formInput}
                  />
                  <datalist id="box-suggestions">
                    {boxSuggestions.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </label>
              </div>
              <button className="med-btn" type="submit" style={styles.submitBtn}>
                {editingId ? "Save changes" : "Add to cabinet"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#F6F5F1",
    fontFamily: "'Inter', sans-serif",
    color: "#26261F",
    paddingBottom: 60,
  },
  header: {
    padding: "28px 20px 20px",
    borderBottom: "1px solid #E4E1D4",
    background: "#FBFAF6",
  },
  headerTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 14,
    maxWidth: 720,
    margin: "0 auto",
  },
  brandRow: { display: "flex", alignItems: "flex-start", gap: 12 },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "#2D6A6E",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
    position: "relative",
    boxShadow: "0 2px 6px rgba(45,106,110,0.25)",
  },
  brandAccent: {
    position: "absolute",
    top: 4,
    right: 4,
    background: "#B8433A",
    borderRadius: 4,
    padding: 1,
  },
  title: {
    fontFamily: "'Fraunces', serif",
    fontSize: 24,
    fontWeight: 600,
    margin: 0,
    letterSpacing: "-0.01em",
    lineHeight: 1.15,
  },
  subtitle: { margin: "3px 0 0", fontSize: 13.5, color: "#7A7A6E" },
  today: {
    margin: "6px 0 0",
    fontSize: 17,
    fontFamily: "'Fraunces', serif",
    fontWeight: 500,
    color: "#2D6A6E",
    letterSpacing: "-0.005em",
  },
  addBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#2D6A6E",
    color: "#F6F5F1",
    border: "none",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  headerActions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexShrink: 0,
  },
  logoutBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#FFFFFF",
    border: "1px solid #E4E1D4",
    borderRadius: 10,
    padding: "9px 12px",
    fontSize: 13,
    color: "#5C5C54",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  logoutName: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#3D3D34",
  },
  readOnlyTag: {
    fontSize: 11.5,
    fontFamily: "'IBM Plex Mono', monospace",
    color: "#5C5C54",
    background: "#F1EEE3",
    padding: "6px 12px",
    borderRadius: 20,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  statRow: { display: "flex", gap: 10, maxWidth: 720, margin: "18px auto 0", flexWrap: "wrap" },
  statCard: {
    background: "#F1EEE3",
    borderRadius: 10,
    padding: "10px 14px",
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    border: "1px solid transparent",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    color: "#26261F",
  },
  statCardWarn: { background: "#FBEEDD" },
  statCardActive: { border: "1px solid #2D6A6E", boxShadow: "0 0 0 2px rgba(45,106,110,0.15)" },
  settingsBtn: {
    background: "#FFFFFF",
    border: "1px solid #E4E1D4",
    borderRadius: 10,
    padding: "0 12px",
    color: "#5C5C54",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    marginLeft: "auto",
  },
  settingsPanel: {
    maxWidth: 720,
    margin: "12px auto 0",
    background: "#FFFFFF",
    border: "1px solid #E4E1D4",
    borderRadius: 12,
    padding: "14px 16px",
  },
  settingsTitle: {
    fontFamily: "'Fraunces', serif",
    fontSize: 13,
    fontWeight: 600,
    color: "#5C5C54",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: 10,
  },
  settingsRow: { display: "flex", gap: 16, flexWrap: "wrap" },
  settingsLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12.5,
    color: "#5C5C54",
    fontWeight: 500,
    flex: "1 1 180px",
  },
  settingsInputWrap: { display: "flex", alignItems: "center", gap: 6 },
  settingsInput: {
    border: "1px solid #E4E1D4",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 14,
    fontFamily: "'IBM Plex Mono', monospace",
    width: 80,
    background: "#FFFFFF",
    color: "#26261F",
  },
  settingsUnit: { fontSize: 12.5, color: "#7A7A6E" },
  statNumber: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, fontWeight: 500 },
  statLabel: { fontSize: 12.5, color: "#7A7A6E" },
  controls: {
    maxWidth: 720,
    margin: "18px auto 0",
    padding: "0 20px",
    display: "flex",
    gap: 10,
  },
  searchBox: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#FFFFFF",
    border: "1px solid #E4E1D4",
    borderRadius: 10,
    padding: "9px 12px",
  },
  searchInput: {
    border: "none",
    outline: "none",
    fontSize: 14,
    flex: 1,
    fontFamily: "'Inter', sans-serif",
    background: "transparent",
  },
  sortSelect: {
    border: "1px solid #E4E1D4",
    borderRadius: 10,
    padding: "9px 10px",
    fontSize: 13,
    background: "#FFFFFF",
    fontFamily: "'Inter', sans-serif",
    color: "#5C5C54",
  },
  chipRow: {
    maxWidth: 720,
    margin: "12px auto 0",
    padding: "0 20px",
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  chip: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "#FFFFFF",
    border: "1px solid #E4E1D4",
    borderRadius: 20,
    padding: "6px 12px",
    fontSize: 12.5,
    fontFamily: "'Inter', sans-serif",
    color: "#5C5C54",
    cursor: "pointer",
  },
  chipActive: {
    background: "#EAF1F1",
    border: "1px solid #2D6A6E",
    color: "#2D6A6E",
    fontWeight: 500,
  },
  chipCount: {
    fontSize: 11,
    color: "#9B9B90",
    fontFamily: "'IBM Plex Mono', monospace",
    marginLeft: 2,
  },
  exportBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "#FFFFFF",
    border: "1px solid #E4E1D4",
    borderRadius: 10,
    padding: "9px 12px",
    fontSize: 13,
    fontFamily: "'Inter', sans-serif",
    color: "#3D3D34",
    fontWeight: 500,
  },
  pendingSection: {
    maxWidth: 720,
    margin: "16px auto 0",
    padding: "0 20px",
  },
  pendingTitle: {
    fontFamily: "'Fraunces', serif",
    fontSize: 14,
    fontWeight: 600,
    margin: "0 0 8px",
    color: "#5C5C54",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  pendingList: { display: "flex", flexDirection: "column", gap: 6 },
  pendingItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    background: "#FBFAF6",
    border: "1px solid #E9E6DA",
    borderRadius: 9,
    padding: "9px 12px",
    cursor: "pointer",
  },
  pendingText: { fontSize: 13, color: "#3D3D34", lineHeight: 1.4 },
  errorBanner: {
    maxWidth: 720,
    margin: "12px auto 0",
    padding: "10px 14px",
    background: "#F7E4E1",
    color: "#8C332B",
    borderRadius: 8,
    fontSize: 13,
  },
  list: {
    maxWidth: 720,
    margin: "20px auto 0",
    padding: "0 20px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  card: {
    background: "#FFFFFF",
    borderRadius: 12,
    border: "1px solid #E9E6DA",
    display: "flex",
    overflow: "hidden",
  },
  cardTab: (tone) => ({ width: 5, background: tone.dot, flexShrink: 0 }),
  cardBody: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  cardMain: { padding: "14px 16px", cursor: "pointer" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  medName: { margin: 0, fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600 },
  nameRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  typeTag: {
    fontSize: 10.5,
    fontFamily: "'IBM Plex Mono', monospace",
    color: "#5C8A8E",
    background: "#EAF1F1",
    padding: "2px 7px",
    borderRadius: 20,
  },
  boxTag: {
    fontSize: 10.5,
    fontFamily: "'IBM Plex Mono', monospace",
    color: "#3D3D34",
    background: "#F1EEE3",
    border: "1px solid transparent",
    padding: "2px 8px",
    borderRadius: 20,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  boxTagActive: {
    background: "#EAF1F1",
    border: "1px solid #2D6A6E",
    color: "#2D6A6E",
    fontWeight: 500,
  },
  boxFilterBanner: {
    maxWidth: 720,
    margin: "12px auto 0",
    padding: "8px 14px",
    background: "#EAF1F1",
    border: "1px solid #2D6A6E",
    borderRadius: 10,
    fontSize: 13,
    color: "#2D6A6E",
    fontWeight: 500,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  boxFilterClear: {
    background: "transparent",
    border: "none",
    color: "#2D6A6E",
    fontSize: 12.5,
    cursor: "pointer",
    textDecoration: "underline",
    fontFamily: "'Inter', sans-serif",
  },
  medDosage: {
    display: "block",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12.5,
    color: "#7A7A6E",
    marginTop: 2,
  },
  medMeta: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    marginTop: 4,
  },
  medMetaPrimary: {
    fontFamily: "'Inter', sans-serif",
    fontSize: 13,
    color: "#5C5C54",
  },
  medMetaSecondary: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13.5,
    fontWeight: 500,
    color: "#3D3D34",
    marginTop: 2,
  },
  medCondition: { margin: "8px 0 0", fontSize: 13.5, color: "#615F53" },
  badgeRow: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  badge: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11.5,
    fontFamily: "'IBM Plex Mono', monospace",
    padding: "4px 9px",
    borderRadius: 20,
    whiteSpace: "nowrap",
  },
  badgeDot: { width: 6, height: 6, borderRadius: "50%" },
  cardDetails: {
    padding: "0 16px 16px",
    borderTop: "1px dashed #E9E6DA",
    marginTop: 0,
  },
  detailGrid: { display: "flex", gap: 20, flexWrap: "wrap", paddingTop: 14 },
  detailItem: { display: "flex", flexDirection: "column", gap: 2 },
  detailLabel: { fontSize: 11, color: "#9B9B90", textTransform: "uppercase", letterSpacing: "0.04em" },
  detailValue: { fontSize: 13.5, fontFamily: "'IBM Plex Mono', monospace" },
  medDescription: {
    fontSize: 14.5,
    color: "#3D3D34",
    lineHeight: 1.65,
    margin: "14px 0 0",
    paddingTop: 14,
    borderTop: "1px dashed #E9E6DA",
    whiteSpace: "pre-wrap",
  },
  cardActions: { display: "flex", gap: 8, marginTop: 14 },
  dosageLine: {
    margin: "12px 0 0",
    fontSize: 13.5,
    color: "#3D3D34",
  },
  batchTable: {
    marginTop: 12,
    border: "1px solid #E9E6DA",
    borderRadius: 10,
    overflow: "hidden",
  },
  batchHead: {
    display: "grid",
    gridTemplateColumns: "1.4fr 0.9fr 0.9fr auto",
    gap: 10,
    padding: "8px 12px",
    background: "#F6F5F1",
    fontSize: 10.5,
    color: "#9B9B90",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  batchRow: {
    display: "grid",
    gridTemplateColumns: "1.4fr 0.9fr 0.9fr auto",
    gap: 10,
    padding: "10px 12px",
    borderTop: "1px solid #F1EEE3",
    alignItems: "center",
  },
  batchExpiry: {
    fontSize: 13.5,
    fontFamily: "'IBM Plex Mono', monospace",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  batchStatus: {
    fontSize: 10.5,
    padding: "2px 7px",
    borderRadius: 20,
    alignSelf: "flex-start",
    fontFamily: "'IBM Plex Mono', monospace",
  },
  batchQty: {
    fontSize: 13.5,
    fontFamily: "'IBM Plex Mono', monospace",
    color: "#3D3D34",
  },
  batchBox: { display: "flex", alignItems: "center" },
  batchBoxChip: {
    fontSize: 11.5,
    fontFamily: "'IBM Plex Mono', monospace",
    color: "#3D3D34",
    background: "#F1EEE3",
    border: "1px solid transparent",
    padding: "3px 8px",
    borderRadius: 20,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
  },
  batchBoxEmpty: {
    fontSize: 12,
    color: "#B8B5A8",
  },
  batchVolume: {
    color: "#5C8A8E",
    fontSize: 12,
  },
  batchActions: { display: "flex", gap: 4 },
  batchIconBtn: {
    background: "transparent",
    border: "none",
    borderRadius: 6,
    padding: 6,
    cursor: "pointer",
    color: "#7A7A6E",
    display: "flex",
    alignItems: "center",
  },
  iconBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "#F1EEE3",
    border: "none",
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 12.5,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    color: "#3D3D34",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 6,
    padding: "50px 20px",
    background: "#FBFAF6",
    borderRadius: 14,
    border: "1px dashed #E4E1D4",
  },
  emptyTitle: { fontFamily: "'Fraunces', serif", fontSize: 17, margin: "8px 0 0" },
  emptyBody: { fontSize: 13.5, color: "#8A8A7F", margin: 0 },
  emptyBtn: {
    marginTop: 10,
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#2D6A6E",
    color: "#F6F5F1",
    border: "none",
    borderRadius: 10,
    padding: "9px 16px",
    fontSize: 13.5,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(38,38,31,0.45)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 50,
  },
  modal: {
    background: "#FBFAF6",
    width: "100%",
    maxWidth: 480,
    borderRadius: "18px 18px 0 0",
    padding: 20,
    maxHeight: "88vh",
    overflowY: "auto",
    animation: "slideUp 0.25s ease",
  },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontFamily: "'Fraunces', serif", fontSize: 20, margin: 0, fontWeight: 600 },
  closeBtn: { background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" },
  form: { display: "flex", flexDirection: "column", gap: 14 },
  formRow: { display: "flex", gap: 12 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "#5C5C54", fontWeight: 500 },
  optionalTag: {
    fontSize: 10.5,
    color: "#A6A398",
    fontWeight: 400,
    textTransform: "none",
    marginLeft: 4,
  },
  suggestBox: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    background: "#FFFFFF",
    border: "1px solid #E4E1D4",
    borderRadius: 10,
    boxShadow: "0 6px 18px rgba(38,38,31,0.12)",
    zIndex: 10,
    overflow: "hidden",
  },
  suggestItem: {
    padding: "9px 12px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 1,
    borderBottom: "1px solid #F1EEE3",
  },
  suggestItemActive: { background: "#EAF1F1" },
  suggestName: { fontSize: 13.5, color: "#26261F", fontWeight: 500 },
  suggestMeta: { fontSize: 11.5, color: "#9B9B90", fontFamily: "'IBM Plex Mono', monospace" },
  formInput: {
    border: "1px solid #E4E1D4",
    borderRadius: 9,
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: "'Inter', sans-serif",
    background: "#FFFFFF",
    color: "#26261F",
  },
  formTextarea: {
    border: "1px solid #E4E1D4",
    borderRadius: 9,
    padding: "12px 14px",
    fontSize: 14,
    fontFamily: "'Inter', sans-serif",
    background: "#FFFFFF",
    color: "#26261F",
    resize: "vertical",
    lineHeight: 1.6,
    minHeight: 140,
  },
  nameInputRow: { display: "flex", gap: 8, alignItems: "stretch" },
  inlineLookupBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "#2D6A6E",
    color: "#F6F5F1",
    border: "none",
    borderRadius: 9,
    padding: "0 12px",
    fontSize: 12.5,
    fontWeight: 500,
    fontFamily: "'Inter', sans-serif",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  lookupError: { fontSize: 12, color: "#B8433A", margin: "-4px 0 0" },
  submitBtn: {
    marginTop: 6,
    background: "#2D6A6E",
    color: "#F6F5F1",
    border: "none",
    borderRadius: 10,
    padding: "12px",
    fontSize: 14.5,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
  },
};
