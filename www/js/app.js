import {
  RATE_TYPES, RATE_LABELS, calculateShift, summarize, getPeriod, stepPeriod, shiftsInRange,
  validateShift, validateSettings, findOverlap, isValidDate, formatMoney, formatHours, toIsoLocal,
} from './calc.js';
import { loadState, saveState, clearState, newId } from './storage.js';
import { exportCsv, exportPdf } from './export.js';

const $ = (selector) => document.querySelector(selector);
const SCREEN_TITLES = { period: 'ShiftPay', shift: 'Add shift', export: 'Export', settings: 'Settings' };

let state = loadState();
let viewDate = toIsoLocal(); // any date inside the pay period on screen
let editingId = null;
let currentScreen = 'period';

// ---------- helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContent, never innerHTML: notes are user input
  return node;
}

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const hasRates = () => RATE_TYPES.some((type) => state.settings.rates[type] > 0);
const formValues = (form) => Object.fromEntries(new FormData(form));

let toastTimer;
function toast(message, type = 'info') {
  const node = $('#toast');
  node.textContent = message;
  node.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = ''; }, 3000);
}

// Save first, then swap in-memory state, so the screen never shows unsaved data.
function commit(nextState, message) {
  try {
    saveState(nextState);
  } catch (err) {
    console.error(err);
    toast('Could not save. Your device storage may be full.', 'error');
    return false;
  }
  state = nextState;
  if (message) toast(message);
  return true;
}

function showErrors(form, errors) {
  form.querySelectorAll('.field-error').forEach((node) => {
    node.textContent = errors[node.dataset.for] ?? '';
  });
  for (const field of form.elements) {
    if (field.name) field.setAttribute('aria-invalid', String(Boolean(errors[field.name])));
  }
  [...form.elements].find((field) => errors[field.name])?.focus();
}

function show(name) {
  for (const key of Object.keys(SCREEN_TITLES)) $(`#screen-${key}`).hidden = key !== name;
  $('#screen-title').textContent = SCREEN_TITLES[name];
  document.querySelectorAll('.bottom-nav button').forEach((button) => {
    button.classList.toggle('active', button.dataset.screen === name);
  });
  currentScreen = name;
  window.scrollTo(0, 0);
}

// ---------- pay period screen ----------

function renderPeriod() {
  const { settings } = state;
  const { start, end } = getPeriod(viewDate, settings);
  const shifts = shiftsInRange(state.shifts, start, end);
  const totals = summarize(shifts, settings);
  const today = toIsoLocal();

  $('#period-label').textContent = today >= start && today <= end ? 'This pay period' : 'Pay period';
  $('#period-range').textContent = `${formatDate(start)} – ${formatDate(end)}`;
  $('#total-pay').textContent = formatMoney(totals.payCents, settings.currency);
  $('#total-hours').textContent = formatHours(totals.paidMinutes);
  $('#total-shifts').textContent = String(totals.count);
  $('#rates-warning').hidden = hasRates();
  $('#empty-state').hidden = shifts.length > 0;

  $('#shift-list').replaceChildren(...shifts.map((shift) => {
    const r = calculateShift(shift, settings);
    const button = el('button', 'shift-item');
    button.type = 'button';
    button.dataset.id = shift.id;
    const info = el('span', '', formatDate(shift.date));
    const details = `${shift.start}–${shift.end} · ${formatHours(r.paidMinutes)} paid · ${RATE_LABELS[r.rateType]}`;
    info.append(el('small', '', shift.note ? `${details} · ${shift.note}` : details));
    button.append(info, el('strong', '', formatMoney(r.payCents, settings.currency)));
    const item = el('li');
    item.append(button);
    return item;
  }));
}

// ---------- shift form ----------

function openShiftForm(id = null) {
  const form = $('#shift-form');
  const existing = id ? state.shifts.find((s) => s.id === id) : null;
  const { start, end } = getPeriod(viewDate, state.settings);
  const today = toIsoLocal();
  const values = existing ?? {
    date: today >= start && today <= end ? today : start,
    start: '09:00', end: '17:00', breakMinutes: 30, rateType: 'auto', note: '',
  };
  editingId = existing ? id : null;
  for (const name of ['date', 'start', 'end', 'breakMinutes', 'rateType', 'note']) {
    form.elements[name].value = values[name];
  }
  showErrors(form, {});
  $('#delete-shift').hidden = !existing;
  SCREEN_TITLES.shift = existing ? 'Edit shift' : 'Add shift';
  updatePreview();
  show('shift');
}

function updatePreview() {
  const { errors, value } = validateShift(formValues($('#shift-form')));
  const output = $('#shift-preview');
  if (Object.keys(errors).length) {
    output.textContent = '';
    return;
  }
  const r = calculateShift(value, state.settings);
  const money = (cents) => formatMoney(cents, state.settings.currency);
  output.textContent = `${formatHours(r.paidMinutes)} paid × ${money(r.rateCents)}/h (${RATE_LABELS[r.rateType]}) ≈ ${money(r.payCents)}`;
}

function saveShift(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const { errors, value } = validateShift(formValues(form));
  showErrors(form, errors);
  if (Object.keys(errors).length) return;

  const clash = findOverlap(value, state.shifts, editingId);
  if (clash && !window.confirm(`This overlaps your ${clash.start}–${clash.end} shift on ${formatDate(clash.date)}. Save anyway?`)) {
    return;
  }

  const now = new Date().toISOString();
  const shifts = editingId
    ? state.shifts.map((s) => (s.id === editingId ? { ...s, ...value, updatedAt: now } : s))
    : [...state.shifts, { id: newId(), ...value, createdAt: now }];

  if (commit({ ...state, shifts }, editingId ? 'Shift updated' : 'Shift saved')) {
    viewDate = value.date;
    renderPeriod();
    show('period');
  }
}

