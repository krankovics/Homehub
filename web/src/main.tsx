import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Torrent = {
  id: number; hashString: string; name: string; status: number; percentDone: number;
  rateDownload: number; rateUpload: number; eta: number;
};
type State = {
  snapshot: null | {
    timestamp: string;
    kd20: { online: boolean; torrents: Torrent[] };
    wd: { online: boolean; freeBytes: number; totalBytes: number; mediaRoot: string };
  };
  bridgeLastSeenAt: string | null;
  bridgeOnline: boolean;
  settings: { autoCopyEnabled: boolean; autoCopyDestination: string };
  copies: Record<string, { torrentName: string; destination: string; state: string; message?: string }>;
  recentCommands: Array<{ id: string; type: string; createdAt: string; completedAt?: string; ok?: boolean; message?: string }>;
};

const fmtBytes = (n: number) => {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i > 2 ? 2 : 1)} ${units[i]}`;
};
const fmtSpeed = (n: number) => `${fmtBytes(n)}/s`;
const fmtTime = (v?: string | null) => v ? new Date(v).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, init);
  if (r.status === 401) throw new Error("AUTH_REQUIRED");
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
  return body;
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      onDone();
    } catch (err) {
      setError(err instanceof Error && err.message === "too_many_attempts" ? "Túl sok sikertelen próbálkozás. Próbáld később." : "Hibás jelszó.");
    } finally { setBusy(false); }
  }

  return <main className="loginShell">
    <section className="loginCard">
      <div className="brandMark">H</div>
      <div className="eyebrow">HOME HUB</div>
      <h1>Belépés</h1>
      <p>A KD20 és a WD My Cloud kezelőfelülete.</p>
      <form onSubmit={submit}>
        <input type="password" autoFocus autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="HomeHub jelszó" />
        <button disabled={busy || !password}>{busy ? "Belépés…" : "Belépés"}</button>
      </form>
      {error && <div className="loginError">{error}</div>}
    </section>
  </main>;
}

function App() {
  const [auth, setAuth] = useState<"checking" | "yes" | "no">("checking");
  const [state, setState] = useState<State | null>(null);
  const [magnet, setMagnet] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function checkAuth() {
    const r = await fetch("/api/auth/status");
    const j = await r.json();
    setAuth(j.authenticated ? "yes" : "no");
  }

  async function load() {
    try {
      setState(await api("/api/state"));
      setAuth("yes");
    } catch (err) {
      if (err instanceof Error && err.message === "AUTH_REQUIRED") setAuth("no");
    }
  }

  useEffect(() => {
    checkAuth();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    if (auth !== "yes") return;
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [auth]);

  const torrents = state?.snapshot?.kd20.torrents || [];
  const totalDl = useMemo(() => torrents.reduce((a, t) => a + t.rateDownload, 0), [torrents]);
  const totalUl = useMemo(() => torrents.reduce((a, t) => a + t.rateUpload, 0), [torrents]);
  const wdUsed = state?.snapshot?.wd.totalBytes ? 1 - state.snapshot.wd.freeBytes / state.snapshot.wd.totalBytes : 0;

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  async function addMagnet(e: React.FormEvent) {
    e.preventDefault();
    if (!magnet.trim()) return;
    setBusy(true);
    try {
      await api("/api/torrents/magnet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ magnet }) });
      setMagnet(""); flash("Magnet link elküldve a KD20-nak.");
    } catch (err) { flash(`Hiba: ${err instanceof Error ? err.message : "ismeretlen"}`); }
    finally { setBusy(false); load(); }
  }

  async function addFile(file?: File) {
    if (!file) return;
    const fd = new FormData(); fd.append("torrent", file);
    setBusy(true);
    try { await api("/api/torrents/file", { method: "POST", body: fd }); flash(".torrent fájl elküldve a KD20-nak."); }
    catch (err) { flash(`Hiba: ${err instanceof Error ? err.message : "ismeretlen"}`); }
    finally { setBusy(false); load(); }
  }

  async function copy(t: Torrent) {
    try { await api(`/api/torrents/${t.id}/copy`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }); flash("Másolási feladat elküldve."); }
    catch (err) { flash(`Hiba: ${err instanceof Error ? err.message : "ismeretlen"}`); }
    load();
  }

  async function updateSettings(patch: Partial<State["settings"]>) {
    if (!state) return;
    const next = { ...state.settings, ...patch };
    try {
      await api("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      load();
    } catch (err) { flash(`Hiba: ${err instanceof Error ? err.message : "ismeretlen"}`); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setState(null); setAuth("no");
  }

  if (auth === "checking") return <main className="splash"><div className="brandMark">H</div><p>HomeHub betöltése…</p></main>;
  if (auth === "no") return <Login onDone={() => setAuth("yes")} />;

  return <main>
    {notice && <div className="toast">{notice}</div>}
    <header className="hero">
      <div>
        <div className="eyebrow">HOME HUB · NAS CORE</div>
        <h1>Otthoni tárhely és letöltések</h1>
        <p>KD20 torrentbox + WD My Cloud médiatár, egyetlen felületen.</p>
      </div>
      <div className="heroActions">
        <div className="live"><span className={state?.bridgeOnline ? "dot on" : "dot"}></span>{state?.bridgeOnline ? "Bridge online" : "Bridge offline"}</div>
        <button className="ghost" onClick={logout}>Kilépés</button>
      </div>
    </header>

    <section className="cards">
      <article className="card"><span>KD20</span><strong>{state?.bridgeOnline && state?.snapshot?.kd20.online ? "Online" : "Offline"}</strong><small>{torrents.length} torrent · ↓ {fmtSpeed(totalDl)} · ↑ {fmtSpeed(totalUl)}</small></article>
      <article className="card"><span>WD My Cloud</span><strong>{state?.bridgeOnline && state?.snapshot?.wd.online ? "Online" : "Offline"}</strong><small>{state?.snapshot ? `${fmtBytes(state.snapshot.wd.freeBytes)} szabad · ${Math.round(wdUsed * 100)}% foglalt` : "Nincs adat"}</small></article>
      <article className="card"><span>Automatikus másolás</span><strong>{state?.settings.autoCopyEnabled ? "Bekapcsolva" : "Kikapcsolva"}</strong><small>→ {state?.settings.autoCopyDestination || "Filmek"} · utolsó kapcsolat {fmtTime(state?.bridgeLastSeenAt)}</small></article>
    </section>

    <section className="panel add">
      <div><h2>Új torrent</h2><p>Magnet link vagy .torrent fájl.</p></div>
      <form onSubmit={addMagnet} className="magnet"><input value={magnet} onChange={e => setMagnet(e.target.value)} placeholder="magnet:?xt=urn:btih:…"/><button disabled={busy || !state?.bridgeOnline}>Hozzáadás</button></form>
      <label className={`filebtn ${!state?.bridgeOnline ? "disabled" : ""}`}>.torrent fájl<input disabled={!state?.bridgeOnline} type="file" accept=".torrent,application/x-bittorrent" onChange={e => addFile(e.target.files?.[0])}/></label>
    </section>

    <section className="panel">
      <div className="sectionHead"><div><h2>Torrentek</h2><p>A KD20 Transmission aktuális állapota.</p></div><button className="ghost" onClick={load}>Frissítés</button></div>
      <div className="torrentList">
        {torrents.length === 0 && <div className="empty">Még nincs torrent, vagy a Bridge nem küldött adatot.</div>}
        {torrents.map(t => <article className="torrent" key={t.hashString || t.id}>
          <div className="torrentTop"><div><strong>{t.name}</strong><span>{Math.round(t.percentDone * 100)}%</span></div><button onClick={() => copy(t)} disabled={t.percentDone < 1 || !state?.bridgeOnline}>Másolás WD-re</button></div>
          <div className="bar"><i style={{width: `${Math.max(1, t.percentDone * 100)}%`}}></i></div>
          <small>↓ {fmtSpeed(t.rateDownload)} · ↑ {fmtSpeed(t.rateUpload)} · ID {t.id}</small>
        </article>)}
      </div>
    </section>

    <section className="panel settings">
      <div><h2>Automatika</h2><p>A kész torrentet átmásolja, de a KD20-ról nem törli.</p></div>
      <label className="switch"><input type="checkbox" checked={state?.settings.autoCopyEnabled || false} onChange={e => updateSettings({ autoCopyEnabled: e.target.checked })}/><span></span> Automatikus másolás</label>
      <label>Célmappa a WD-n<input value={state?.settings.autoCopyDestination || ""} onChange={e => setState(s => s ? ({...s, settings: {...s.settings, autoCopyDestination: e.target.value}}) : s)} onBlur={e => updateSettings({ autoCopyDestination: e.target.value })}/></label>
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
