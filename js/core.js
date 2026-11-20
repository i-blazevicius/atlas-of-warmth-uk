// Shared helpers: errors, small problems, and reading CSV files.
// createCore(CONFIG) returns the shared state and functions.
export function createCore(CONFIG) {
  const state = {
    problems: [],         // small things the map could not use; listed in the control panel
  };
  const problem = (text) => { if (!state.problems.includes(text)) state.problems.push(text); console.warn(text); };

  // An error with a short code and a plain explanation; the page shows it as "E3 · …".
  function fail(code, text) {
    const err = new Error(text);
    err.code = code;
    return err;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Find the file's header for each wanted column: exact match first (ignoring case), then "starts with".
  // Columns are always found by header text, never by position.
  function resolveColumns(headers, wanted) {
    const out = {};
    for (const [key, label] of Object.entries(wanted)) {
      const l = label.toLowerCase();
      out[key] = headers.find((h) => h.trim().toLowerCase() === l)
        ?? headers.find((h) => h.trim().toLowerCase().startsWith(l))
        ?? null;
    }
    return out;
  }

  // Reads a CSV from a link (a published Google Sheet tab) or a file in the repository.
  // name: what to call it in error messages, e.g. 'IMD England'.
  async function loadCSV(url, name = 'file') {
    let res;
    try { res = await fetch(url, { cache: 'no-store' }); } catch {
      throw fail('E2', `Could not reach ${name}. Check the internet connection, then its link in js/config.js → data.`);
    }
    if (!res.ok) throw fail('E2', `${name} answered ${res.status}. Check its link in js/config.js → data.`);
    const text = await res.text();
    // An unpublished or private Google Sheet answers with a web page (sign-in or error) instead of CSV.
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw fail('E3', `${name} did not come back as data. If it is a Google Sheet, it is probably no longer published: in Google Sheets use File → Share → Publish to web.`);
    }
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
    return { rows: parsed.data, headers: parsed.meta.fields ?? [] };
  }

  return { state, problem, fail, esc, resolveColumns, loadCSV };
}