function deleteShift() {
  if (!editingId || !window.confirm('Delete this shift? This cannot be undone.')) return;
  if (commit({ ...state, shifts: state.shifts.filter((s) => s.id !== editingId) }, 'Shift deleted')) {
    renderPeriod();
    show('period');
  }
}

// ---------- settings ----------

function openSettings() {
  const form = $('#settings-form');
  const { settings } = state;
  form.elements.currency.value = settings.currency;
  for (const type of RATE_TYPES) {
    const cents = settings.rates[type];
    form.elements[`${type}Rate`].value = cents ? (cents / 100).toFixed(2) : '';
  }
  form.elements.periodType.value = settings.periodType;
  form.elements.periodStart.value = settings.periodStart;
  togglePeriodStart();
  showErrors(form, {});
  show('settings');
}

function togglePeriodStart() {
  $('#period-start-field').hidden = $('#settings-form').elements.periodType.value === 'monthly';
}

function saveSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const { errors, value } = validateSettings(formValues(form));
  showErrors(form, errors);
  if (Object.keys(errors).length) return;
  if (commit({ ...state, settings: value }, 'Settings saved')) {
    renderPeriod();
    show('period');
  }
}

function eraseAll() {
  if (!window.confirm('Erase all shifts and settings from this device? This cannot be undone.')) return;
  clearState();
  state = loadState();
  viewDate = toIsoLocal();
  renderPeriod();
  show('period');
  toast('All data erased');
  $('#welcome').showModal();
}

// ---------- export ----------

function openExport() {
  const form = $('#export-form');
  const { start, end } = getPeriod(viewDate, state.settings);
  $('#export-period-label').textContent = `(${formatDate(start)} – ${formatDate(end)})`;
  if (!form.elements.from.value) {
    form.elements.from.value = start;
    form.elements.to.value = end;
  }
  toggleCustomRange();
  showErrors(form, {});
  show('export');
}

function toggleCustomRange() {
  $('#custom-range').hidden = $('#export-form').elements.range.value !== 'custom';
}

async function runExport(kind, button) {
  const form = $('#export-form');
  const f = form.elements;
  const range = f.range.value === 'custom'
    ? { start: f.from.value, end: f.to.value }
    : getPeriod(viewDate, state.settings);

  const errors = {};
  if (!isValidDate(range.start) || !isValidDate(range.end)) errors.range = 'Choose both dates.';
  else if (range.start > range.end) errors.range = '"From" must be on or before "To".';
  showErrors(form, errors);
  if (errors.range) return;

  const shifts = shiftsInRange(state.shifts, range.start, range.end);
  if (!shifts.length) {
    toast('No shifts in that date range.', 'error');
    return;
  }

  button.disabled = true;
  try {
    await (kind === 'pdf' ? exportPdf : exportCsv)(shifts, state.settings, range);
    toast(`${kind.toUpperCase()} ready`);
  } catch (err) {
    console.error(err);
    toast(`Export failed: ${err?.message ?? err}`, 'error');
  } finally {
    button.disabled = false;
  }
}

// ---------- wiring ----------

function onWelcomeClosed() {
  commit({ ...state, acceptedDisclaimer: true });
  if (!hasRates()) {
    openSettings();
    toast('Enter your hourly rates to get started.');
  }
}

function onBackButton() {
  if (currentScreen !== 'period') show('period');
  else navigator.app.exitApp();
}

function bindEvents() {
  const navActions = {
    period: () => { renderPeriod(); show('period'); },
    shift: () => openShiftForm(),
    export: openExport,
    settings: openSettings,
  };
  $('.bottom-nav').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button) navActions[button.dataset.screen]();
  });

  $('#prev-period').addEventListener('click', () => { viewDate = stepPeriod(viewDate, state.settings, -1); renderPeriod(); });
  $('#next-period').addEventListener('click', () => { viewDate = stepPeriod(viewDate, state.settings, 1); renderPeriod(); });
  $('#shift-list').addEventListener('click', (e) => {
    const item = e.target.closest('.shift-item');
    if (item) openShiftForm(item.dataset.id);
  });

  const shiftForm = $('#shift-form');
  shiftForm.addEventListener('input', updatePreview);
  shiftForm.addEventListener('submit', saveShift);
  $('#cancel-shift').addEventListener('click', () => show('period'));
  $('#delete-shift').addEventListener('click', deleteShift);

  const settingsForm = $('#settings-form');
  settingsForm.addEventListener('submit', saveSettings);
  settingsForm.elements.periodType.addEventListener('change', togglePeriodStart);
  $('#erase-data').addEventListener('click', eraseAll);

  const exportForm = $('#export-form');
  exportForm.addEventListener('change', toggleCustomRange);
  exportForm.addEventListener('click', (e) => {
    const button = e.target.closest('[data-export]');
    if (button) runExport(button.dataset.export, button);
  });

  const welcome = $('#welcome');
  welcome.addEventListener('cancel', (e) => e.preventDefault()); // must tap "I understand"
  welcome.addEventListener('close', onWelcomeClosed);
}

function start() {
  bindEvents();
  document.addEventListener('backbutton', onBackButton, false);
  renderPeriod();
  show('period');
  if (!state.acceptedDisclaimer) $('#welcome').showModal();
}

// In the Android app wait for Cordova; in a plain browser start straight away.
if (window.cordova) document.addEventListener('deviceready', start, { once: true });
else start();
