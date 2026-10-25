// Persists the whole app state as one JSON document in localStorage.
import { DEFAULT_SETTINGS } from './calc.js';

const STORAGE_KEY = 'shiftpay:v1';

function freshState() {
  return {
    version: 1,
    acceptedDisclaimer: false,
    settings: { ...DEFAULT_SETTINGS, rates: { ...DEFAULT_SETTINGS.rates } },
    shifts: [],
  };
}

export function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const saved = JSON.parse(raw);
    const fresh = freshState();
    return {
      ...fresh,
      acceptedDisclaimer: saved.acceptedDisclaimer === true,
      settings: { ...fresh.settings, ...saved.settings, rates: { ...fresh.settings.rates, ...saved.settings?.rates } },
      shifts: Array.isArray(saved.shifts) ? saved.shifts : [],
    };
  } catch (err) {
    console.error('Saved data unreadable; starting fresh', err);
    if (raw) {
      try { localStorage.setItem(`${STORAGE_KEY}:corrupt`, raw); } catch { /* storage full - nothing more we can do */ }
    }
    return freshState();
  }
}

// Throws if storage is full; the caller decides what to tell the user.
export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

export function newId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
