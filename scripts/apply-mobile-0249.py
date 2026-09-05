from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(text, encoding="utf-8")


def must_replace(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing marker: {label}")
    return text.replace(old, new, 1)


# --- React app: native Notifications tab + native push test -----------------
path = "web/src/main.tsx"
s = read(path)
s = must_replace(
    s,
    'type Tab = "overview"|"people"|"timeline"|"downloads"|"media"|"smart"|"actions"|"ai"|"network"|"credentials"|"printer"|"settings";',
    'type Tab = "overview"|"people"|"timeline"|"downloads"|"media"|"smart"|"actions"|"notifications"|"ai"|"network"|"credentials"|"printer"|"settings";',
    "Tab type",
)
s = must_replace(
    s,
    '  {id:"actions",label:"Akciók",short:"Akciók"},\n  {id:"ai",label:"AI Asszisztens",short:"AI"},',
    '  {id:"actions",label:"Akciók",short:"Akciók"},\n  {id:"notifications",label:"Értesítések",short:"Értesítés"},\n  {id:"ai",label:"AI Asszisztens",short:"AI"},',
    "notifications tab def",
)
s = must_replace(
    s,
    'const permissionDefs=tabDefs.map(t=>({id:t.id as MenuPermission,label:t.label}));',
    'const permissionDefs=tabDefs.filter(t=>t.id!=="notifications").map(t=>({id:t.id as MenuPermission,label:t.label}));',
    "permission defs",
)
s = must_replace(
    s,
    'if(!currentUser.isAdmin&&!currentUser.permissions.includes(tab as MenuPermission)){const first=(currentUser.permissions[0]||"overview") as Tab;',
    'if(!currentUser.isAdmin&&tab!=="notifications"&&!currentUser.permissions.includes(tab as MenuPermission)){const first=(currentUser.permissions[0]||"overview") as Tab;',
    "tab guard",
)
s = must_replace(
    s,
    'const allowedTabs=currentUser?.isAdmin?tabDefs:currentUser?tabDefs.filter(t=>currentUser.permissions.includes(t.id as MenuPermission)):[];',
    'const allowedTabs=currentUser?.isAdmin?tabDefs:currentUser?tabDefs.filter(t=>t.id==="notifications"||currentUser.permissions.includes(t.id as MenuPermission)):[];',
    "allowed tabs",
)
s = must_replace(
    s,
    'const mobilePriority:Tab[]=["overview","people","smart","actions","network"];',
    'const mobilePriority:Tab[]=["overview","people","smart","actions","notifications"];',
    "mobile priority",
)
s = must_replace(
    s,
    'if(!currentUser.isAdmin&&!currentUser.permissions.includes(next as MenuPermission))return;',
    'if(!currentUser.isAdmin&&next!=="notifications"&&!currentUser.permissions.includes(next as MenuPermission))return;',
    "choose tab guard",
)
s = s.replace('t.id==="actions"?"⚡":t.id==="ai"?', 't.id==="actions"?"⚡":t.id==="notifications"?"🔔":t.id==="ai"?')
s = s.replace('t.id==="actions"?"⚡":"⌁"', 't.id==="actions"?"⚡":t.id==="notifications"?"🔔":"⌁"')
s = s.replace('t.id==="actions"&&automation.unread>0', 't.id==="notifications"&&automation.unread>0')

# Native test endpoint button instead of DOM injection helper.
disable_marker = '  async function disable(){setBusy(true);try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(sub){await api("/api/notifications/push/subscribe",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({endpoint:sub.endpoint})});await sub.unsubscribe()}setSubscribed(false);flash("Push értesítés kikapcsolva ezen az eszközön.");reload()}catch(err){flash(`Push hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setBusy(false)}}\n'
if disable_marker not in s:
    raise SystemExit("missing marker: Push disable")
test_fn = '''  async function testPush(){if(!currentUser.personId)return flash("Teszt push csak személyes fiókkal küldhető.");setBusy(true);try{await api("/api/notifications/push/test",{method:"POST"});flash("Teszt push elküldve. Pár másodpercen belül meg kell érkeznie.")}catch(err){flash(`Teszt push hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setBusy(false)}}\n'''
s = s.replace(disable_marker, disable_marker + test_fn, 1)
s = must_replace(
    s,
    '{subscribed?<button className="ghost" disabled={busy} onClick={disable}>Push kikapcsolása</button>:<button className="primaryAction" disabled={busy||!status?.pushConfigured} onClick={enable}>{busy?"Beállítás…":"Push bekapcsolása"}</button>}',
    '{subscribed?<><button className="ghost" disabled={busy} onClick={disable}>Push kikapcsolása</button><button className="ghost" disabled={busy} onClick={testPush}>Teszt push küldése</button></>:<button className="primaryAction" disabled={busy||!status?.pushConfigured} onClick={enable}>{busy?"Beállítás…":"Push bekapcsolása"}</button>}',
    "native test push button",
)

# Actions page becomes automation-only; alerts move to Notifications.
s = must_replace(
    s,
    'const[composer,setComposer]=useState(false);const rules=state.rules||[],alerts=state.alerts||[];',
    'const[composer,setComposer]=useState(false);const rules=state.rules||[];',
    "Actions vars",
)
s = s.replace('  async function readAll(){await api("/api/alerts/read-all",{method:"POST"});reload()}\n', '', 1)
s, n = re.subn(
    r'<section className="automationStats automationStatsV22">.*?</section>',
    '<section className="automationStats automationStatsV22 actionStatsCompactV249"><div><span>Aktív</span><strong>{rules.filter(r=>r.enabled).length}</strong></div><div><span>Összes szabály</span><strong>{rules.length}</strong></div></section>',
    s,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit("automation stats replacement failed")
s, n = re.subn(r'<section className="panel alertsPanel">.*?</section>', '', s, count=1, flags=re.S)
if n != 1:
    raise SystemExit("actions alerts removal failed")

notifications_tab = r'''
function NotificationsTab({currentUser,state,flash,reload}:{currentUser:AuthUser;state:AutomationState;flash:(m:string)=>void;reload:()=>void}){
  const alerts=state.alerts||[];
  async function readAll(){try{await api("/api/alerts/read-all",{method:"POST"});reload()}catch(err){flash(`Értesítés hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  return <div className="tabPanel notificationsTabV249">
    <section className="panel notificationsHeroV249"><div><span className="smartEyebrowV12">ÉRTESÍTÉSI KÖZPONT</span><h2>Értesítések</h2><p>Push, email, SMS és a HomeHub riasztási előzményei egy helyen.</p></div><div className="notificationOverviewV249"><span><small>Olvasatlan</small><strong>{state.unread||0}</strong></span><span><small>Push</small><strong>{state.notification?.pushConfigured?"Kész":"Nincs"}</strong></span><span><small>Email</small><strong>{state.notification?.emailConfigured?"Kész":"Nincs"}</strong></span><span><small>SMS</small><strong>{state.notification?.smsConfigured?"Kész":"Nincs"}</strong></span></div></section>
    <PushNotificationSettings currentUser={currentUser} status={state.notification} flash={flash} reload={reload}/>
    <section className="panel alertsPanel notificationHistoryV249"><div className="sectionHead"><div><span className="smartEyebrowV12">ELŐZMÉNYEK</span><h2>Riasztások és kézbesítések</h2><p>A HomeHub minden értesítési eseményt megőriz, csatornával és kézbesítési állapottal együtt.</p></div>{state.unread>0&&<button className="ghost" onClick={readAll}>Mind olvasott</button>}</div>{alerts.length===0?<div className="empty">Még nincs értesítés.</div>:<div className="alertList">{alerts.slice(0,40).map(a=><article className={a.readAt?"alertItem":"alertItem unread"} key={a.id}><div className="alertIcon">{(a.deliveries||[]).some(d=>d.channel==="push"&&d.ok)?"🔔":a.emailSent?"✉":"!"}</div><div><strong>{a.subject}</strong><p>{a.message}</p><small>{new Date(a.createdAt).toLocaleString("hu-HU")}{a.escalationLevel?` · eszkaláció ${a.escalationLevel}`:""} · {(a.deliveries||[]).length?(a.deliveries||[]).map(d=>`${d.personName||"fallback"} ${d.channel}: ${d.ok?"✓":d.skipped?"kihagyva":"hiba"}`).join(" · "):a.emailRequested?(a.emailSent?"email elküldve":`email: ${a.emailError||"nem sikerült"}`):"csak HomeHub"}</small></div></article>)}</div>}</section>
  </div>
}

'''
marker = 'function Life360Settings('
if marker not in s:
    raise SystemExit("missing Life360 marker")
s = s.replace(marker, notifications_tab + marker, 1)

s = must_replace(
    s,
    '{tab==="actions"&&<ActionsTab state={automation} smart={smart} network={network} people={state?.people||[]} signals={signals} vacuum={vacuum} reload={load} flash={flash}/>}\n\n    {tab==="ai"',
    '{tab==="actions"&&<ActionsTab state={automation} smart={smart} network={network} people={state?.people||[]} signals={signals} vacuum={vacuum} reload={load} flash={flash}/>}\n\n    {tab==="notifications"&&<NotificationsTab currentUser={currentUser} state={automation} flash={flash} reload={load}/>}\n\n    {tab==="ai"',
    "notifications render",
)
s = s.replace('<PushNotificationSettings currentUser={currentUser} status={automation.notification} flash={flash} reload={load}/>', '', 1)
s = s.replace('<strong>v0.23.0</strong>', '<strong>v0.24.9</strong>')
write(path, s)

# --- Server: direct test push + notification deep-link ----------------------
path = "server/src/index.ts"
s = read(path)
s = s.replace('const VERSION = "0.23.0";', 'const VERSION = "0.24.9";', 1)
route_re = re.compile(r'(app\.delete\("/api/notifications/push/subscribe", userAuth, \(req, res\) => \{.*?^\}\);)', re.S | re.M)
m = route_re.search(s)
if not m:
    raise SystemExit("push unsubscribe route not found")
test_route = r'''

app.post("/api/notifications/push/test", userAuth, async (_req, res) => {
  const user = res.locals.user as SessionUser;
  if (!user.personId) return res.status(400).json({ error: "person_account_required_for_push" });
  try {
    const deliveries = await notifier.deliver({ enabled: true, priority: "normal", recipientPersonIds: [user.personId], channels: ["push"], fallbackToAdmin: false }, "HomeHub teszt push", "Ha ezt az értesítést látod, az iPhone Web Push működik.");
    const ok = deliveries.some(d => d.channel === "push" && d.ok);
    if (!ok) return res.status(502).json({ ok: false, error: "push_send_failed", deliveries });
    res.json({ ok: true, deliveries });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});'''
s = s[:m.end()] + test_route + s[m.end():]
write(path, s)

path = "server/src/notifier.ts"
s = read(path).replace('url: "/#actions"', 'url: "/#notifications"')
write(path, s)

# --- PWA/cache/deep link versions -------------------------------------------
path = "web/public/sw.js"
s = read(path)
s = s.replace('const VERSION = "0.24.7";', 'const VERSION = "0.24.9";', 1)
s = s.replace('v=0247', 'v=0249')
s = s.replace('/#actions', '/#notifications')
write(path, s)

path = "web/public/manifest.webmanifest"
s = read(path).replace('0247', '0249')
write(path, s)

for path in ["web/public/homehub-pwa-0247.js", "web/public/homehub-account-0247.js", "web/public/homehub-stability-0247.js"]:
    s = read(path).replace('const VERSION = "0.24.7";', 'const VERSION = "0.24.9";', 1)
    if path.endswith("homehub-account-0247.js"):
        s = s.replace('Push, rendszer és fiók', 'Rendszer és fiók')
        s = s.replace('const pushPanel=document.querySelector(".pushSettingsV22");', 'const settingsPanel=document.querySelector(".settingsPanel");')
        s = s.replace('!pushPanel || document.querySelector(".accountSettingsV246")', '!settingsPanel || document.querySelector(".accountSettingsV246")')
        s = s.replace('pushPanel.parentElement?.insertBefore(card,pushPanel);', 'settingsPanel.parentElement?.insertBefore(card,settingsPanel);')
        action_marker = '    if (can("settings")) {\n'
        if action_marker not in s:
            raise SystemExit("account action marker missing")
        notification_action = '    { const b=document.createElement("button"); b.type="button"; b.className="hhAccountActionV246"; b.innerHTML="<span>🔔</span><b>Értesítések</b><small>Push és riasztási előzmények</small>"; b.onclick=()=>navigate("notifications"); actions.appendChild(b); }\n'
        s = s.replace(action_marker, notification_action + action_marker, 1)
    write(path, s)

# Retire old DOM-injection test helper.
Path("web/public/homehub-push-test-0248.js").unlink(missing_ok=True)

# --- Final global mobile UX layer (loaded last) ------------------------------
css = r'''/* HomeHub 0.24.9 global mobile UX guardrail. Loaded last. */
:root{--hh-mobile-nav-h-249:72px;--hh-safe-top-249:env(safe-area-inset-top,0px);--hh-safe-bottom-249:env(safe-area-inset-bottom,0px)}
html,body,#root,.hhApp,.hhMain,.tabPanel{max-width:100%;min-width:0}
html,body{overflow-x:hidden!important}
.hhApp :where(section,article,div,nav,header,footer,form,label){min-width:0}
.hhApp :where(img,svg,video,canvas){max-width:100%;height:auto}
.hhApp :where(p,small,strong,b){overflow-wrap:anywhere}

/* Legacy .switch form control must never manufacture pseudo controls in device cards. */
.hhApp article.smartDevice.switch::before,.hhApp article.smartDevice.switch::after,.hhApp article.smartDevice.switch span::before,.hhApp article.smartDevice.switch span::after{content:none!important;display:none!important}
.hhApp article.smartDevice.switch span:not(.deviceDot):not(.smartToggleV12){width:auto!important;height:auto!important;min-width:0!important;position:static!important;background:transparent!important;border-radius:0!important;box-shadow:none!important}
.hhApp article.smartDevice.switch .deviceDot{display:inline-block!important;width:7px!important;height:7px!important;border-radius:50%!important;background:var(--hh-muted)!important}
.hhApp article.smartDevice.switch.online .deviceDot{background:var(--hh-accent)!important}
.hhApp article.smartDevice.switch .smartToggleV12{display:block!important;position:relative!important;width:50px!important;min-width:50px!important;height:28px!important;border-radius:999px!important;background:color-mix(in srgb,var(--hh-muted) 36%,var(--hh-paper2))!important}
.hhApp article.smartDevice.switch .smartToggleV12.on{background:var(--hh-accent)!important}

.notificationsTabV249{display:grid;gap:12px}
.notificationsHeroV249{display:grid!important;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center}
.notificationsHeroV249 h2{font-size:25px!important;margin:4px 0 5px!important}
.notificationOverviewV249{display:grid;grid-template-columns:repeat(4,minmax(82px,1fr));gap:8px}
.notificationOverviewV249>span{display:grid;gap:3px;padding:11px 12px;border:1px solid var(--hh-line);border-radius:13px;background:var(--hh-paper2)}
.notificationOverviewV249 small{font-size:9px;color:var(--hh-muted);text-transform:uppercase;letter-spacing:.08em}
.notificationOverviewV249 strong{font-size:16px}
.notificationHistoryV249 .alertItem{min-width:0}
.pushActionsV22{display:flex;gap:8px;flex-wrap:wrap}
.actionStatsCompactV249{grid-template-columns:repeat(2,minmax(0,1fr))!important}

@media(max-width:760px){
  html,body,#root{width:100%!important;max-width:100%!important;overflow-x:hidden!important;overscroll-behavior-x:none}
  body{min-width:0!important}
  .hhApp{width:100%!important;max-width:100vw!important;overflow-x:hidden!important;padding-bottom:calc(var(--hh-mobile-nav-h-249) + var(--hh-safe-bottom-249) + 30px)!important}
  .hhMain{width:100%!important;max-width:100%!important;overflow-x:hidden!important;padding-left:12px!important;padding-right:12px!important;padding-bottom:calc(var(--hh-mobile-nav-h-249) + var(--hh-safe-bottom-249) + 34px)!important}
  .hhMain>.tabPanel,.hhMain>.hhTopbar,.panel,.smartPanelV12,.smartGridV12,.smartGridV13,.peopleGridV19,.notificationsTabV249,.notificationComposerV22{width:100%!important;max-width:100%!important;min-width:0!important}
  .tabPanel,.panel,.smartPanelV12,.smartDevice,.personCardV19,.actionRule,.alertItem{overflow-x:hidden!important}

  /* Fixed nav owns its own area; content never sits underneath it. */
  .hhSidebar{left:8px!important;right:8px!important;bottom:calc(8px + var(--hh-safe-bottom-249))!important;width:auto!important;max-width:calc(100vw - 16px)!important}
  .hhMobileNav{grid-template-columns:repeat(5,minmax(0,1fr))!important}
  .hhMobileNav button{min-width:0!important}
  body:has(.modalBack) .hhSidebar,body:has(.actionModalBack) .hhSidebar,body:has(.hhAccountBackV246) .hhSidebar{display:none!important}
  body:has(.modalBack),body:has(.actionModalBack),body:has(.hhAccountBackV246){overflow:hidden!important}

  /* No iOS focus zoom. */
  .hhApp input:not([type="checkbox"]):not([type="radio"]),.hhApp select,.hhApp textarea{font-size:16px!important;max-width:100%!important}

  /* Toolbars/chips wrap instead of widening the document. */
  .filterBar,.filterBarV12,.timelineFiltersV19,.smartHeroActionsV12,.copyActions,.personActionsV19,.ruleMetaV21,.ruleMetaV22{display:flex!important;flex-wrap:wrap!important;overflow:visible!important;max-width:100%!important}
  .filterBar button,.filterBarV12 button,.timelineFiltersV19 button{flex:0 1 auto!important;white-space:normal!important}
  .magnet,.add,.mediaToolbarV16,.smartSearchRowV12{max-width:100%!important}

  /* Smart cards: one clear primary control, no debug/hint clutter. */
  .smartGridV12,.smartGridV13{padding-left:0!important;padding-right:0!important}
  .smartDevice{width:100%!important;max-width:100%!important;margin:0!important;padding:14px!important;border-radius:18px!important}
  .smartCardTop{grid-template-columns:38px minmax(0,1fr) auto!important;gap:10px!important;align-items:center!important}
  .smartCardTitle,.smartCardIdentity{min-width:0!important}
  .smartCardTitle strong{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;font-size:16px!important;line-height:1.2!important}
  .smartCardIdentity>small{white-space:normal!important}
  .smartCardHint,.smartDeviceDebug,.miniControlStrip,.secondaryToggleRow{display:none!important}
  .smartDevice.switch .smartCardActionsV12,.smartDevice.light .smartCardActionsV12{display:none!important}
  .switchCardStateV12{min-height:54px!important;padding:10px 12px!important;margin-top:7px!important}
  .sensorHeroV12{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .sensorHeroV12>span:last-child:nth-child(odd){grid-column:1/-1}

  /* Modals are safe-area sheets with internal scrolling; bottom nav is hidden. */
  .modalBack,.actionModalBack{position:fixed!important;inset:0!important;padding:calc(var(--hh-safe-top-249) + 6px) 6px calc(var(--hh-safe-bottom-249) + 6px)!important;align-items:stretch!important;justify-content:center!important;overflow:hidden!important;z-index:220!important}
  .detailModalV12,.actionComposer,.modal{width:100%!important;max-width:100%!important;height:auto!important;max-height:calc(100dvh - var(--hh-safe-top-249) - var(--hh-safe-bottom-249) - 12px)!important;margin:0!important;border-radius:20px!important;overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:touch}
  .actionComposer{padding:0!important}
  .actionComposerHead{position:sticky!important;top:0!important;z-index:8!important;background:var(--hh-paper)!important;padding:16px 16px 12px!important;border-bottom:1px solid var(--hh-line)!important}
  .actionComposerHead h2{font-size:25px!important;line-height:1.12!important;margin:4px 0!important;overflow-wrap:anywhere}
  .actionTemplateGrid{grid-template-columns:1fr!important;margin:0!important;padding:12px 16px!important;gap:8px!important}
  .actionTemplateGrid button{min-height:76px!important;padding:12px!important}
  .actionFields,.notificationComposerV22{margin:0 16px 12px!important;padding:12px!important;width:auto!important;max-width:calc(100% - 32px)!important;grid-template-columns:1fr!important}
  .recipientGridV22{grid-template-columns:1fr!important;gap:7px!important}
  .recipientGridV22 label{min-width:0!important;padding:10px!important}
  .recipientGridV22 label>span:last-child{min-width:0!important}
  .recipientGridV22 small{white-space:normal!important}
  .channelPickerV22{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important}
  .channelPickerV22 label{min-width:0!important;padding:10px 6px!important}
  .actionComposerFooter{position:sticky!important;bottom:0!important;z-index:9!important;margin:0!important;padding:12px 16px calc(12px + var(--hh-safe-bottom-249))!important;background:var(--hh-paper)!important;border-top:1px solid var(--hh-line)!important;display:grid!important;grid-template-columns:1fr 1fr!important}
  .actionComposerFooter button{width:100%!important;min-width:0!important}
  .detailHead{position:sticky!important;top:0!important;z-index:8!important;background:var(--hh-paper)!important}

  /* Notifications hub. */
  .notificationsHeroV249{grid-template-columns:1fr!important;gap:12px!important;padding:15px!important}
  .notificationOverviewV249{grid-template-columns:repeat(2,minmax(0,1fr))!important;width:100%!important}
  .notificationOverviewV249>span{padding:10px!important}
  .pushActionsV22{display:grid!important;grid-template-columns:1fr!important;width:100%!important}
  .pushActionsV22 button{width:100%!important}
  .notificationHistoryV249 .sectionHead{align-items:stretch!important}
  .notificationHistoryV249 .alertItem{grid-template-columns:32px minmax(0,1fr)!important;padding:11px!important}
  .notificationHistoryV249 .alertItem p{white-space:pre-line!important}
  .notificationHistoryV249 .alertItem small{display:block!important;line-height:1.5!important}

  /* Header and feedback stay inside safe area. */
  .hhTopbar{max-width:100vw!important;overflow:hidden!important}
  .hhTopbar h1{min-width:0!important;max-width:34vw!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
  .hhTopActions{min-width:0!important;flex-shrink:0!important}
  .hhMobileTabSelect{max-width:34vw!important}
  .toast{left:12px!important;right:12px!important;top:calc(var(--hh-safe-top-249) + 8px)!important;max-width:none!important;width:auto!important;overflow-wrap:anywhere!important}

  /* Editors and final rows stay clear of the floating nav. */
  .personEditorActionsV19,.profileSaveRowV211,.accessSaveRowV211{bottom:calc(var(--hh-mobile-nav-h-249) + var(--hh-safe-bottom-249) + 10px)!important}
  .tabPanel>*:last-child{margin-bottom:8px!important}
}
'''
write("web/public/homehub-mobile-ux-0249.css", css)

# --- index: cache-bust every layer and load mobile guardrail last -----------
path = "web/index.html"
s = read(path)
s = s.replace('v=0247', 'v=0249').replace('v=0248', 'v=0249')
s = re.sub(r'\s*<script defer src="/homehub-push-test-0248\.js\?v=0249"></script>\n?', '\n', s)
account_css = '<link rel="stylesheet" href="/homehub-account-0246.css?v=0249" />'
if account_css not in s:
    raise SystemExit("account css marker missing")
s = s.replace(account_css, account_css + '\n    <link rel="stylesheet" href="/homehub-mobile-ux-0249.css?v=0249" />', 1)
write(path, s)

print("HomeHub 0.24.9 patches applied")
