import { useState, useEffect, useMemo, useRef } from "react";
import { Search, Check, Copy, X, Upload, ChevronDown, ChevronRight, Trash2, RefreshCw, Lock } from "lucide-react";

// === Set this, and set the SAME value as ROSTER_TOKEN in Vercel env vars ===
const PASSCODE = "CMDINTERN2026";

const PERIODS = {
  "Period 1": "Period 1 - 2 Mar - 22 May 2026",
  "Period 2": "Period 2 - 25 May - 14 Aug 2026",
  "Period 3": "Period 3 - 31 Aug - 20 Nov 2026",
  "Period 4": "Period 4 - 23 Nov 2026 - 12 Feb 2027",
};
const STORE_KEY = "roster:v1";
const STEPS = ["Students", "Company", "Review", "Email"];

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

  const [step, setStep] = useState(0);
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
      if (r.ok) { const data = await r.json(); if (Array.isArray(data) && data.length) { setRoster(data); got = true; } }
    } catch (e) {}
    if (!got) {
      try { const res = await window.storage.get(STORE_KEY); if (res && res.value) setRoster(JSON.parse(res.value)); } catch (e) {}
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
      setImportNote(`Synced ${data.length} students. ${noLink ? noLink + " missing a showreel/resume link." : "All links captured."}`);
      setShowImport(false);
    } catch (e) {
      setImportNote("Live sync runs on the deployed version (not in this preview). Paste below instead.");
    }
  }
  function handlePaste(e) {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const parsed = (html ? parseHtmlTable(html) : parseTsv(text)) ? buildRoster(html ? parseHtmlTable(html) : parseTsv(text)) : [];
    if (!parsed.length) { setImportNote("Could not read any rows. Copy the student rows (including the header) and paste again."); return; }
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
  function updateStudent(key, field, val) { persist(roster.map(s => keyOf(s) === key ? { ...s, [field]: val } : s)); }
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
    return url ? `<a href="${esc(url)}" style="color:#0d9488;">${label}</a>` : `<span style="color:#b00;">${label} (link missing)</span>`;
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
  const inputCls = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500";
  const labelCls = "block text-xs uppercase tracking-wide text-slate-400 font-medium mb-1";

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-teal-50 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center mb-4"><Lock size={20} className="text-teal-600"/></div>
          <h1 className="font-semibold text-lg text-slate-800">Intern Placement</h1>
          <p className="text-slate-400 text-sm mt-1 mb-5">Enter the passcode to continue.</p>
          <input type="password" value={codeInput} autoFocus
            onChange={e => setCodeInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitCode()}
            placeholder="Passcode" className={inputCls + " text-center mb-2"} />
          {authError && <p className="text-red-500 text-xs mb-2">{authError}</p>}
          <button onClick={submitCode} className="w-full bg-teal-600 text-white rounded-full px-4 py-2.5 text-sm font-medium hover:bg-teal-700 mt-1">Unlock</button>
          <p className="text-xs text-slate-400 mt-4">For NYP internship allocation. Contains student contact details.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-teal-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Intern Placement</h1>
            <p className="text-xs text-slate-400">{roster.length} students loaded</p>
          </div>
          <button onClick={() => setShowImport(v => !v)} className="flex items-center gap-1.5 text-sm text-teal-700 border border-teal-200 bg-white rounded-full px-4 py-2 hover:bg-teal-50">
            <Upload size={15}/> Manage roster {showImport ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
          </button>
        </div>

        {showImport && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 mb-4 space-y-3">
            <button onClick={syncFromSheets} className="flex items-center gap-1.5 text-sm bg-teal-600 text-white rounded-full px-4 py-2 hover:bg-teal-700"><RefreshCw size={14}/> Sync from Google Sheets</button>
            <p className="text-xs text-slate-400">Live sync runs on the deployed version. In this preview, paste below.</p>
            <ol className="text-xs text-slate-500 list-decimal ml-4 space-y-1">
              <li>In the Motion or Comms sheet, select the rows including the header (Name, Admin, Behance, Showreel, Resume).</li>
              <li>Copy, click the box below, and paste. Hyperlink URLs come through automatically.</li>
            </ol>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={append} onChange={e => setAppend(e.target.checked)} />
              Add to existing roster (tick when pasting the second sheet)
            </label>
            <div ref={dropRef} contentEditable suppressContentEditableWarning onPaste={handlePaste}
              style={{ minHeight: "64px" }}
              className="border-2 border-dashed border-slate-200 rounded-lg p-3 text-sm text-slate-400 focus:outline-none focus:border-teal-400">Paste sheet rows here</div>
            {importNote && <p className="text-xs text-slate-600">{importNote}</p>}
            {roster.length > 0 && <button onClick={clearAll} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"><Trash2 size={13}/> Clear roster</button>}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row overflow-hidden">
          {/* Stepper */}
          <div className="md:w-56 shrink-0 bg-slate-50 p-6 border-b md:border-b-0 md:border-r border-slate-100">
            <div className="flex md:flex-col gap-1">
              {STEPS.map((s, i) => {
                const done = i < step, active = i === step;
                return (
                  <div key={s} className="flex md:items-start items-center gap-3 flex-1 md:flex-none">
                    <div className="flex md:flex-col items-center">
                      <button onClick={() => setStep(i)}
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${active ? "bg-teal-600 text-white" : done ? "bg-teal-600 text-white" : "bg-slate-200 text-slate-500"}`}>
                        {done ? <Check size={14}/> : i + 1}
                      </button>
                      {i < STEPS.length - 1 && <div className={`hidden md:block w-px h-7 my-1 ${done ? "bg-teal-500" : "bg-slate-200"}`} />}
                    </div>
                    <button onClick={() => setStep(i)} className={`text-sm md:pt-1 text-left ${active ? "text-slate-800 font-medium" : done ? "text-slate-600" : "text-slate-400"}`}>{s}</button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 p-6 flex flex-col" style={{ minHeight: "440px" }}>
            {roster.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center text-slate-400 text-sm">
                No roster yet. Click <span className="text-teal-700 font-medium mx-1">Manage roster</span> above to sync or paste your cohort.
              </div>
            ) : (
              <>
                {step === 0 && (
                  <div>
                    <p className={labelCls}>Step 1</p>
                    <h2 className="text-lg font-semibold text-slate-800 mb-3">Select student/s</h2>
                    <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 mb-3">
                      <Search size={16} className="text-slate-400" />
                      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or admin no." className="w-full outline-none text-sm" />
                    </div>
                    <div className="h-64 overflow-y-auto pr-1 -mr-1">
                      {filtered.map(r => {
                        const k = keyOf(r), on = selected.includes(k);
                        return (
                          <button key={k} onClick={() => toggle(k)}
                            className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between mb-1 border ${on ? "bg-teal-50 border-teal-200" : "border-transparent hover:bg-slate-50"}`}>
                            <span className="text-sm"><span className="font-medium text-slate-700">{r.name}</span><span className="text-slate-400 ml-2 text-xs">{r.admin}</span></span>
                            {on && <Check size={15} className="text-teal-600 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-400 mt-3">{selected.length} selected</p>
                  </div>
                )}

                {step === 1 && (
                  <div>
                    <p className={labelCls}>Step 2</p>
                    <h2 className="text-lg font-semibold text-slate-800 mb-4">Company details</h2>
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div><label className={labelCls}>Company</label><input value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Rewind Networks" className={inputCls} /></div>
                        <div><label className={labelCls}>Contact name</label><input value={contact} onChange={e => setContact(e.target.value)} placeholder="e.g. Kif" className={inputCls} /></div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div><label className={labelCls}>Period</label>
                          <select value={period} onChange={e => setPeriod(e.target.value)} className={inputCls}>{Object.keys(PERIODS).map(p => <option key={p}>{p}</option>)}</select>
                        </div>
                        <div><label className={labelCls}>Confirm-by date</label><input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className={inputCls} /></div>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input type="checkbox" checked={includeLabel} onChange={e => setIncludeLabel(e.target.checked)} />
                        Include "Official (Closed) and Sensitive-Normal" line
                      </label>
                      {company && <div className="text-xs text-slate-400 border-t border-slate-100 pt-3">Suggested subject: <span className="text-slate-600">CMD Internship Placement – {company} – {period}</span></div>}
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div>
                    <p className={labelCls}>Step 3</p>
                    <h2 className="text-lg font-semibold text-slate-800 mb-4">Review details</h2>
                    {rows.length === 0 ? (
                      <p className="text-sm text-slate-400">No students selected. Go back to step 1.</p>
                    ) : (
                      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                        {rows.map(s => {
                          const k = keyOf(s);
                          return (
                            <div key={k} className="border border-slate-150 rounded-xl p-4">
                              <div className="flex items-center justify-between mb-2">
                                <div className="font-medium text-slate-700 text-sm">{s.name} <span className="text-slate-400 text-xs">{s.admin}</span></div>
                                <button onClick={() => toggle(k)} className="text-slate-300 hover:text-red-500"><X size={16}/></button>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <Field label="Mobile" val={s.mobile} on={v => updateStudent(k,"mobile",v)} />
                                <Field label="Email" val={s.email} on={v => updateStudent(k,"email",v)} />
                                <Field label="Portfolio URL" val={s.portfolio} on={v => updateStudent(k,"portfolio",v)} warn={!s.portfolio} />
                                <Field label="Showreel URL" val={s.showreel} on={v => updateStudent(k,"showreel",v)} warn={!s.showreel} />
                                <Field label="Resume URL" val={s.resume} on={v => updateStudent(k,"resume",v)} warn={!s.resume} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {step === 3 && (
                  <div>
                    <p className={labelCls}>Step 4</p>
                    <h2 className="text-lg font-semibold text-slate-800 mb-3">Email</h2>
                    {rows.length === 0 ? (
                      <p className="text-sm text-slate-400">No students selected. Go back to step 1.</p>
                    ) : (
                      <>
                        {missingLinks && <p className="text-xs text-red-500 mb-2">Some links are missing. Add them in step 3, or fix the Sheet and re-sync.</p>}
                        <div className="border border-slate-150 rounded-xl p-4 bg-slate-50 max-h-96 overflow-y-auto" dangerouslySetInnerHTML={{ __html: buildHtml() }} />
                      </>
                    )}
                  </div>
                )}

                {/* Nav */}
                <div className="mt-auto pt-6 flex items-center justify-between">
                  <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}
                    className={`text-sm px-5 py-2.5 rounded-full ${step === 0 ? "text-slate-300" : "text-slate-600 hover:bg-slate-100"}`}>Back</button>
                  {step < 3 ? (
                    <button onClick={() => setStep(s => Math.min(3, s + 1))} disabled={step === 0 && selected.length === 0}
                      className={`text-sm font-medium px-6 py-2.5 rounded-full ${step === 0 && selected.length === 0 ? "bg-slate-200 text-slate-400" : "bg-teal-600 text-white hover:bg-teal-700"}`}>Next</button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={copyPlain} className="text-sm border border-slate-200 rounded-full px-4 py-2.5 hover:bg-slate-50 flex items-center gap-1"><Copy size={14}/> {copied==="plain"?"Copied":"Plain text"}</button>
                      <button onClick={copyRich} className="text-sm font-medium bg-teal-600 text-white rounded-full px-5 py-2.5 hover:bg-teal-700 flex items-center gap-1"><Copy size={14}/> {copied==="rich"?"Copied":"Copy for Outlook"}</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, val, on, warn }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slate-400 font-medium mb-1">{label}</label>
      <input value={val || ""} onChange={e => on(e.target.value)}
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none ${warn ? "border-red-300 bg-red-50 focus:border-red-400" : "border-slate-200 focus:border-teal-500"}`} />
    </div>
  );
}