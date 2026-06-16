import { useState, useEffect, useMemo, useRef } from "react";
import { Search, Check, Copy, X, Save, Upload, ChevronDown, ChevronRight, Trash2, RefreshCw, Lock } from "lucide-react";

// === Set this, and set the SAME value as ROSTER_TOKEN in Vercel env vars ===
const PASSCODE = "CMDINTERN2026";

const PERIODS = {
  "Period 1": "Period 1 - 2 Mar - 22 May 2026",
  "Period 2": "Period 2 - 25 May - 14 Aug 2026",
  "Period 3": "Period 3 - 31 Aug - 20 Nov 2026",
  "Period 4": "Period 4 - 23 Nov 2026 - 12 Feb 2027",
};
const STORE_KEY = "roster:v1";

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + "th";
  return n + (["th","st","nd","rd"][n % 10] || "th");
}
function fmtDeadline(iso) {
  if (!iso) return "[date]";
  const d = new Date(iso + "T00:00:00");
  return `${ordinal(d.getDate())} ${d.toLocaleString("en-GB",{month:"long"})} ${d.getFullYear()}`;
}
const esc = s => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const keyOf = s => s.admin || s.name;

function parseHtmlTable(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  const rows = Array.from(table.querySelectorAll("tr")).map(tr =>
    Array.from(tr.querySelectorAll("td,th")).map(td => ({
      text: (td.textContent || "").replace(/\s+/g, " ").trim(),
      href: td.querySelector("a")?.getAttribute("href") || "",
    }))
  );
  return rows.filter(r => r.some(c => c.text || c.href));
}
function parseTsv(text) {
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => l.split("\t").map(t => ({ text: t.trim(), href: "" })));
}
const ADMIN_RE = /^\d{6}[a-z]$/i, MOBILE_RE = /^\+?\d[\d ]{6,}$/;
const lv = c => c.href || (/^https?:\/\//i.test(c.text) ? c.text : "");
function argmax(a) { let m = 0, idx = -1; a.forEach((v,i) => { if (v > m) { m = v; idx = i; } }); return idx; }
function inferColumns(rows) {
  const cols = Math.max(...rows.map(r => r.length));
  const count = test => Array.from({length: cols}, (_, c) => rows.filter(r => r[c] && test(r[c].text)).length);
  const adminCol = argmax(count(t => ADMIN_RE.test(t)));
  const emailCol = argmax(count(t => t.includes("@")));
  const mobileCol = argmax(count(t => MOBILE_RE.test(t.replace(/\s/g,"")) && !ADMIN_RE.test(t)));
  const nameCounts = count(t => /[a-z]{2,}[\s,]+[a-z]/i.test(t) && !t.includes("@"));
  [adminCol, emailCol, mobileCol].forEach(i => { if (i >= 0) nameCounts[i] = 0; });
  const nameCol = argmax(nameCounts);
  const linkCols = [];
  for (let c = 0; c < cols; c++) if (rows.some(r => r[c] && r[c].href)) linkCols.push(c);
  return { name: nameCol, admin: adminCol, mobile: mobileCol, email: emailCol,
    portfolio: linkCols[0] ?? -1, showreel: linkCols[1] ?? -1, resume: linkCols[2] ?? -1 };
}
function buildRoster(rows) {
  if (!rows || !rows.length) return [];
  const head = rows[0].map(c => c.text.toLowerCase());
  const hasHeader = head.some(h => h.includes("name")) && head.some(h => h.includes("admin"));
  let map, data;
  if (hasHeader) {
    const f = (...k) => head.findIndex(h => k.some(x => h.includes(x)));
    map = { name: f("name"), admin: f("admin"), mobile: f("mobile","phone"), email: f("email"),
      portfolio: f("behance","portfolio","website"), showreel: f("showreel","reel"), resume: f("resume","cv") };
    data = rows.slice(1);
  } else { map = inferColumns(rows); data = rows; }
  const get = (r, i) => (i >= 0 && r[i]) ? r[i] : { text: "", href: "" };
  return data.map(r => {
    const name = get(r, map.name).text;
    if (!name || /^name$/i.test(name)) return null;
    return {
      name, admin: get(r, map.admin).text, mobile: get(r, map.mobile).text, email: get(r, map.email).text,
      portfolio: lv(get(r, map.portfolio)) || get(r, map.portfolio).text || "",
      showreel: lv(get(r, map.showreel)), resume: lv(get(r, map.resume)),
    };
  }).filter(Boolean);
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [token, setToken] = useState("");
  const [authError, setAuthError] = useState("");

  const [roster, setRoster] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [append, setAppend] = useState(false);
  const [importNote, setImportNote] = useState("");
  const dropRef = useRef(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [contact, setContact] = useState("");
  const [company, setCompany] = useState("");
  const [period, setPeriod] = useState("Period 3");
  const [deadline, setDeadline] = useState("");
  const [includeLabel, setIncludeLabel] = useState(true);
  const [copied, setCopied] = useState("");

  async function loadRoster(tok) {
    let got = false;
    try {
      const r = await fetch(`/api/roster?token=${encodeURIComponent(tok)}`);
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data) && data.length) { setRoster(data); got = true; }
      }
    } catch (e) {}
    if (!got) {
      try {
        const res = await window.storage.get(STORE_KEY);
        if (res && res.value) setRoster(JSON.parse(res.value));
      } catch (e) {}
    }
    setLoaded(true);
  }

  useEffect(() => { if (unlocked) loadRoster(token); }, [unlocked]);
  useEffect(() => { if (loaded && roster.length === 0) setShowImport(true); }, [loaded]);

  function submitCode() {
    if (codeInput.trim() === PASSCODE) { setToken(codeInput.trim()); setAuthError(""); setUnlocked(true); }
    else setAuthError("Incorrect passcode.");
  }

  async function persist(next) {
    setRoster(next);
    try { await window.storage.set(STORE_KEY, JSON.stringify(next)); } catch (e) {}
  }

  async function syncFromSheets() {
    setImportNote("Syncing from Google Sheets...");
    try {
      const r = await fetch(`/api/roster?token=${encodeURIComponent(token)}`);
      if (!r.ok) throw new Error("status " + r.status);
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) throw new Error("no rows");
      await persist(data);
      const noLink = data.filter(s => !s.showreel || !s.resume).length;
      setImportNote(`Synced ${data.length} students from Sheets. ${noLink ? noLink + " missing a showreel/resume link." : "All links captured."}`);
      setShowImport(false);
    } catch (e) {
      setImportNote("Live sync runs on the deployed version (not in this preview). Paste below instead.");
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const rows = html ? parseHtmlTable(html) : parseTsv(text);
    const parsed = rows ? buildRoster(rows) : [];
    if (!parsed.length) { setImportNote("Could not read any rows. Copy the student rows from the sheet (including the header) and paste again."); return; }
    let next;
    if (append) {
      const byKey = Object.fromEntries(roster.map(s => [keyOf(s), s]));
      parsed.forEach(s => { byKey[keyOf(s)] = s; });
      next = Object.values(byKey);
    } else next = parsed;
    persist(next);
    const noLink = parsed.filter(s => !s.showreel || !s.resume).length;
    setImportNote(`Imported ${parsed.length} student${parsed.length>1?"s":""}. ${noLink ? noLink + " missing a showreel/resume link." : "All links captured."}`);
    if (dropRef.current) dropRef.current.innerHTML = "";
    setShowImport(false);
  }

  function updateStudent(key, field, val) {
    persist(roster.map(s => keyOf(s) === key ? { ...s, [field]: val } : s));
  }
  function clearAll() { if (confirm("Clear the whole roster?")) { persist([]); setSelected([]); } }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(r => r.name.toLowerCase().includes(q) || (r.admin||"").toLowerCase().includes(q));
  }, [query, roster]);

  function toggle(key) { setSelected(sel => sel.includes(key) ? sel.filter(k => k !== key) : [...sel, key]); }

  const rows = selected.map(k => roster.find(s => keyOf(s) === k)).filter(Boolean);
  const periodText = PERIODS[period];
  const deadlineText = fmtDeadline(deadline);
  const greeting = contact.trim() || "[Contact]";

  function linkCell(label, url) {
    return url ? `<a href="${esc(url)}" style="color:#1155cc;">${label}</a>` : `<span style="color:#b00;">${label} (link missing)</span>`;
  }
  function buildHtml() {
    const trs = rows.map(s => `
      <tr>
        <td style="border:1px solid #444;padding:6px 12px;font-weight:bold;">${esc(s.name)}</td>
        <td style="border:1px solid #444;padding:6px 12px;">${esc(s.mobile)}</td>
        <td style="border:1px solid #444;padding:6px 12px;">${linkCell("Portfolio", s.portfolio)}</td>
        <td style="border:1px solid #444;padding:6px 12px;">${linkCell("Showreel", s.showreel)}</td>
        <td style="border:1px solid #444;padding:6px 12px;">${linkCell("Resume", s.resume)}</td>
      </tr>`).join("");
    const label = includeLabel ? `<div>Official (Closed) and Sensitive-Normal</div><br>` : "";
    return `<div style="font-family:Calibri,Arial,sans-serif;font-size:14px;color:#222;">
${label}<div>Dear ${esc(greeting)},</div><br>
<div>Thanks for supporting our Internship Programme for CMD students.</div><br>
<div>We&rsquo;re assigning the following student/s for <b>${esc(periodText)}</b>.</div><br>
<table style="border-collapse:collapse;">${trs}</table><br>
<div>Do have a quick chat with the allocated intern/s to share the company&rsquo;s workflow, set expectations, and clear questions.</div><br>
<div>Please confirm the placement by <b>${esc(deadlineText)}</b> so we can finalise the allocation, thank you.</div><br>
<div><b>Shawn Yeo</b><br>Senior Lecturer | School of Design and Media</div></div>`;
  }
  function buildText() {
    const tbl = rows.map(s => `${s.name}\n  Mobile: ${s.mobile}\n  Portfolio: ${s.portfolio||"[missing]"}\n  Showreel: ${s.showreel||"[missing]"}\n  Resume: ${s.resume||"[missing]"}`).join("\n\n");
    const label = includeLabel ? "Official (Closed) and Sensitive-Normal\n\n" : "";
    return `${label}Dear ${greeting},

Thanks for supporting our Internship Programme for CMD students.

We're assigning the following student/s for ${periodText}.

${tbl}

Do have a quick chat with the allocated intern/s to share the company's workflow, set expectations, and clear questions.

Please confirm the placement by ${deadlineText} so we can finalise the allocation, thank you.

Shawn Yeo
Senior Lecturer | School of Design and Media`;
  }
  async function copyRich() {
    const html = buildHtml(), text = buildText();
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      setCopied("rich");
    } catch (e) { try { await navigator.clipboard.writeText(text); setCopied("rich"); } catch (e2) { setCopied("err"); } }
    setTimeout(() => setCopied(""), 1800);
  }
  async function copyPlain() {
    try { await navigator.clipboard.writeText(buildText()); setCopied("plain"); } catch (e) { setCopied("err"); }
    setTimeout(() => setCopied(""), 1800);
  }
  const missingLinks = rows.some(s => !s.portfolio || !s.showreel || !s.resume);

  if (!unlocked) {
    return (
      <div className="min-h-[420px] flex items-center justify-center p-6">
        <div className="w-full max-w-sm border rounded-xl p-6 text-center">
          <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-3"><Lock size={18} className="text-slate-500"/></div>
          <h1 className="font-bold text-lg">Intern Placement Generator</h1>
          <p className="text-slate-500 text-sm mt-1 mb-4">Enter the passcode to continue.</p>
          <input type="password" value={codeInput} autoFocus
            onChange={e => setCodeInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitCode()}
            placeholder="Passcode"
            className="w-full border rounded px-3 py-2 text-center mb-2" />
          {authError && <p className="text-red-600 text-xs mb-2">{authError}</p>}
          <button onClick={submitCode} className="w-full bg-blue-600 text-white rounded px-3 py-2 hover:bg-blue-700">Unlock</button>
          <p className="text-[11px] text-slate-400 mt-3">For NYP internship allocation use only. Contains student contact details.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-5 text-sm text-slate-800">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold">Intern Placement Email Generator</h1>
        <span className="text-xs text-slate-400">{roster.length} students loaded</span>
      </div>
      <p className="text-slate-500 mb-4">Your sheet is the source of truth. Sync or import once per cohort, then generate emails.</p>

      <div className="border rounded-lg mb-4">
        <button onClick={() => setShowImport(v => !v)} className="w-full flex items-center justify-between px-3 py-2 font-medium">
          <span className="flex items-center gap-2"><Upload size={16}/> Import / refresh roster</span>
          {showImport ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
        </button>
        {showImport && (
          <div className="px-3 pb-3 space-y-2">
            <button onClick={syncFromSheets} className="flex items-center gap-1 text-xs bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700"><RefreshCw size={13}/> Sync from Google Sheets</button>
            <p className="text-[11px] text-slate-400">Live sync runs on the deployed version. In this preview, use paste below.</p>
            <ol className="text-xs text-slate-600 list-decimal ml-4 space-y-0.5">
              <li>In the CMD_2024 Motion or Comms sheet, select the rows (include the header row with Name, Admin, Behance, Showreel, Resume).</li>
              <li>Copy, then click the box below and paste. Hyperlink URLs come through automatically.</li>
            </ol>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={append} onChange={e => setAppend(e.target.checked)} />
              Add to existing roster (tick this when pasting the second sheet)
            </label>
            <div ref={dropRef} contentEditable suppressContentEditableWarning onPaste={handlePaste}
              className="min-h-[64px] border-2 border-dashed rounded p-3 text-slate-400 focus:outline-blue-400 focus:border-blue-400">Paste sheet rows here</div>
            {importNote && <p className="text-xs text-slate-700">{importNote}</p>}
            {roster.length > 0 && (
              <button onClick={clearAll} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"><Trash2 size={13}/> Clear roster</button>
            )}
          </div>
        )}
      </div>

      {roster.length === 0 ? (
        <div className="text-center text-slate-400 py-10 border rounded-lg">No roster yet. Open “Import / refresh roster” above.</div>
      ) : (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Search size={16} className="text-slate-400" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or admin no." className="w-full outline-none border-b py-1" />
            </div>
            <div className="h-64 overflow-y-auto pr-1">
              {filtered.map(r => {
                const k = keyOf(r), on = selected.includes(k);
                return (
                  <button key={k} onClick={() => toggle(k)} className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between mb-0.5 ${on ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                    <span><span className="font-medium">{r.name}</span><span className="text-slate-400 ml-2 text-xs">{r.admin}</span></span>
                    {on && <Check size={15} className="text-blue-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border rounded-lg p-3 space-y-3">
            <div>
              <label className="block text-xs text-slate-500 mb-0.5">Company</label>
              <input value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Rewind Networks" className="w-full border rounded px-2 py-1" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-0.5">Contact name (greeting)</label>
              <input value={contact} onChange={e => setContact(e.target.value)} placeholder="e.g. Kif" className="w-full border rounded px-2 py-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-0.5">Period</label>
                <select value={period} onChange={e => setPeriod(e.target.value)} className="w-full border rounded px-2 py-1">
                  {Object.keys(PERIODS).map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-0.5">Confirm-by date</label>
                <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full border rounded px-2 py-1" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={includeLabel} onChange={e => setIncludeLabel(e.target.checked)} />
              Include "Official (Closed) and Sensitive-Normal" line
            </label>
            {company && <div className="text-xs text-slate-500 border-t pt-2">Suggested subject: <span className="text-slate-700">CMD Internship Placement – {company} – {period}</span></div>}
          </div>
        </div>

        {rows.length > 0 && (
          <div className="mt-4 space-y-3">
            <h2 className="font-semibold">Selected student/s ({rows.length})</h2>
            {rows.map(s => {
              const k = keyOf(s);
              return (
                <div key={k} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium">{s.name} <span className="text-slate-400 text-xs">{s.admin}</span></div>
                    <button onClick={() => toggle(k)} className="text-slate-400 hover:text-red-500"><X size={16}/></button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Field label="Mobile" val={s.mobile} on={v => updateStudent(k,"mobile",v)} />
                    <Field label="Email" val={s.email} on={v => updateStudent(k,"email",v)} />
                    <Field label="Portfolio URL" val={s.portfolio} on={v => updateStudent(k,"portfolio",v)} warn={!s.portfolio} />
                    <Field label="Showreel URL" val={s.showreel} on={v => updateStudent(k,"showreel",v)} warn={!s.showreel} />
                    <Field label="Resume URL" val={s.resume} on={v => updateStudent(k,"resume",v)} warn={!s.resume} />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Edits apply to this session. For lasting fixes, update the Sheet.</p>
                </div>
              );
            })}
          </div>
        )}

        {rows.length > 0 && (
          <div className="mt-4 border rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Email preview</h2>
              <div className="flex gap-2">
                <button onClick={copyRich} className="flex items-center gap-1 bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700"><Copy size={14}/> {copied==="rich"?"Copied":"Copy for Outlook"}</button>
                <button onClick={copyPlain} className="flex items-center gap-1 border rounded px-3 py-1.5 hover:bg-slate-50"><Copy size={14}/> {copied==="plain"?"Copied":"Plain text"}</button>
              </div>
            </div>
            {missingLinks && <p className="text-xs text-red-600 mb-2">Some links are missing. Paste them into the fields above, or fix the hyperlink in the Sheet and re-sync.</p>}
            <div className="bg-slate-50 border rounded p-3" dangerouslySetInnerHTML={{ __html: buildHtml() }} />
          </div>
        )}
      </>
      )}
    </div>
  );
}

function Field({ label, val, on, warn }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-0.5">{label}</label>
      <input value={val || ""} onChange={e => on(e.target.value)} className={`w-full border rounded px-2 py-1 ${warn ? "border-red-300 bg-red-50" : ""}`} />
    </div>
  );
}