// Builds CSV/PDF exports and hands them to the Android share sheet (or a download in browsers).
import {
  RATE_TYPES, RATE_LABELS, calculateShift, summarize, decimalHours, formatMoney, toIsoLocal,
} from './calc.js';

const cents = (value) => (value / 100).toFixed(2);

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // stop spreadsheets running formulas
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(shifts, settings) {
  const { currency } = settings;
  const rows = [[
    'Date', 'Rate type', 'Start', 'End', 'Unpaid break (min)', 'Paid hours',
    `Hourly rate (${currency})`, `Estimated pay (${currency})`, 'Note',
  ]];
  for (const shift of shifts) {
    const r = calculateShift(shift, settings);
    rows.push([
      shift.date, RATE_LABELS[r.rateType], shift.start, shift.end, shift.breakMinutes,
      decimalHours(r.paidMinutes), cents(r.rateCents), cents(r.payCents), shift.note,
    ]);
  }
  const totals = summarize(shifts, settings);
  rows.push([]);
  rows.push(['Total', '', '', '', '', decimalHours(totals.paidMinutes), '', cents(totals.payCents), `${totals.count} shifts`]);
  rows.push(['Estimate only - not payroll or tax advice.']);
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

// jsPDF's built-in fonts only cover Latin-1, so swap anything else for a safe character.
function pdfSafe(text) {
  return String(text).replace(/[\u00A0\u202F]/g, ' ').replace(/[^\x20-\x7E\u00A1-\u00FF]/g, '?');
}

export function buildPdf(shifts, settings, range) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const money = (value) => pdfSafe(formatMoney(value, settings.currency, { code: true }));
  const columns = [
    ['Date', 14], ['Type', 40], ['Time', 62], ['Break', 92], ['Paid hrs', 110], ['Rate', 132], ['Est. pay', 196, 'right'],
  ];
  let y = 20;

  const tableHeader = () => {
    doc.setFont('helvetica', 'bold').setFontSize(10);
    for (const [label, x, align = 'left'] of columns) doc.text(label, x, y, { align });
    doc.setLineWidth(0.2).line(14, y + 2, 196, y + 2);
    doc.setFont('helvetica', 'normal');
    y += 8;
  };

  doc.setFont('helvetica', 'bold').setFontSize(16).text('ShiftPay - earnings estimate', 14, y);
  y += 7;
  doc.setFont('helvetica', 'normal').setFontSize(10)
    .text(`Dates: ${range.start} to ${range.end}    Generated: ${toIsoLocal()}`, 14, y);
  y += 10;
  tableHeader();

  for (const shift of shifts) {
    if (y > 270) { doc.addPage(); y = 20; tableHeader(); }
    const r = calculateShift(shift, settings);
    const cells = [
      shift.date, RATE_LABELS[r.rateType], `${shift.start}-${shift.end}`, `${shift.breakMinutes}m`,
      decimalHours(r.paidMinutes), money(r.rateCents), money(r.payCents),
    ];
    doc.setFontSize(10);
    cells.forEach((text, i) => doc.text(text, columns[i][1], y, { align: columns[i][2] ?? 'left' }));
    y += 5;
    if (shift.note) {
      doc.setFontSize(8).setTextColor(110).text(pdfSafe(shift.note), 40, y).setTextColor(0);
      y += 4;
    }
    y += 1;
  }

  const totals = summarize(shifts, settings);
  if (y > 240) { doc.addPage(); y = 20; }
  doc.line(14, y, 196, y);
  y += 8;
  doc.setFont('helvetica', 'bold').setFontSize(12)
    .text(`Total: ${totals.count} shifts, ${decimalHours(totals.paidMinutes)} paid hours`, 14, y)
    .text(money(totals.payCents), 196, y, { align: 'right' });
  y += 8;
  doc.setFont('helvetica', 'normal').setFontSize(10);
  for (const type of RATE_TYPES) {
    const part = totals.byType[type];
    if (!part.paidMinutes) continue;
    doc.text(`${RATE_LABELS[type]}: ${decimalHours(part.paidMinutes)} h`, 14, y)
      .text(money(part.payCents), 196, y, { align: 'right' });
    y += 6;
  }
  y += 6;
  const disclaimer = 'Estimate only. ShiftPay is not payroll software and does not provide tax, legal or financial '
    + 'advice. Actual pay may differ because of tax, pension/superannuation, penalty rates, allowances and rounding.';
  doc.setFontSize(8).setTextColor(110).text(doc.splitTextToSize(disclaimer, 182), 14, y);
  return doc;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function deliverFile(filename, blob) {
  const sharing = window.plugins?.socialsharing;
  if (sharing) {
    // "df:<name>;" tells the plugin which filename to give the shared data URI
    const dataUrl = await blobToDataUrl(blob);
    await new Promise((resolve, reject) => sharing.shareWithOptions(
      { files: [`df:${filename};${dataUrl}`], subject: filename, chooserTitle: 'Save or share your export' },
      resolve,
      reject,
    ));
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportCsv(shifts, settings, range) {
  const blob = new Blob([buildCsv(shifts, settings)], { type: 'text/csv' });
  await deliverFile(`shiftpay_${range.start}_${range.end}.csv`, blob);
}

export async function exportPdf(shifts, settings, range) {
  if (!window.jspdf) throw new Error('PDF library not loaded');
  const blob = buildPdf(shifts, settings, range).output('blob');
  await deliverFile(`shiftpay_${range.start}_${range.end}.pdf`, blob);
}
