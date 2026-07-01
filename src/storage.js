import { listMedicines, replaceMedicines } from "./api.js";

// Adapter that mimics the window.storage.get/set shape the component
// was originally written against, so MedicineCabinet.jsx doesn't need to
// know it's talking to Google Sheets under the hood.
export const storage = {
  async get(key) {
    if (key !== "medicines") return null;
    const { medicines } = await listMedicines();
    return { value: JSON.stringify(medicines || []) };
  },
  async set(key, value) {
    if (key !== "medicines") return false;
    const parsed = JSON.parse(value);
    await replaceMedicines(parsed);
    return true;
  },
};
