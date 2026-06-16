const { google } = require("googleapis");

// === Update these two tab names when a new cohort starts. Only annual edit. ===
const SHEET_ID = "1c3x6E2CI5TJ7VILiNmmimjstfaeBVv4_Cic8YoJSzVQ";
const TABS = ["CMD_2024 Motion", "CMD_2024 Comms"];

module.exports = async (req, res) => {
  // Passcode gate: must match the ROSTER_TOKEN env var (same value as PASSCODE in the app).
  if (process.env.ROSTER_TOKEN && req.query.token !== process.env.ROSTER_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const resp = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      ranges: TABS.map(t => `${t}!A1:Z300`),
      includeGridData: true,
      fields: "sheets(data(rowData(values(formattedValue,hyperlink))))",
    });

    const all = [];
    for (const sheet of resp.data.sheets || []) {
      const grid = sheet.data?.[0]?.rowData || [];
      const rows = grid.map(r => (r.values || []).map(c => ({
        text: (c.formattedValue || "").trim(),
        href: c.hyperlink || "",
      })));
      all.push(...buildRoster(rows));
    }
    const byKey = {};
    for (const s of all) byKey[s.admin || s.name] = s;
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(Object.values(byKey));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

const ADMIN_RE = /^\d{6}[a-z]$/i, MOBILE_RE = /^\+?\d[\d ]{6,}$/;
const lv = c => c.href || (/^https?:\/\//i.test(c.text) ? c.text : "");
function argmax(a){let m=0,i=-1;a.forEach((v,j)=>{if(v>m){m=v;i=j;}});return i;}
function inferColumns(rows){
  const cols = Math.max(...rows.map(r=>r.length));
  const count = t => Array.from({length:cols},(_,c)=>rows.filter(r=>r[c]&&t(r[c].text)).length);
  const admin=argmax(count(t=>ADMIN_RE.test(t)));
  const email=argmax(count(t=>t.includes("@")));
  const mobile=argmax(count(t=>MOBILE_RE.test(t.replace(/\s/g,""))&&!ADMIN_RE.test(t)));
  const nc=count(t=>/[a-z]{2,}[\s,]+[a-z]/i.test(t)&&!t.includes("@"));
  [admin,email,mobile].forEach(i=>{if(i>=0)nc[i]=0;});
  const name=argmax(nc);
  const links=[];for(let c=0;c<cols;c++)if(rows.some(r=>r[c]&&r[c].href))links.push(c);
  return {name,admin,mobile,email,portfolio:links[0]??-1,showreel:links[1]??-1,resume:links[2]??-1};
}
function buildRoster(rows){
  if(!rows.length) return [];
  const head = rows[0].map(c=>c.text.toLowerCase());
  const hasHeader = head.some(h=>h.includes("name")) && head.some(h=>h.includes("admin"));
  const f = (...k)=>head.findIndex(h=>k.some(x=>h.includes(x)));
  const map = hasHeader ? {
    name:f("name"), admin:f("admin"), mobile:f("mobile","phone"), email:f("email"),
    portfolio:f("behance","portfolio","website"), showreel:f("showreel","reel"), resume:f("resume","cv"),
  } : inferColumns(rows);
  const data = hasHeader ? rows.slice(1) : rows;
  const get = (r,i)=>(i>=0&&r[i])?r[i]:{text:"",href:""};
  const out=[];
  for(const r of data){
    const name=get(r,map.name).text;
    if(!name||/^name$/i.test(name)) continue;
    out.push({
      name, admin:get(r,map.admin).text, mobile:get(r,map.mobile).text, email:get(r,map.email).text,
      portfolio:lv(get(r,map.portfolio))||get(r,map.portfolio).text||"",
      showreel:lv(get(r,map.showreel)), resume:lv(get(r,map.resume)),
    });
  }
  return out;
}