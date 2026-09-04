import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Torrent = { id:number; hashString:string; name:string; status:number; percentDone:number; rateDownload:number; rateUpload:number; eta:number };
type PrinterStatus = { configured:boolean; online:boolean; host:string; adminUrl:string; detectedPorts:number[]; protocol:string; note:string };
type NetworkStatus = { id:string; name:string; kind:string; online:boolean; adminOnline?:boolean; ip:string; mac:string; latencyMs:number; adminUrl:string; note:string };
type CopyState = { torrentName:string; destination:string; state:string; message?:string; attempts?:number; copiedBytes?:number; totalBytes?:number; currentFile?:string; fileCopiedBytes?:number; fileTotalBytes?:number; speedBytesPerSec?:number; etaSeconds?:number; percent?:number };
type MediaItem = { id:string; name:string; relativePath:string; folder:string; sizeBytes:number; modifiedAt:string; extension:string; nativePlay:boolean; playUrl:string; downloadUrl:string };
type MediaSnapshot = { enabled:boolean; online:boolean; publicBaseUrl:string; count:number; truncated:boolean; error?:string; items:MediaItem[]; updatedAt:string };
type TuyaPoint = { code:string; value:unknown };
type TuyaSpec = { code:string; type:string; values:string; dp_id?:number; dpId?:number };
type TuyaDevice = { id:string; name:string; online:boolean; category:string; productName:string; productId?:string; homeId?:string; profile?:"mygate"|"feyree"|"aircon"; status:TuyaPoint[]; functions:TuyaSpec[]; statusSpec:TuyaSpec[] };
type TuyaScene = { id:string; name:string; homeId?:string; enabled?:boolean; capabilities?:Array<{interface_name?:string; commands?:string[]}> };
type SmartHome = { configured:boolean; online:boolean; lastUpdatedAt:string|null; error?:string; devices:TuyaDevice[]; scenes:TuyaScene[] };
type VacuumStatus = { configured:boolean; online:boolean; controlReady:boolean; name:string; model:string; ip:string; state?:string; battery?:number; areaM2?:number; durationSec?:number; metrics?:Array<{name:string;value:unknown;unit?:string}>; note:string; updatedAt:string };
type AutomationTrigger =
  | {type:"tuya.numeric";deviceId:string;code:string;operator:"gt"|"gte"|"lt"|"lte"|"eq";value:number;forSeconds?:number}
  | {type:"tuya.state";deviceId:string;code:string;operator:"eq"|"neq";value:string|number|boolean;forSeconds?:number}
  | {type:"network.online_window";networkId:string;after:string;before:string;forSeconds?:number;timezone?:string}
  | {type:"network.new_device"}
  | {type:"schedule";time:string;days:number[];timezone?:string};
type AutomationAction =
  | {type:"tuya.command";deviceId:string;code:string;value:unknown}
  | {type:"vacuum.command";action:"start"|"pause"|"stop"|"dock"}
  | {type:"ai.summary";subject:string;email?:boolean}
  | {type:"alert";subject:string;message:string;email?:boolean};
type AutomationRule = {id:string;name:string;enabled:boolean;trigger:AutomationTrigger;actions:AutomationAction[];cooldownSeconds:number;createdAt:string;updatedAt:string;lastTriggeredAt?:string};
type AlertRecord = {id:string;ruleId:string;ruleName:string;subject:string;message:string;createdAt:string;emailRequested:boolean;emailSent:boolean;emailError?:string;readAt?:string};
type AutomationState = {rules:AutomationRule[];alerts:AlertRecord[];unread:number;email:{configured:boolean;recipients:number}};
type AIMode = "off"|"suggest"|"approved";
type AIState = {configured:boolean;model:string;mode:AIMode;policy:string};
type AIUsage = {inputTokens?:number;outputTokens?:number;totalTokens?:number};
type AIChatMessage = {role:"user"|"assistant";text:string};
type AIActionPlan = {kind:"tuya.command"|"vacuum.command"|"none";summary:string;deviceId:string;code:string;valueType:"boolean"|"number"|"string"|"none";booleanValue:boolean;numberValue:number;stringValue:string;vacuumAction:"start"|"pause"|"stop"|"dock"|"none";reason:string;risk:"low"|"medium"|"blocked"};
type AIAutomationDraftResult = {explanation:string;draft:null|{name:string;enabled:boolean;trigger:AutomationTrigger;actions:AutomationAction[];cooldownSeconds:number};valid:boolean;warnings:string[];usage?:AIUsage};
type AIActionDraftResult = {plan:AIActionPlan;valid:boolean;warning?:string;usage?:AIUsage};
type State = {
  snapshot:null|{
    timestamp:string;
    kd20:{online:boolean;torrents:Torrent[]};
    wd:{online:boolean;freeBytes:number;totalBytes:number;mediaRoot:string};
    printer?:PrinterStatus;
    network?:NetworkStatus[];
    vacuum?:VacuumStatus;
    media?:MediaSnapshot;
  };
  bridgeLastSeenAt:string|null;
  bridgeOnline:boolean;
  settings:{autoCopyEnabled:boolean;autoCopyDestination:string;aiMode:AIMode};
  copies:Record<string,CopyState>;
  recentCommands:Array<{id:string;type:string;createdAt:string;completedAt?:string;ok?:boolean;message?:string}>;
  smartHome:SmartHome;
  automation:AutomationState;
  ai:AIState;
};
type Tab = "overview"|"downloads"|"media"|"smart"|"actions"|"ai"|"network"|"printer"|"settings";
type SmartFilter = "all"|"switch"|"sensor"|"climate"|"light"|"gate"|"charger"|"vacuum"|"device";

const fmtBytes=(n:number)=>{if(!n)return"0 B";const u=["B","KB","MB","GB","TB"];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++}return`${v.toFixed(i>2?2:1)} ${u[i]}`};
const fmtSpeed=(n:number)=>`${fmtBytes(n)}/s`;
const fmtDuration=(s?:number)=>!s||s<=0?"—":s<60?`${Math.ceil(s)} mp`:s<3600?`${Math.ceil(s/60)} perc`:`${Math.floor(s/3600)} ó ${Math.ceil((s%3600)/60)} p`;
const bridgeAge=(iso:string|null|undefined)=>{if(!iso)return"Nincs még kapcsolat";const s=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/1000));return s<60?`${s} mp`:`${Math.floor(s/60)} p ${s%60} mp`};
const statusLabel=(status:number)=>({0:"Leállítva",1:"Ellenőrzésre vár",2:"Ellenőrzés",3:"Letöltésre vár",4:"Letölt",5:"Seedre vár",6:"Seedel"}[status]||`Állapot ${status}`);
const isDangerous=(name:string)=>/kapu|gate|garage|garázs|door|lock|zár/i.test(name);
const statusMap=(d:TuyaDevice)=>Object.fromEntries(d.status.map(x=>[x.code,x.value]));
const tabDefs:Array<{id:Tab;label:string;short:string}>=[
  {id:"overview",label:"Áttekintés",short:"Áttekintés"},
  {id:"downloads",label:"Letöltések",short:"Letöltés"},
  {id:"media",label:"Média",short:"Média"},
  {id:"smart",label:"Smart Life",short:"Smart"},
  {id:"actions",label:"Akciók",short:"Akciók"},
  {id:"ai",label:"AI Asszisztens",short:"AI"},
  {id:"network",label:"Hálózat",short:"Hálózat"},
  {id:"printer",label:"Nyomtató",short:"Nyomtató"},
  {id:"settings",label:"Beállítások",short:"Beállítás"},
];

function specFor(d:TuyaDevice,code:string){return[...d.functions,...d.statusSpec].find(s=>s.code===code)}
function specValues(d:TuyaDevice,code:string){const x=specFor(d,code);if(!x)return{} as Record<string,unknown>;try{return JSON.parse(x.values||"{}") as Record<string,unknown>}catch{return{} as Record<string,unknown>}}
function findFunction(d:TuyaDevice,patterns:string[],type?:string){
  const allowed=(x:TuyaSpec)=>!type||x.type.toLowerCase()===type.toLowerCase();
  for(const pattern of patterns){const p=pattern.toLowerCase();const exact=d.functions.find(x=>allowed(x)&&x.code.toLowerCase()===p);if(exact)return exact}
  for(const pattern of patterns){const p=pattern.toLowerCase();const partial=d.functions.find(x=>allowed(x)&&x.code.toLowerCase().includes(p));if(partial)return partial}
  return undefined;
}
function findStatus(d:TuyaDevice,patterns:string[]){
  // Pattern priority must win over Tuya's arbitrary status-array order. This is
  // especially important on Feyree EVSEs where generic "energy" can otherwise
  // match charge_energy_* before the real devicekwh DP.
  for(const pattern of patterns){const p=pattern.toLowerCase();const exact=d.status.find(x=>x.code.toLowerCase()===p);if(exact)return exact}
  for(const pattern of patterns){const p=pattern.toLowerCase();const partial=d.status.find(x=>x.code.toLowerCase().includes(p));if(partial)return partial}
  return undefined;
}
function deviceKind(d:TuyaDevice):SmartFilter{if(d.profile==="feyree")return"charger";if(d.profile==="aircon")return"climate";if(d.profile==="mygate")return"gate";const s=`${d.name} ${d.productName} ${d.category}`.toLowerCase(),codes=d.status.map(x=>x.code.toLowerCase()).join(" ");if(/feyree|portable charger|ev charger|evse|autó.*tölt|car charger/.test(s))return"charger";if(/air conditioner|klíma|climate|aircon|新风分体机/.test(s))return"climate";if(/temperature|humidity|hőmér|thermo|sensor/.test(s)||/va_temperature|va_humidity|battery_state/.test(codes))return"sensor";if(/gate|kapu|garage|garázs|lock/.test(s))return"gate";if(/light|bulb|lamp|lámpa|rgb|cct/.test(s))return"light";if(/plug|socket|switch|outlet|konnektor/.test(s))return"switch";return"device"}
function metric(d:TuyaDevice,patterns:string[]){const p=findStatus(d,patterns);if(!p||typeof p.value!=="number")return null;const meta=specValues(d,p.code);let scale=Number(meta.scale||0),v=p.value/Math.pow(10,scale);if(scale===0&&/va_temperature/i.test(p.code)&&Math.abs(v)>100){v/=10;scale=1}return{value:v,unit:String(meta.unit||""),scale}}
function batteryPercent(d:TuyaDevice){const state=findStatus(d,["battery_state"]);const stateMap:Record<string,number>={high:100,middle:55,medium:55,low:20};const stateValue=state&&typeof state.value==="string"?stateMap[state.value.toLowerCase()]??null:null;const direct=["battery_percentage","battery_percent","battery_pct","battery_value"];const p=d.status.find(x=>direct.includes(x.code.toLowerCase())&&typeof x.value==="number");if(p){const meta=specValues(d,p.code);const scale=Number(meta.scale||0);let v=Number(p.value)/Math.pow(10,scale);const max=Number(meta.max||100);if(max>100&&v>100)v=v/max*100;if(v===0&&stateValue!==null&&stateValue>20)return stateValue;if(v>=0&&v<=100)return Math.round(v)}return stateValue}
function enumRange(d:TuyaDevice,code?:string):string[]{if(!code)return[];const m=specValues(d,code) as {range?:unknown};return Array.isArray(m.range)?m.range.map((value:unknown)=>String(value)):[]}
function labelKind(kind:SmartFilter){return kind==="climate"?"Klíma":kind==="sensor"?"Szenzor":kind==="switch"?"Kapcsoló":kind==="light"?"Világítás":kind==="gate"?"Kapu":kind==="charger"?"Autótöltő":kind==="vacuum"?"Porszívó":"Eszköz"}
function friendlyProductName(d:TuyaDevice){const kind=deviceKind(d),raw=(d.productName||d.category||"").trim();if(kind==="climate")return"Tuya klíma";if(kind==="sensor")return"Hőmérséklet- és páratartalom-érzékelő";if(kind==="charger")return"EV töltő";if(kind==="gate")return"myGate kapuvezérlő";if(kind==="light"&&/rgb|cct|smart light/i.test(raw))return"Okosvilágítás";if(kind==="switch")return"Smart Plug";return raw||"Smart Life eszköz"}
function gateStateLabel(value:unknown){const v=String(value??"").toLowerCase().replace(/[_-]+/g," ").trim();if(["closed","close","zárt"].includes(v))return"Zárt";if(["opening","nyitás","nyílik"].includes(v))return"Nyílik";if(["partially opened","partial open","part open","részben nyitva"].includes(v))return"Részben nyitva";if(["opened","open","nyitva"].includes(v))return"Nyitva";if(["closing","zárás","záródik"].includes(v))return"Záródik";return value===undefined||value===null||value===""?"Ismeretlen":String(value)}
function humanValue(value:unknown){if(typeof value==="boolean")return value?"Be":"Ki";if(value===undefined||value===null||value==="")return"—";return String(value).replace(/_/g," ")}
function boolState(d:TuyaDevice,code?:string){
  if(!code)return false;const value=statusMap(d)[code];
  if(typeof value==="boolean")return value;if(typeof value==="number")return value!==0;
  if(typeof value==="string"){const v=value.trim().toLowerCase();if(["true","1","on","open","opened","enabled"].includes(v))return true;if(["false","0","off","close","closed","disabled",""].includes(v))return false}
  return Boolean(value);
}

function actionFunction(d:TuyaDevice,patterns:string[]){
  for(const pattern of patterns){const p=pattern.toLowerCase();const exact=d.functions.find(fn=>fn.code.toLowerCase()===p);if(exact)return exact}
  for(const pattern of patterns){const p=pattern.toLowerCase();const partial=d.functions.find(fn=>fn.code.toLowerCase().includes(p));if(partial)return partial}
  return undefined;
}
function actionValue(fn:TuyaSpec|undefined,preferred:string[]=[]):unknown{
  if(!fn)return true;
  const type=fn.type.toLowerCase();
  if(type==="boolean")return true;
  const meta=(()=>{try{return JSON.parse(fn.values||"{}") as Record<string,unknown>}catch{return{} as Record<string,unknown>}})();
  if(type==="enum"){
    const range=Array.isArray(meta.range)?meta.range.map(String):[];
    for(const p of preferred){const hit=range.find(v=>v.toLowerCase()===p||v.toLowerCase().includes(p));if(hit)return hit}
    return range[0]??true;
  }
  if(type==="integer"||type==="value")return Number(meta.min??1);
  return true;
}
function displayMetric(d:TuyaDevice,patterns:string[],fallbackUnit=""){
  const p=findStatus(d,patterns);if(!p)return null;
  if(typeof p.value!=="number")return{value:String(p.value),unit:fallbackUnit};
  const meta=specValues(d,p.code);const scale=Number(meta.scale||0);return{value:(Number(p.value)/Math.pow(10,scale)).toFixed(scale>0?1:0),unit:String(meta.unit||fallbackUnit)};
}
function chargerMetric(d:TuyaDevice,patterns:string[],fallbackUnit=""){
  const p=findStatus(d,patterns);if(!p)return null;
  const metric=displayMetric(d,[p.code],fallbackUnit);if(!metric)return null;
  const code=p.code.toLowerCase();
  // Several Feyree firmwares publish misleading status-spec units. The DP name
  // is more reliable for the known electrical measurements shown by Smart Life.
  const forcedUnit=/kwh|energy/.test(code)?"kWh":/devicekw|power/.test(code)?"kW":/voltage/.test(code)?"V":/current/.test(code)?"A":/temp/.test(code)?"°C":fallbackUnit;
  return{...metric,unit:forcedUnit||metric.unit};
}
function chargerIsCharging(d:TuyaDevice){
  const amps=chargerMetric(d,["a_current","current_a","cur_current","electric_current"],"A");
  const power=chargerMetric(d,["devicekw","charge_power","active_power","cur_power"],"kW");
  const state=String(findStatus(d,["devicestate","work_statesvg","work_state"])?.value??"").toLowerCase();
  const a=Number(amps?.value??0),kw=Number(power?.value??0);
  return a>0.5||kw>0.05||/charging|chargeing|in charge/.test(state);
}
function chargerStateLabel(d:TuyaDevice){
  if(chargerIsCharging(d))return"Töltés folyamatban";
  const op=String(findStatus(d,["chargingoperation","charge_operation"])?.value??"").toLowerCase();
  if(/opencharging|enable|enabled|allow/.test(op))return"Töltés engedélyezve";
  const state=findStatus(d,["devicestate","work_statesvg","work_state"]);
  return state?prettySmartValue(state.value):"Állapot ismeretlen";
}
function numericFunctionMeta(d:TuyaDevice,fn?:TuyaSpec){if(!fn)return null;const meta=specValues(d,fn.code);return{min:Number(meta.min??0),max:Number(meta.max??100),step:Number(meta.step??1),scale:Number(meta.scale??0),unit:String(meta.unit||"")}}
function networkKind(kind:string){return kind==="gateway"?"Telekom gateway":kind==="router"?"Router":kind==="extender"?"Wi-Fi erősítő":kind==="switch"?"Switch":kind==="nas"?"NAS":kind==="computer"?"Gép":kind==="discovered"?"Új eszköz":"Eszköz"}
function initialTab():Tab{const v=window.location.hash.replace(/^#/,"") as Tab;return tabDefs.some(t=>t.id===v)?v:"overview"}
async function api(path:string,init?:RequestInit){const r=await fetch(path,init);if(r.status===401)throw new Error("AUTH_REQUIRED");const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b?.error||`HTTP ${r.status}`);return b}

function Login({onDone}:{onDone:()=>void}){
  const[password,setPassword]=useState("");const[busy,setBusy]=useState(false);const[error,setError]=useState("");
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{await api("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password})});onDone()}catch(err){setError(err instanceof Error&&err.message==="too_many_attempts"?"Túl sok sikertelen próbálkozás. Próbáld később.":"Hibás jelszó.")}finally{setBusy(false)}}
  return <main className="loginShell"><section className="loginCard"><div className="brandMark">H</div><div className="eyebrow">HOME HUB</div><h1>Belépés</h1><p>NAS, hálózat és okosotthon egyetlen felületen.</p><form onSubmit={submit}><input type="password" autoFocus autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="HomeHub jelszó"/><button disabled={busy||!password}>{busy?"Belépés…":"Belépés"}</button></form>{error&&<div className="loginError">{error}</div>}</section></main>
}

function smartIcon(kind:SmartFilter){return kind==="climate"?"❄":kind==="sensor"?"⌁":kind==="switch"?"⏻":kind==="light"?"✦":kind==="gate"?"⌂":kind==="charger"?"⚡":kind==="vacuum"?"◉":"◇"}
function prettySmartValue(value:unknown){
  const raw=humanValue(value),v=raw.toLowerCase().trim();
  const map:Record<string,string>={
    "auto":"Automata","cool":"Hűtés","cold":"Hűtés","heat":"Fűtés","hot":"Fűtés","dry":"Párátlanítás","fan":"Ventilátor",
    "charger free":"Szabad","charging":"Töltés","finish":"Befejezve","finished":"Befejezve","charge pct":"Töltés százalék alapján",
    "opencharging":"Töltés engedélyezve","closecharging":"Töltés tiltva","great":"Kiváló","good":"Jó","normal":"Normál",
    "no":"Nincs","none":"Nincs","off":"Ki","on":"Be","false":"Ki","true":"Be","gnd":"Rendben","low":"Alacsony","middle":"Közepes","mid":"Közepes","mid high":"Közepes-magas","high":"Magas","strong":"Erős","weak":"Gyenge"
  };
  return map[v]??raw;
}
function SmartDeviceCard({device,onCommand,onOpen}:{device:TuyaDevice;onCommand:(d:TuyaDevice,code:string,value:unknown)=>void;onOpen:(d:TuyaDevice)=>void}){
  const kind=deviceKind(device),sm=statusMap(device),battery=batteryPercent(device);
  const temp=(kind==="sensor"||kind==="climate"||kind==="charger")?metric(device,["temp_current","temp_currentsvg","devicetemp","va_temperature","temperature","temp_value","temp"]):null;
  const hum=(kind==="sensor"||kind==="climate")?metric(device,["humidity_current","humidity_currentsvg","humidity_value","va_humidity","humidity","humid"]):null;
  const switchFn=(kind==="switch"||kind==="light"||kind==="climate"||kind==="charger")?findFunction(device,["powersvg","switchsvg","switch","switch_1","switch_led","power","power_switch","charge_switch"],"Boolean"):undefined;
  const switchCode=switchFn?.code, switchValue=switchCode?boolState(device,switchCode):undefined;
  const volts=kind==="charger"?chargerMetric(device,["a_voltage"],"V"):null;
  const amps=kind==="charger"?chargerMetric(device,["a_current"],"A"):null;
  const power=kind==="charger"?chargerMetric(device,["devicekw"],"kW"):null;
  const chargerState=kind==="charger"?chargerStateLabel(device):null;
  const gateState=kind==="gate"?findStatus(device,["door_sensor_state","gate_state","door_state"]):null;
  const climateMode=kind==="climate"?findStatus(device,["modesvg","mode","work_mode"]):null;
  const climateTarget=kind==="climate"?displayMetric(device,["temp_setsvg","temp_set"],"°C"):null;
  const readOnly=device.status.filter(p=>["string","number","boolean"].includes(typeof p.value)).filter(p=>!/^switch/.test(p.code)).slice(0,2);
  const hasDetails=["gate","charger","climate"].includes(kind);

  return <article className={`smartDevice smartCardV12 ${kind} ${device.online?"online":"offline"}`}>
    <div className="smartCardTop">
      <div className={`deviceIconV12 ${kind}`} aria-hidden="true">{smartIcon(kind)}</div>
      <div className="smartCardIdentity">
        <div className="smartCardTitle"><strong title={device.name}>{device.name}</strong><span className={`deviceDot ${device.online?"on":""}`}></span></div>
        <small title={device.productName||device.category}>{friendlyProductName(device)}</small>
      </div>
      <span className="deviceKind">{labelKind(kind)}</span>
    </div>

    {kind==="sensor"&&<div className="sensorHeroV12">
      {temp&&<div><span>Hőmérséklet</span><strong>{temp.value.toFixed(temp.scale>0?1:0)}{temp.unit?` ${temp.unit}`:" °C"}</strong></div>}
      {hum&&<div><span>Páratartalom</span><strong>{hum.value.toFixed(hum.scale>0?1:0)}{hum.unit?` ${hum.unit}`:" %"}</strong></div>}
      {battery!==null&&<div><span>Elem</span><strong>{battery}%</strong></div>}
    </div>}

    {kind==="climate"&&<div className="climateCardV12">
      <div className="climateTempV12"><span>Aktuális</span><strong>{temp?`${temp.value.toFixed(temp.scale>0?1:0)}°`:"—"}</strong></div>
      <div className="climateMiniStatsV12">
        <span><small>Cél</small><b>{climateTarget?`${climateTarget.value}°`:"—"}</b></span>
        <span><small>Mód</small><b>{climateMode?prettySmartValue(climateMode.value):"—"}</b></span>
      </div>
    </div>}

    {kind==="charger"&&<div className="chargerCardV12">
      <div className="chargerStateV12"><span>EV töltő</span><strong>{chargerState||"Állapot ismeretlen"}</strong></div>
      <div className="chargerMiniMetricsV12">
        <span><b>{volts?.value??"—"}</b><small>{volts?.unit||"V"}</small></span>
        <span><b>{amps?.value??"—"}</b><small>{amps?.unit||"A"}</small></span>
        <span><b>{power?.value??"—"}</b><small>{power?.unit||"kW"}</small></span>
      </div>
    </div>}

    {kind==="gate"&&<div className={`gateCardStateV12 state-${String(gateState?.value??"unknown").toLowerCase().replace(/\s+/g,"-")}`}>
      <span>Kapu állapota</span><strong>{gateStateLabel(gateState?.value)}</strong>
    </div>}

    {(kind==="switch"||kind==="light")&&<div className="switchCardStateV12">
      <span>{switchValue?"Bekapcsolva":"Kikapcsolva"}</span>
      {switchCode&&<button aria-label={`${device.name} ${switchValue?"kikapcsolása":"bekapcsolása"}`} className={switchValue?"smartToggleV12 on":"smartToggleV12"} disabled={!device.online} onClick={()=>onCommand(device,switchCode,!switchValue)}><i></i></button>}
    </div>}

    {kind==="device"&&<>
      {(temp||hum||battery!==null)&&<div className="metrics">{temp&&<span>🌡 {temp.value.toFixed(temp.scale>0?1:0)} °C</span>}{hum&&<span>💧 {hum.value.toFixed(hum.scale>0?1:0)}%</span>}{battery!==null&&<span>🔋 {battery}%</span>}</div>}
      {readOnly.length>0&&<div className="rawMetrics">{readOnly.map(p=><span key={p.code}>{p.code}: {prettySmartValue(p.value)}</span>)}</div>}
    </>}

    <div className="smartCardActionsV12">
      {switchCode&&kind!=="switch"&&kind!=="light"&&<button className={switchValue?"powerV12 on":"powerV12"} disabled={!device.online} onClick={()=>onCommand(device,switchCode,!switchValue)}>{switchValue?"Kikapcsolás":"Bekapcsolás"}</button>}
      {hasDetails&&<button className="detailsV12" disabled={!device.online} onClick={()=>onOpen(device)}>Részletek <span>›</span></button>}
      {!hasDetails&&(kind==="switch"||kind==="light")&&<span className="smartCardHint">{device.online?"Érintsd meg a kapcsolót":"Eszköz offline"}</span>}
    </div>
  </article>
}

function VacuumCard({vacuum,onOpen,onAction}:{vacuum:VacuumStatus;onOpen:()=>void;onAction:(action:"start"|"pause"|"stop"|"dock")=>void}){
  const state=prettySmartValue(vacuum.state|| (vacuum.online?"Online":"Offline"));
  return <article className={`smartDevice smartCardV12 smartCardV13 vacuum ${vacuum.online?"online":"offline"}`}>
    <div className="smartCardTop">
      <div className="deviceIconV12 vacuum" aria-hidden="true">◉</div>
      <div className="smartCardIdentity"><div className="smartCardTitle"><strong>{vacuum.name||"Xiaomi Robot Vacuum E10"}</strong><span className={`deviceDot ${vacuum.online?"on":""}`}></span></div><small>{vacuum.model||"Xiaomi Home"}</small></div>
      <span className="deviceKind">Porszívó</span>
    </div>
    <div className="vacuumHeroV13">
      <div className="vacuumOrbV13"><span>◉</span><i></i></div>
      <div className="vacuumStateV13"><small>Állapot</small><strong>{state}</strong><span>{vacuum.controlReady?"Helyi vezérlés kész":vacuum.online?"Vezérlés beállítása szükséges":"Nem elérhető"}</span></div>
    </div>
    <div className="vacuumMetricsV13">
      <span><small>Akku</small><b>{vacuum.battery!==undefined?`${vacuum.battery}%`:"—"}</b></span>
      <span><small>Terület</small><b>{vacuum.areaM2!==undefined?`${vacuum.areaM2.toFixed(1)} m²`:"—"}</b></span>
      <span><small>Idő</small><b>{vacuum.durationSec!==undefined?fmtDuration(vacuum.durationSec):"—"}</b></span>
    </div>
    <div className="smartCardActionsV12 vacuumActionsV13">
      <button className="vacuumStartV13" disabled={!vacuum.online||!vacuum.controlReady} onClick={()=>onAction("start")}>▶ Indítás</button>
      <button className="detailsV12" onClick={onOpen}>Részletek <span>›</span></button>
    </div>
  </article>
}

function VacuumDetailDialog({vacuum,onClose,onAction}:{vacuum:VacuumStatus;onClose:()=>void;onAction:(action:"start"|"pause"|"stop"|"dock")=>void}){
  return <div className="modalBack deviceDetailBack" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="deviceDetail vacuumDetailV13">
    <div className="detailHead detailHeadV13"><div><span className="deviceKind">Porszívó</span><h2>{vacuum.name||"Xiaomi Robot Vacuum E10"}</h2><p>{vacuum.model||"Xiaomi Home"} · {vacuum.online?"Online":"Offline"}</p></div><button className="detailClose" onClick={onClose}>×</button></div>
    <div className="vacuumStageV13">
      <div className="vacuumStageStatsV13"><span><small>Terület</small><strong>{vacuum.areaM2!==undefined?`${vacuum.areaM2.toFixed(1)} m²`:"—"}</strong></span><span><small>Időtartam</small><strong>{vacuum.durationSec!==undefined?fmtDuration(vacuum.durationSec):"—"}</strong></span><span><small>Akkumulátor</small><strong>{vacuum.battery!==undefined?`${vacuum.battery}%`:"—"}</strong></span></div>
      <div className="vacuumVisualV13"><i className={vacuum.online?"online":""}></i><div className="vacuumRobotV13">◉</div><span>{prettySmartValue(vacuum.state|| (vacuum.online?"Online":"Offline"))}</span></div>
    </div>
    <div className="vacuumControlGridV13">
      <button className="primary" disabled={!vacuum.online||!vacuum.controlReady} onClick={()=>onAction("start")}><span>▶</span><b>Indítás</b></button>
      <button disabled={!vacuum.online||!vacuum.controlReady} onClick={()=>onAction("pause")}><span>Ⅱ</span><b>Szünet</b></button>
      <button disabled={!vacuum.online||!vacuum.controlReady} onClick={()=>onAction("stop")}><span>■</span><b>Stop</b></button>
      <button disabled={!vacuum.online||!vacuum.controlReady} onClick={()=>onAction("dock")}><span>⌂</span><b>Dokkolás</b></button>
    </div>
    {vacuum.metrics&&vacuum.metrics.length>0&&<div className="detailInfoGrid vacuumMetricGridV13">{vacuum.metrics.slice(0,12).map(m=><div key={m.name}><span>{m.name.replace(/_/g," ")}</span><strong>{prettySmartValue(m.value)}{m.unit?` ${m.unit}`:""}</strong></div>)}</div>}
    <div className="vacuumNoteV13"><strong>{vacuum.controlReady?"Xiaomi Home helyi vezérlés aktív":"Xiaomi Home integráció előkészítve"}</strong><p>{vacuum.note}</p>{!vacuum.controlReady&&<small>A HomeHub nem küld találomra Xiaomi parancsot. A WD Bridge configban token + a konkrét E10 MIoT property/action mapping kell az aktiváláshoz.</small>}</div>
  </section></div>
}

function DeviceDetailDialog({device,onClose,onCommand}:{device:TuyaDevice;onClose:()=>void;onCommand:(d:TuyaDevice,code:string,value:unknown)=>void}){
  const kind=deviceKind(device),sm=statusMap(device);
  const isGate=kind==="gate",isCharger=kind==="charger",isClimate=kind==="climate";

  const gateActions=[
    {key:"start",label:"Start",patterns:["start_1","start","gate_start"]},
    {key:"pedestrian",label:"Személybejáró",patterns:["pedestrian_1","pedestrian","wicket"]},
    {key:"stop",label:"Stop",patterns:["stop_1","stop","gate_stop"]},
    {key:"open",label:"Nyitás",patterns:["open_1","gate_open","door_open","open"]},
    {key:"close",label:"Zárás",patterns:["close_1","gate_close","door_close","close"]},
    {key:"light",label:"Világítás",patterns:["light_1","light","lamp","light_switch"]},
  ];
  const gateState=findStatus(device,["door_sensor_state","gate_state","door_state","open_close_state","work_state"]);
  const warning=findStatus(device,["alarms","warning","alarm","fault","alert"]);
  const keepOpen=findStatus(device,["keep_open"]),pauseTime=findStatus(device,["pause_time"]),operativeMode=findStatus(device,["operative_mode_1"]);

  const chargerSwitch=findFunction(device,["switchsvg","charge_switch","start_charge","switch","power"],"Boolean");
  const chargerCharging=chargerIsCharging(device);
  const currentFn=actionFunction(device,["devicemaxseta","set_current","current_set","charge_current_set","current_limit"]);
  const delayFn=actionFunction(device,["setdelaytime","delay_time","set_delaytime","delay_charge"]);
  const chargeTimeFn=actionFunction(device,["setdefinetime","set_charge_time","charge_time_set","charge_time","duration"]);
  const[current,setCurrent]=useState(()=>currentFn&&sm[currentFn.code]!==undefined?String(Number(sm[currentFn.code])/Math.pow(10,Number(specValues(device,currentFn.code).scale||0))):"");
  const[delay,setDelay]=useState(()=>delayFn&&sm[delayFn.code]!==undefined?String(Number(sm[delayFn.code])/Math.pow(10,Number(specValues(device,delayFn.code).scale||0))):"");
  const[chargeTime,setChargeTime]=useState(()=>chargeTimeFn&&sm[chargeTimeFn.code]!==undefined?String(Number(sm[chargeTimeFn.code])/Math.pow(10,Number(specValues(device,chargeTimeFn.code).scale||0))):"");
  const currentMeta=numericFunctionMeta(device,currentFn),delayMeta=numericFunctionMeta(device,delayFn),chargeMeta=numericFunctionMeta(device,chargeTimeFn);
  const chargerMetrics=[
    ["Hőmérséklet",chargerMetric(device,["devicetemp","temperature","temp","charger_temp"],"°C")],
    ["Feszültség",chargerMetric(device,["a_voltage","voltage","cur_voltage","voltage_a","input_voltage"],"V")],
    ["Áramerősség",chargerMetric(device,["a_current","current","cur_current","electric_current","current_a"],"A")],
    ["Teljesítmény",chargerMetric(device,["devicekw","power","cur_power","active_power","charge_power"],"kW")],
    ["Energia",chargerMetric(device,["devicekwh","kwh","energy","total_energy","electricity"],"kWh")],
    ["CP",chargerMetric(device,["cp"],"")],
  ] as Array<[string,{value:string;unit:string}|null]>;
  const chargerEnergy=chargerMetric(device,["devicekwh","charge_energy_oncesvg","charge_energy_once","kwh","energy"],"kWh");
  const chargerInfo=[
    ["Állapot",chargerStateLabel(device)],
    ["Mód",findStatus(device,["work_modesvg","work_mode"])?prettySmartValue(findStatus(device,["work_modesvg","work_mode"])!.value):"—"],
    ["Töltött energia",chargerEnergy?`${chargerEnergy.value} ${chargerEnergy.unit}`:"—"],
    ["Töltési idő",findStatus(device,["ctime"])?prettySmartValue(findStatus(device,["ctime"])!.value):"—"],
    ["PE",findStatus(device,["pe"])?prettySmartValue(findStatus(device,["pe"])!.value):"—"],
    ["Művelet",findStatus(device,["chargingoperation"])?prettySmartValue(findStatus(device,["chargingoperation"])!.value):"—"],
  ] as Array<[string,string]>;
  const phaseMetrics=[
    ["L1 feszültség",chargerMetric(device,["a_voltage"],"V")],["L1 áram",chargerMetric(device,["a_current"],"A")],
    ["L2 feszültség",chargerMetric(device,["b_voltage"],"V")],["L2 áram",chargerMetric(device,["b_current"],"A")],
    ["L3 feszültség",chargerMetric(device,["c_voltage"],"V")],["L3 áram",chargerMetric(device,["c_current"],"A")],
  ] as Array<[string,{value:string;unit:string}|null]>;

  const climatePower=findFunction(device,["powersvg","switch","power"],"Boolean");
  const climateTempFn=findFunction(device,["temp_setsvg","temp_set","target_temp","temp_target"]);
  const climateModeFn=findFunction(device,["modesvg","mode"],"Enum");
  const windFn=findFunction(device,["windspeed","fan_speed","wind_speed"],"Enum");
  const upDownFn=actionFunction(device,["up_down_sweep"]),leftRightFn=actionFunction(device,["left_right_sweep"]),sleepFn=actionFunction(device,["sleep"]),freshAirFn=actionFunction(device,["fresh_air"]);
  const climateTargetMeta=numericFunctionMeta(device,climateTempFn);
  const[climateTarget,setClimateTarget]=useState(()=>{if(!climateTempFn||sm[climateTempFn.code]===undefined)return"";const scale=Number(specValues(device,climateTempFn.code).scale||0);return String(Number(sm[climateTempFn.code])/Math.pow(10,scale))});
  const climateMetrics=[
    ["Aktuális hőmérséklet",displayMetric(device,["temp_currentsvg","temp_current"],"°C")],
    ["Páratartalom",displayMetric(device,["humidity_currentsvg","humidity_current"],"%")],
    ["PM2.5",displayMetric(device,["pm25"],"µg/m³")],
    ["Levegőminőség",displayMetric(device,["airquality"],"")],
    ["Energia",displayMetric(device,["kwh","energy"],"kWh")],
    ["Üzemidő",displayMetric(device,["run_time","work_time"],"")],
  ] as Array<[string,{value:string;unit:string}|null]>;

  function sendNumeric(fn:TuyaSpec|undefined,raw:string,meta:ReturnType<typeof numericFunctionMeta>){
    if(!fn||!raw||!meta)return;const human=Number(raw);if(!Number.isFinite(human))return;
    const factor=Math.pow(10,meta.scale),value=Math.round(human*factor);
    if(value<meta.min||value>meta.max){window.alert(`Az engedélyezett tartomány: ${meta.min/factor}–${meta.max/factor}.`);return}
    if(meta.step>0&&Math.abs((value-meta.min)/meta.step-Math.round((value-meta.min)/meta.step))>1e-7){window.alert("Az érték nem illeszkedik a Tuya által megadott lépésközhöz.");return}
    onCommand(device,fn.code,value);
  }
  function boolControl(label:string,fn:TuyaSpec|undefined){if(!fn)return null;const on=boolState(device,fn.code);return <button className={on?"toggleAction on":"toggleAction"} onClick={()=>onCommand(device,fn.code,!on)}>{label}<small>{on?"Be":"Ki"}</small></button>}
  function enumControl(label:string,fn:TuyaSpec|undefined){if(!fn)return null;const range=enumRange(device,fn.code);if(!range.length)return null;const optionLabel=(v:string)=>/swing/i.test(label)&&v==="1"?"Be":/swing/i.test(label)&&v==="0"?"Ki":prettySmartValue(v);return <label className="detailSelect"><span>{label}</span><select value={String(sm[fn.code]??range[0])} onChange={e=>onCommand(device,fn.code,e.target.value)}>{range.map(v=><option key={v} value={v}>{optionLabel(v)}</option>)}</select></label>}

  const detailClass=isGate?"gateDetail":isCharger?"chargerDetail":"climateDetail";
  return <div className="modalBack" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className={`modal deviceDetail ${detailClass}`}><div className="detailHead"><div><span className="deviceKind">{labelKind(kind)}</span><h2>{device.name}</h2><p>{friendlyProductName(device)} · {device.online?"Online":"Offline"}</p></div><button className="closeBtn" onClick={onClose}>×</button></div>
    {isGate&&<><div className={`gateHero gate-${String(gateState?.value||"").toLowerCase().replace(/\s+/g,"-")}`}><div className="gateGlyph">▰▰▰</div><div><strong>Kapuvezérlés</strong><span>Állapot: {gateStateLabel(gateState?.value)}</span></div></div><div className="gateActionGrid">{gateActions.map(a=>{const fn=actionFunction(device,a.patterns);const needsConfirm=["start","pedestrian","open","close"].includes(a.key);const isLight=a.key==="light";const lightOn=isLight&&fn?boolState(device,fn.code):false;return <button key={a.key} className={isLight&&lightOn?"on":""} disabled={!device.online||!fn} onClick={()=>{if(!fn)return;if(needsConfirm&&!window.confirm(`${device.name}: ${a.label} végrehajtása?`))return;onCommand(device,fn.code,isLight?!lightOn:true)}}><span>{a.key==="start"?"▶":a.key==="stop"?"■":a.key==="open"?"⌂":a.key==="close"?"🔒":a.key==="light"?"💡":"●"}</span>{isLight?(lightOn?"Világítás ki":"Világítás be"):a.label}<small>{fn?`${fn.code}${isLight?` · ${lightOn?"Be":"Ki"}`:""}`:"nem elérhető"}</small></button>})}</div><div className="gateStatusGrid"><div><span>Kapu állapota</span><strong>{gateStateLabel(gateState?.value)}</strong></div><div><span>Figyelmeztetés</span><strong>{warning?prettySmartValue(warning.value):"Nincs"}</strong></div></div>{(keepOpen||pauseTime||operativeMode)&&<div className="detailInfoGrid">{keepOpen&&<div><span>Nyitva tartás</span><strong>{prettySmartValue(keepOpen.value)}</strong></div>}{pauseTime&&<div><span>Automata zárási idő</span><strong>{humanValue(pauseTime.value)}</strong></div>}{operativeMode&&<div><span>Üzemmód</span><strong>{prettySmartValue(operativeMode.value)}</strong></div>}</div>}<div className="safetyNote">A myGate Open / Close / Start / Stop / Pedestrian parancsai impulzusos DP-k, ezért ezekhez a HomeHub csak <b>On / true</b> impulzust küld. A <b>Light</b> külön állapottartó kapcsoló: Be és Ki értéket is küldünk, így a kapuvilágítás a HomeHubból kikapcsolható.</div></>}

    {isCharger&&<><div className="chargerHero"><div className="chargerMetrics">{chargerMetrics.map(([label,m])=><div key={label}><span>{label}</span><strong>{m?`${m.value}${m.unit?` ${m.unit}`:""}`:"—"}</strong></div>)}</div></div><div className="detailInfoGrid">{chargerInfo.map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="chargerActions">{chargerSwitch&&<button className={chargerCharging?"danger":"primary"} onClick={()=>onCommand(device,chargerSwitch.code,!chargerCharging)}>{chargerCharging?"Töltés leállítása":"Töltés indítása"}</button>}<SettingControl device={device} fn={currentFn} label="Max. áramerősség" value={current} setValue={setCurrent} meta={currentMeta} suffix="A" onSave={()=>sendNumeric(currentFn,current,currentMeta)} onCommand={onCommand}/><SettingControl device={device} fn={delayFn} label="Késleltetés" value={delay} setValue={setDelay} meta={delayMeta} suffix="h" onSave={()=>sendNumeric(delayFn,delay,delayMeta)} onCommand={onCommand}/><SettingControl device={device} fn={chargeTimeFn} label="Töltési idő" value={chargeTime} setValue={setChargeTime} meta={chargeMeta} suffix="h" onSave={()=>sendNumeric(chargeTimeFn,chargeTime,chargeMeta)} onCommand={onCommand}/></div>{phaseMetrics.some(([,m])=>Boolean(m))&&<><h3 className="detailSubhead">Fázisadatok</h3><div className="detailInfoGrid">{phaseMetrics.filter(([,m])=>Boolean(m)).map(([label,m])=><div key={label}><span>{label}</span><strong>{m?`${m.value} ${m.unit}`:"—"}</strong></div>)}</div></>}<div className="safetyNote">Áramerősséget a HomeHub csak akkor enged állítani, ha a Tuya API a DP-hez konkrét típust, minimumot, maximumot és lépésközt publikál. A Set16A / Set32A / Set40A / Set50A / set60a / set80a DP-ket nem aktiváljuk találomra.</div></>}

    {isClimate&&<><div className="climateHero"><div><span>Aktuális</span><strong>{climateMetrics[0][1]?`${climateMetrics[0][1]!.value} ${climateMetrics[0][1]!.unit}`:"—"}</strong></div><div><span>Cél</span><strong>{climateTempFn&&sm[climateTempFn.code]!==undefined?`${climateTarget||humanValue(sm[climateTempFn.code])} °C`:"—"}</strong></div><div><span>Mód</span><strong>{climateModeFn?prettySmartValue(sm[climateModeFn.code]):"—"}</strong></div></div><div className="climatePrimary">{climatePower&&<button className={Boolean(sm[climatePower.code])?"powerAction on":"powerAction"} onClick={()=>onCommand(device,climatePower.code,!Boolean(sm[climatePower.code]))}>{Boolean(sm[climatePower.code])?"Klíma kikapcsolása":"Klíma bekapcsolása"}</button>}{climateTempFn&&climateTargetMeta&&<SettingControl device={device} fn={climateTempFn} label="Célhőmérséklet" value={climateTarget} setValue={setClimateTarget} meta={climateTargetMeta} suffix="°C" onSave={()=>sendNumeric(climateTempFn,climateTarget,climateTargetMeta)} onCommand={onCommand}/>}</div><div className="climateControls">{enumControl("Üzemmód",climateModeFn)}{enumControl("Ventilátor",windFn)}{boolControl("Fel/le swing",upDownFn?.type.toLowerCase()==="boolean"?upDownFn:undefined)}{enumControl("Fel/le swing",upDownFn?.type.toLowerCase()==="enum"?upDownFn:undefined)}{boolControl("Bal/jobb swing",leftRightFn?.type.toLowerCase()==="boolean"?leftRightFn:undefined)}{enumControl("Bal/jobb swing",leftRightFn?.type.toLowerCase()==="enum"?leftRightFn:undefined)}{boolControl("Sleep",sleepFn?.type.toLowerCase()==="boolean"?sleepFn:undefined)}{boolControl("Friss levegő",freshAirFn?.type.toLowerCase()==="boolean"?freshAirFn:undefined)}</div><div className="detailInfoGrid">{climateMetrics.filter(([,m])=>Boolean(m)).map(([label,m])=><div key={label}><span>{label}</span><strong>{m?`${m.value}${m.unit?` ${m.unit}`:""}`:"—"}</strong></div>)}</div><div className="detailInfoGrid compact">{[["Szűrő",findStatus(device,["freshair_filter","dirty_filter"])],["Hiba",findStatus(device,["fault","fault2"])],["Firmware",findStatus(device,["sn_sw_ver"])],["Levegő",findStatus(device,["fresh_air"])]] .filter(([,p])=>Boolean(p)).map(([label,p])=><div key={String(label)}><span>{String(label)}</span><strong>{prettySmartValue((p as TuyaPoint).value)}</strong></div>)}</div><div className="safetyNote">A célhőmérséklet, ventilátor és mód csak a Tuya által publikált DP-specifikáció szerint vezérelhető. Ismeretlen enumot vagy tartományon kívüli hőfokot a HomeHub nem küld el.</div></>}
  </section></div>
}
function SettingControl({device,fn,label,value,setValue,meta,suffix,onSave,onCommand}:{device:TuyaDevice;fn:TuyaSpec|undefined;label:string;value:string;setValue:(v:string)=>void;meta:ReturnType<typeof numericFunctionMeta>;suffix:string;onSave:()=>void;onCommand:(d:TuyaDevice,code:string,value:unknown)=>void}){
  const options=fn?.type.toLowerCase()==="enum"?enumRange(device,fn.code):[];
  if(options.length>0)return <div className="settingRow"><div><strong>{label}</strong><small>A Tuya által engedélyezett értékek.</small></div><div className="settingInput"><select value={value||options[0]} onChange={e=>{setValue(e.target.value);onCommand(device,fn!.code,e.target.value)}}>{options.map(v=><option value={v} key={v}>{v}{suffix}</option>)}</select></div></div>;
  return <SettingRow label={label} value={value} setValue={setValue} meta={meta} suffix={suffix} onSave={onSave}/>;
}

function SettingRow({label,value,setValue,meta,suffix,onSave}:{label:string;value:string;setValue:(v:string)=>void;meta:ReturnType<typeof numericFunctionMeta>;suffix:string;onSave:()=>void}){
  return <div className="settingRow"><div><strong>{label}</strong><small>{meta?`${meta.min/Math.pow(10,meta.scale)}–${meta.max/Math.pow(10,meta.scale)} ${meta.unit||suffix}`:"A Tuya eszköz nem publikálja ezt a beállítást."}</small></div><div className="settingInput"><input disabled={!meta} type="number" step={meta?meta.step/Math.pow(10,meta.scale):1} min={meta?meta.min/Math.pow(10,meta.scale):undefined} max={meta?meta.max/Math.pow(10,meta.scale):undefined} value={value} onChange={e=>setValue(e.target.value)} placeholder={meta?String(meta.min/Math.pow(10,meta.scale)):"—"}/><span>{suffix}</span><button disabled={!meta||!value} onClick={onSave}>Beállítás</button></div></div>
}

function DeleteDialog({torrent,onClose,onDelete}:{torrent:Torrent;onClose:()=>void;onDelete:(deleteData:boolean)=>void}){
  return <div className="modalBack" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal"><span className="dangerMark">!</span><h2>Torrent törlése</h2><p><strong>{torrent.name}</strong></p><p>A WD My Cloudra már átmásolt példányhoz egyik művelet sem nyúl.</p><div className="modalActions"><button className="secondary" onClick={()=>onDelete(false)}>Csak torrent eltávolítása</button><button className="danger" onClick={()=>onDelete(true)}>Torrent + KD20 fájlok törlése</button><button className="ghost" onClick={onClose}>Mégse</button></div></section></div>
}

function NetworkDeviceCard({n}:{n:NetworkStatus}){
  return <article className={`networkDevice ${n.online?"online":"offline"}`}><div className="deviceHead"><div><span className={`deviceDot ${n.online?"on":""}`}></span><strong>{n.name}</strong></div><span className="deviceKind">{networkKind(n.kind)}</span></div><small>{n.ip||"IP keresése…"}{n.mac?` · ${n.mac}`:""}</small><div className="networkMeta"><span>{n.online?(n.latencyMs>0?`${n.latencyMs.toFixed(1)} ms`:"Jelen van"):"Nem elérhető"}</span>{n.adminUrl&&n.ip&&<a className={n.adminOnline===false?"mutedLink":""} href={n.adminUrl} target="_blank" rel="noreferrer">Admin{n.adminOnline===false?" (nem válaszol)":""}</a>}</div><em>{n.note}</em></article>
}

function TopoNode({title,subtitle,status,kind="node"}:{title:string;subtitle?:string;status?:NetworkStatus;kind?:string}){
  const known=Boolean(status);const on=status?.online;
  return <div className={`topoNode kind-${kind} ${known?(on?"online":"offline"):"passive"}`}><div className="topoNodeTitle"><span className={`deviceDot ${on?"on":""}`}></span><strong>{title}</strong></div>{subtitle&&<small>{subtitle}</small>}{status&&<span className="topoState">{status.online?(status.ip||"Online"):(status.ip?"Nem válaszol":"IP keresése…")}</span>}</div>
}

const observedArcherClients=[
  {name:"ESP_C2CD65",band:"2.4 GHz"},{name:"ESP_C37477",band:"2.4 GHz"},{name:"lwip0",band:"2.4 GHz"},{name:"Unknown",band:"2.4 GHz"},{name:"xiaomi-vacuum-b112_mibtAAB5",band:"2.4 GHz"},
  {name:"Unknown",band:"5 GHz"},{name:"Edina-A34-eszkoze",band:"5 GHz"},{name:"iPhone",band:"5 GHz"},{name:"iPhone",band:"5 GHz"},{name:"lwip0",band:"5 GHz"},{name:"RE220",band:"5 GHz",node:true},{name:"RE315 #1",band:"5 GHz",node:true},{name:"RE315 #2",band:"5 GHz",node:true},{name:"Watch",band:"5 GHz"},{name:"wlan0",band:"5 GHz"},{name:"wlan0",band:"5 GHz"},{name:"wlan0",band:"5 GHz"},{name:"wlan0",band:"5 GHz"},{name:"Technicolor CH USA",band:"vezetékes",node:true}
];
const observedRe315Clients=[{name:"lwip0",band:"2.4 GHz"},{name:"Watch",band:"2.4 GHz"},{name:"wlan0",band:"2.4 GHz"},{name:"wlan0",band:"2.4 GHz"},{name:"wlan0",band:"2.4 GHz"},{name:"wlan0",band:"2.4 GHz"},{name:"ANONYMOUS",band:"5 GHz"},{name:"Edina-A34-eszkoze",band:"5 GHz"}];

function WifiClientSnapshot(){
  return <section className="wifiClientsPanel"><div className="wifiClientsHead"><div><h3>Wi-Fi kliensek</h3><p>A TP-Link Tetherből felvett legutóbbi klienslista. A következő lépésben MAC/IP alapján automatikusan frissíthető.</p></div><span className="snapshotBadge">Pillanatkép</span></div><div className="wifiClientColumns"><div className="wifiClientGroup"><div className="wifiGroupTitle"><strong>Archer C6 · krankovics</strong><span>19 kliens</span></div><div className="clientChips">{observedArcherClients.map((c,i)=><span className={c.node?"clientChip node":"clientChip"} key={`${c.name}-${i}`}><b>{c.name}</b><small>{c.band}</small></span>)}</div></div><div className="wifiClientGroup"><div className="wifiGroupTitle"><strong>RE315 #1 · …:93:86</strong><span>8 kliens</span></div><div className="clientChips">{observedRe315Clients.map((c,i)=><span className="clientChip" key={`${c.name}-${i}`}><b>{c.name}</b><small>{c.band}</small></span>)}</div></div></div></section>
}

function NetworkTopology({network}:{network:NetworkStatus[]}){
  const byId=Object.fromEntries(network.map(n=>[n.id,n]));
  return <div className="topologyWrap">
    <div className="topologyLegend"><span><i className="legendDot online"></i> élő</span><span><i className="legendDot"></i> nem elérhető</span><span><i className="legendDot passive"></i> passzív / nem menedzselhető</span></div>
    <div className="topology topologyV11">
      <div className="topoRoot"><TopoNode title="Technicolor FGA2233" subtitle="Fő router · 192.168.1.1" status={byId["technicolor-fga2233"]} kind="gateway"/></div>
      <div className="topologySections">
        <section className="topoLane wifiLane"><header><span className="laneBadge wifi">Wi-Fi</span><strong>krankovics2</strong></header><div className="wifiDirect"><TopoNode title="Krankovics-MBP" subtitle="2.4 GHz · 192.168.1.114" status={byId["krankovics-mbp"]} kind="computer"/></div></section>
        <section className="topoLane ethernet ethernetV11"><header><span className="laneBadge ethernet">Ethernet</span><strong>Vezetékes hálózat</strong></header><div className="portsV11">
          <div className="portV11"><div className="portLabel">Port 1</div><TopoNode title="DESKTOP-E6K3SEK" subtitle="192.168.1.25" status={byId["desktop-e6k3sek"]} kind="computer"/></div>
          <div className="portV11 port2"><div className="portLabel">Port 2</div><TopoNode title="TL-SG108E" subtitle="Menedzselhető switch · 192.168.1.49" status={byId["tl-sg108e"]} kind="network-switch"/><div className="port2Tree"><div className="treeBranch"><TopoNode title="DorkaPC" subtitle="192.168.1.210" status={byId["dorkapc"]} kind="computer"/></div><div className="treeBranch chainBranch"><TopoNode title="D-Link GO-SW-5G" subtitle="Passzív gigabit switch" kind="network-switch"/><span className="chainArrow">↓</span><TopoNode title="TP-Link LiteWave LS105G" subtitle="Passzív gigabit switch" kind="network-switch"/><span className="chainArrow">↓</span><TopoNode title="davidgaming" subtitle="192.168.1.138" status={byId["davidgaming"]} kind="computer"/></div><div className="treeBranch meshBranchV11"><TopoNode title="Archer C6" subtitle="Mesh főpont · 192.168.1.129" status={byId["archer-c6"]} kind="router"/><div className="ssidLabel">Wi-Fi / mesh: <strong>krankovics</strong></div><div className="meshNodesV11"><TopoNode title="RE220" status={byId["re220"]} kind="extender"/><TopoNode title="RE315 #1" subtitle="MAC …:93:86 · 8 ismert kliens" status={byId["re315-1"]} kind="extender"/><TopoNode title="RE315 #2" status={byId["re315-2"]} kind="extender"/></div></div></div></div>
          <div className="portV11"><div className="portLabel">Port 3</div><TopoNode title="KD20 / oldnas" subtitle="Torrent NAS · 192.168.1.12" status={byId["kd20"]} kind="nas"/></div>
          <div className="portV11"><div className="portLabel">Port 4</div><TopoNode title="WD My Cloud" subtitle="Médiatár · 192.168.1.180" status={byId["wd-my-cloud"]} kind="nas"/></div>
        </div></section>
      </div>
    </div>
    <WifiClientSnapshot/>
  </div>
}


function triggerLabel(rule:AutomationRule,smart:SmartHome,network:NetworkStatus[]){
  const t=rule.trigger;
  if(t.type==="tuya.numeric"){const d=smart.devices.find(x=>x.id===t.deviceId);const op={gt:">",gte:"≥",lt:"<",lte:"≤",eq:"="}[t.operator];return `${d?.name||"Tuya eszköz"} · ${t.code} ${op} ${t.value}${t.forSeconds?` · ${Math.round(t.forSeconds/60)} percig`:""}`}
  if(t.type==="tuya.state"){const d=smart.devices.find(x=>x.id===t.deviceId);return `${d?.name||"Tuya eszköz"} · ${t.code} ${t.operator==="eq"?"=":"≠"} ${String(t.value)}${t.forSeconds?` · ${Math.round(t.forSeconds/60)} percig`:""}`}
  if(t.type==="network.online_window"){const n=network.find(x=>x.id===t.networkId);return `${n?.name||"Hálózati eszköz"} online · ${t.after}–${t.before}`}
  if(t.type==="network.new_device")return"Új MAC-cím jelenik meg a helyi hálózaton";
  return `Ütemezés · ${t.time} · ${t.days.length===7?"minden nap":t.days.map(x=>["V","H","K","Sze","Cs","P","Szo"][x]).join(", ")}`;
}
function actionLabel(action:AutomationAction,smart:SmartHome){
  if(action.type==="alert")return action.email===false?"HomeHub értesítés":"HomeHub + email alert";
  if(action.type==="ai.summary")return action.email===false?"AI összefoglaló a HomeHubban":"AI összefoglaló + email";
  if(action.type==="vacuum.command")return `Porszívó: ${action.action==="start"?"indítás":action.action}`;
  const d=smart.devices.find(x=>x.id===action.deviceId);return `${d?.name||"Tuya eszköz"}: ${action.code} → ${String(action.value)}`;
}

type ActionTemplate="temp_climate"|"gate_alert"|"machine_night"|"vacuum_schedule"|"new_device"|"ai_summary";
function AutomationComposer({smart,network,vacuum,onClose,onSaved,flash}:{smart:SmartHome;network:NetworkStatus[];vacuum?:VacuumStatus;onClose:()=>void;onSaved:()=>void;flash:(m:string)=>void}){
  const sensors=smart.devices.filter(d=>deviceKind(d)==="sensor"),climates=smart.devices.filter(d=>deviceKind(d)==="climate"),gates=smart.devices.filter(d=>deviceKind(d)==="gate"),machines=network.filter(n=>["computer","discovered"].includes(n.kind));
  const[template,setTemplate]=useState<ActionTemplate>("temp_climate");
  const[sensorId,setSensorId]=useState(sensors[0]?.id||"");const[climateId,setClimateId]=useState(climates[0]?.id||"");const[threshold,setThreshold]=useState("27");const[tempHold,setTempHold]=useState("2");
  const[gateId,setGateId]=useState(gates[0]?.id||"");const[gateMinutes,setGateMinutes]=useState("10");
  const[machineId,setMachineId]=useState(machines[0]?.id||"");const[after,setAfter]=useState("22:00");const[before,setBefore]=useState("06:00");
  const[vacTime,setVacTime]=useState("10:00");const[days,setDays]=useState<number[]>([1,2,3,4,5]);const[summaryTime,setSummaryTime]=useState("20:30");const[busy,setBusy]=useState(false);
  function tempCode(){const d=sensors.find(x=>x.id===sensorId);return d?findStatus(d,["temp_current","temp_currentsvg","va_temperature","temperature","temp_value","temp"])?.code||"":""}
  function climatePower(){const d=climates.find(x=>x.id===climateId);return d?findFunction(d,["powersvg","switch","power"],"Boolean")?.code||"Powersvg":"Powersvg"}
  async function save(){
    let payload:any;
    if(template==="temp_climate"){
      if(!sensorId||!climateId||!tempCode())return flash("Válassz hőmérséklet-szenzort és klímát.");
      const sensor=sensors.find(x=>x.id===sensorId),climate=climates.find(x=>x.id===climateId);
      payload={name:`Klíma automatikus indítás · ${threshold} °C`,enabled:true,trigger:{type:"tuya.numeric",deviceId:sensorId,code:tempCode(),operator:"gt",value:Number(threshold),forSeconds:Math.max(0,Number(tempHold))*60},actions:[{type:"tuya.command",deviceId:climateId,code:climatePower(),value:true}],cooldownSeconds:900};
      if(sensor&&climate)payload.name=`${sensor.name} > ${threshold} °C → ${climate.name}`;
    }else if(template==="gate_alert"){
      if(!gateId)return flash("Válaszd ki a kaput.");const gate=gates.find(x=>x.id===gateId);const code=findStatus(gate!,["door_sensor_state","gate_state","door_state"])?.code||"door_sensor_state";
      payload={name:"Kapu tartósan nyitva",enabled:true,trigger:{type:"tuya.state",deviceId:gateId,code,operator:"eq",value:"Opened",forSeconds:Math.max(1,Number(gateMinutes))*60},actions:[{type:"alert",subject:"HomeHub: a kapu nyitva maradt",message:"{{detail}}\nA feltétel {{time}} időpontban teljesült.",email:true}],cooldownSeconds:1800};
    }else if(template==="machine_night"){
      if(!machineId)return flash("Válassz hálózati gépet.");const n=machines.find(x=>x.id===machineId);
      payload={name:`${n?.name||"Gép"} online este`,enabled:true,trigger:{type:"network.online_window",networkId:machineId,after,before,forSeconds:60,timezone:"Europe/Budapest"},actions:[{type:"alert",subject:`HomeHub: ${n?.name||"gép"} online`,message:"{{detail}}\nÉszlelés: {{time}}",email:true}],cooldownSeconds:3600};
    }else if(template==="vacuum_schedule"){
      if(!vacuum?.configured)return flash("A Xiaomi porszívó még nincs konfigurálva.");
      payload={name:`Porszívó indítás ${vacTime}`,enabled:true,trigger:{type:"schedule",time:vacTime,days,timezone:"Europe/Budapest"},actions:[{type:"vacuum.command",action:"start"}],cooldownSeconds:3600};
    }else if(template==="ai_summary"){
      payload={name:`Esti AI összefoglaló ${summaryTime}`,enabled:true,trigger:{type:"schedule",time:summaryTime,days:[0,1,2,3,4,5,6],timezone:"Europe/Budapest"},actions:[{type:"ai.summary",subject:"HomeHub AI esti összefoglaló",email:true}],cooldownSeconds:3600};
    }else{
      payload={name:"Új hálózati eszköz alert",enabled:true,trigger:{type:"network.new_device"},actions:[{type:"alert",subject:"HomeHub: új eszköz a hálózaton",message:"{{detail}}\nÉszlelés: {{time}}",email:true}],cooldownSeconds:60};
    }
    setBusy(true);try{await api("/api/automations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});flash("Akció létrehozva.");onSaved();onClose()}catch(err){flash(`Akció hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setBusy(false)}
  }
  const templateDefs:Array<{id:ActionTemplate;title:string;desc:string;icon:string}>=[
    {id:"temp_climate",title:"Hőmérséklet → klíma",desc:"Szenzorérték alapján kapcsolja be a klímát.",icon:"❄"},
    {id:"gate_alert",title:"Nyitva maradt kapu",desc:"Tartós nyitás után HomeHub + email alert.",icon:"⌂"},
    {id:"machine_night",title:"Gép online este",desc:"Időablakban figyeli egy felvett gép jelenlétét.",icon:"◈"},
    {id:"vacuum_schedule",title:"Porszívó ütemezés",desc:"Megadott napokon és időben elindítja a porszívót.",icon:"◉"},
    {id:"new_device",title:"Új hálózati eszköz",desc:"Új MAC-cím megjelenésekor riaszt.",icon:"+"},
    {id:"ai_summary",title:"Esti AI összefoglaló",desc:"Naponta AI állapotösszefoglalót készít és emailben elküldi.",icon:"✦"}
  ];
  return <div className="modalBack actionModalBack" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="actionComposer"><div className="actionComposerHead"><div><span className="smartEyebrowV12">ÚJ AKCIÓ</span><h2>Automatizálás létrehozása</h2><p>Válassz egy kész mintát, majd állítsd be a feltételeket.</p></div><button className="detailClose" onClick={onClose}>×</button></div><div className="actionTemplateGrid">{templateDefs.map(x=><button key={x.id} className={template===x.id?"active":""} onClick={()=>setTemplate(x.id)}><i>{x.icon}</i><strong>{x.title}</strong><small>{x.desc}</small></button>)}</div><div className="actionFields">
    {template==="temp_climate"&&<><label>Hőmérséklet-szenzor<select value={sensorId} onChange={e=>setSensorId(e.target.value)}>{sensors.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Küszöbérték<input type="number" step="0.5" value={threshold} onChange={e=>setThreshold(e.target.value)}/><span>°C felett</span></label><label>Legalább<input type="number" min="0" value={tempHold} onChange={e=>setTempHold(e.target.value)}/><span>percig</span></label><label>Klíma<select value={climateId} onChange={e=>setClimateId(e.target.value)}>{climates.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label></>}
    {template==="gate_alert"&&<><label>Kapu<select value={gateId} onChange={e=>setGateId(e.target.value)}>{gates.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Riasztás ennyi idő után<input type="number" min="1" value={gateMinutes} onChange={e=>setGateMinutes(e.target.value)}/><span>perc</span></label></>}
    {template==="machine_night"&&<><label>Figyelt gép<select value={machineId} onChange={e=>setMachineId(e.target.value)}>{machines.map(n=><option key={n.id} value={n.id}>{n.name} · {n.ip||n.mac}</option>)}</select></label><label>Időablak kezdete<input type="time" value={after} onChange={e=>setAfter(e.target.value)}/></label><label>Időablak vége<input type="time" value={before} onChange={e=>setBefore(e.target.value)}/></label></>}
    {template==="vacuum_schedule"&&<><label>Indítás<input type="time" value={vacTime} onChange={e=>setVacTime(e.target.value)}/></label><div className="weekdayPicker"><span>Napok</span>{[1,2,3,4,5,6,0].map(d=><button key={d} className={days.includes(d)?"active":""} onClick={()=>setDays(v=>v.includes(d)?v.filter(x=>x!==d):[...v,d])}>{["V","H","K","Sze","Cs","P","Szo"][d]}</button>)}</div></>}
    {template==="ai_summary"&&<><label>Összefoglaló időpontja<input type="time" value={summaryTime} onChange={e=>setSummaryTime(e.target.value)}/></label><div className="actionInfoBox"><strong>OpenAI API szükséges.</strong><span>A szabály minden nap lekéri az aktuális HomeHub összefoglalót, eltárolja az Értesítések között és emailt is küld, ha az SMTP be van állítva.</span></div></>}
    {template==="new_device"&&<div className="actionInfoBox"><strong>Első induláskor nincs riasztási vihar.</strong><span>A HomeHub a már jelen lévő MAC-címeket baseline-ként eltárolja. Csak ezután felbukkanó új eszközre küld alertet.</span></div>}
  </div><div className="actionComposerFooter"><button className="ghost" onClick={onClose}>Mégse</button><button className="primaryAction" disabled={busy||template==="vacuum_schedule"&&days.length===0} onClick={save}>{busy?"Mentés…":"Akció létrehozása"}</button></div></section></div>
}

function ActionsTab({state,smart,network,vacuum,reload,flash}:{state:AutomationState;smart:SmartHome;network:NetworkStatus[];vacuum?:VacuumStatus;reload:()=>void;flash:(m:string)=>void}){
  const[composer,setComposer]=useState(false);const rules=state.rules||[],alerts=state.alerts||[];
  async function putRule(rule:AutomationRule,patch:Partial<AutomationRule>){const next={name:rule.name,enabled:rule.enabled,trigger:rule.trigger,actions:rule.actions,cooldownSeconds:rule.cooldownSeconds,...patch};try{await api(`/api/automations/${rule.id}`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(next)});reload()}catch(err){flash(`Akció hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  async function remove(rule:AutomationRule){if(!window.confirm(`Törlöd ezt az akciót?\n${rule.name}`))return;await api(`/api/automations/${rule.id}`,{method:"DELETE"});reload()}
  async function run(rule:AutomationRule){try{await api(`/api/automations/${rule.id}/run`,{method:"POST"});flash(`${rule.name}: tesztfuttatás elindítva`);setTimeout(reload,500)}catch(err){flash(`Teszt hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  async function readAll(){await api("/api/alerts/read-all",{method:"POST"});reload()}
  return <div className="tabPanel actionsTab">{composer&&<AutomationComposer smart={smart} network={network} vacuum={vacuum} onClose={()=>setComposer(false)} onSaved={reload} flash={flash}/>}<section className="panel actionsHero"><div><span className="smartEyebrowV12">HOMEHUB AUTOMATION</span><h2>Akciók</h2><p>Feltétel, időzítés vagy hálózati esemény alapján automatikusan vezérelheted az otthonodat és riasztást kérhetsz.</p></div><button className="primaryAction" onClick={()=>setComposer(true)}>+ Új akció</button></section><section className="automationStats"><div><span>Aktív</span><strong>{rules.filter(r=>r.enabled).length}</strong></div><div><span>Szabály</span><strong>{rules.length}</strong></div><div><span>Olvasatlan alert</span><strong>{state.unread||0}</strong></div><div><span>Email</span><strong>{state.email?.configured?"Kész":"Beállítandó"}</strong><small>{state.email?.configured?`${state.email.recipients} címzett`:`SMTP env szükséges`}</small></div></section><section className="panel actionRulesPanel"><div className="sectionHead"><div><h2>Automatizálások</h2><p>A feltételes szabályok 10 másodperces motorral futnak; a hálózati állapot a WD Bridge frissítéseiből érkezik.</p></div></div>{rules.length===0?<div className="empty">Még nincs akció. A fenti öt kész mintából gyorsan létrehozhatod az elsőt.</div>:<div className="actionRuleList">{rules.map(rule=><article className={rule.enabled?"actionRule enabled":"actionRule"} key={rule.id}><div className="ruleStatus"><button className={rule.enabled?"ruleToggle on":"ruleToggle"} onClick={()=>putRule(rule,{enabled:!rule.enabled})}><i></i></button></div><div className="ruleMain"><div className="ruleTitle"><strong>{rule.name}</strong>{rule.lastTriggeredAt&&<span>utoljára: {new Date(rule.lastTriggeredAt).toLocaleString("hu-HU")}</span>}</div><div className="ruleFlow"><span className="ruleWhen">HA</span><b>{triggerLabel(rule,smart,network)}</b><span className="ruleThen">AKKOR</span><b>{rule.actions.map(a=>actionLabel(a,smart)).join(" + ")}</b></div></div><div className="ruleActions"><button onClick={()=>run(rule)}>Teszt</button><button className="deleteBtn" onClick={()=>remove(rule)}>Törlés</button></div></article>)}</div>}</section><section className="panel alertsPanel"><div className="sectionHead"><div><h2>Értesítések</h2><p>Az emailtől függetlenül minden riasztás megmarad a HomeHubban.</p></div>{state.unread>0&&<button className="ghost" onClick={readAll}>Mind olvasott</button>}</div>{alerts.length===0?<div className="empty">Még nincs riasztás.</div>:<div className="alertList">{alerts.slice(0,20).map(a=><article className={a.readAt?"alertItem":"alertItem unread"} key={a.id}><div className="alertIcon">{a.emailSent?"✉":"!"}</div><div><strong>{a.subject}</strong><p>{a.message}</p><small>{new Date(a.createdAt).toLocaleString("hu-HU")} · {a.emailRequested?(a.emailSent?"email elküldve":`email: ${a.emailError||"nem sikerült"}`):"csak HomeHub"}</small></div></article>)}</div>}</section></div>
}


function AIAssistantTab({ai,settings,smart,network,reload,flash,updateSettings}:{ai:AIState;settings:State["settings"];smart:SmartHome;network:NetworkStatus[];reload:()=>void;flash:(m:string)=>void;updateSettings:(p:Partial<State["settings"]>)=>Promise<void>}){
  const[messages,setMessages]=useState<AIChatMessage[]>([{role:"assistant",text:"Kérdezz rá az otthon aktuális állapotára, kérj automatizálási tervet, vagy készíts egy jóváhagyható gyors parancsot."}]);
  const[chatText,setChatText]=useState("");const[chatBusy,setChatBusy]=useState(false);
  const[automationText,setAutomationText]=useState("Ha a fenti nappaliban 27 °C fölé megy a hőmérséklet 5 percre, kapcsold be a klímát.");
  const[automationDraft,setAutomationDraft]=useState<AIAutomationDraftResult|null>(null);const[automationBusy,setAutomationBusy]=useState(false);
  const[actionText,setActionText]=useState("Kapcsold be a klímát.");const[actionDraft,setActionDraft]=useState<AIActionDraftResult|null>(null);const[actionBusy,setActionBusy]=useState(false);
  const starters=["Miért megy most a klíma?","Melyik gép volt online éjjel?","Nyitva maradt ma a kapu?","Milyen eszköz igényel most figyelmet?"];
  async function sendChat(text=chatText){const q=text.trim();if(!q||chatBusy||!ai.configured||settings.aiMode==="off")return;setMessages(v=>[...v,{role:"user",text:q}]);setChatText("");setChatBusy(true);try{const r=await api("/api/ai/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:q})});setMessages(v=>[...v,{role:"assistant",text:String(r.text||"Nem érkezett válasz.")}])}catch(err){flash(`AI hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setChatBusy(false)}}
  async function summary(){if(!ai.configured||settings.aiMode==="off")return;setChatBusy(true);try{const r=await api("/api/ai/summary",{method:"POST"});setMessages(v=>[...v,{role:"user",text:"Készíts aktuális HomeHub összefoglalót."},{role:"assistant",text:String(r.text||"Nem érkezett összefoglaló.")}])}catch(err){flash(`AI összefoglaló hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setChatBusy(false)}}
  async function makeAutomation(){if(!automationText.trim()||automationBusy)return;setAutomationBusy(true);setAutomationDraft(null);try{const r=await api("/api/ai/automation-draft",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({request:automationText})}) as AIAutomationDraftResult;setAutomationDraft(r)}catch(err){flash(`AI akcióterv hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setAutomationBusy(false)}}
  async function saveAutomation(){if(!automationDraft?.draft||!automationDraft.valid)return;try{await api("/api/automations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(automationDraft.draft)});flash("AI akció mentve. Alapból aktív, az Akciók tabon kikapcsolható.");setAutomationDraft(null);reload()}catch(err){flash(`Mentési hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  async function makeAction(){if(!actionText.trim()||actionBusy)return;setActionBusy(true);setActionDraft(null);try{const r=await api("/api/ai/action-draft",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({request:actionText})}) as AIActionDraftResult;setActionDraft(r)}catch(err){flash(`AI parancstervezés hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setActionBusy(false)}}
  async function executeAction(){if(!actionDraft?.valid||!actionDraft.plan||settings.aiMode!=="approved")return;const p=actionDraft.plan;const extra=p.risk==="medium"?"\n\nEz közepes kockázatú művelet.":"";if(!window.confirm(`${p.summary}${extra}\n\nVégrehajtod?`))return;setActionBusy(true);try{await api("/api/ai/action-execute",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({confirm:true,plan:p})});flash("AI által tervezett művelet végrehajtva / sorba állítva.");setActionDraft(null);setTimeout(reload,600)}catch(err){flash(`AI végrehajtási hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setActionBusy(false)}}
  const modeLabel=(m:AIMode)=>m==="off"?"Kikapcsolva":m==="suggest"?"Csak javaslat":"Jóváhagyott végrehajtás";
  return <div className="tabPanel aiTabV15">
    <section className="panel aiHeroV15"><div><span className="smartEyebrowV12">HOMEHUB AI</span><h2>AI Asszisztens</h2><p>Az AI értelmezi a HomeHub aktuális állapotát, szabályt tervez és jóváhagyás után alacsonyabb kockázatú műveletet is végrehajthat.</p></div><div className="aiHeroStateV15"><span className={ai.configured?"aiStatusV15 ready":"aiStatusV15"}><i></i>{ai.configured?`OpenAI · ${ai.model}`:"OpenAI API nincs beállítva"}</span><small>Policy: minden végrehajtás külön megerősítést kér</small></div></section>
    {!ai.configured&&<section className="panel aiSetupV15"><strong>Az AI modul még nincs konfigurálva.</strong><p>Renderben add hozzá az <code>OPENAI_API_KEY</code> változót. Opcionálisan az <code>OPENAI_MODEL</code> értékét is megadhatod. A kulcs kizárólag a szerveren marad, a böngésző nem kapja meg.</p></section>}
    <section className="panel aiModePanelV15"><div><h3>AI mód</h3><p>A mód a WD-n tárolt HomeHub state része, ezért Render újraindítás után is megmarad.</p></div><div className="aiModePickerV15">{(["off","suggest","approved"] as AIMode[]).map(m=><button key={m} className={settings.aiMode===m?"active":""} onClick={()=>updateSettings({aiMode:m})}><strong>{modeLabel(m)}</strong><small>{m==="off"?"Nincs API-hívás":m==="suggest"?"Chat + tervek, nincs végrehajtás":"Csak külön jóváhagyással hajt végre"}</small></button>)}</div></section>
    <div className="aiGridV15">
      <section className="panel aiChatPanelV15"><div className="aiSectionHeadV15"><div><span className="smartEyebrowV12">KÉRDEZZ</span><h3>Otthon-asszisztens</h3></div><button className="ghost" disabled={!ai.configured||settings.aiMode==="off"||chatBusy} onClick={summary}>Aktuális összefoglaló</button></div><div className="aiStarterV15">{starters.map(x=><button key={x} disabled={!ai.configured||settings.aiMode==="off"} onClick={()=>sendChat(x)}>{x}</button>)}</div><div className="aiMessagesV15">{messages.map((m,i)=><article key={i} className={m.role==="assistant"?"aiMessageV15 assistant":"aiMessageV15 user"}><span>{m.role==="assistant"?"AI":"Te"}</span><p>{m.text}</p></article>)}{chatBusy&&<article className="aiMessageV15 assistant thinking"><span>AI</span><p>Elemzem a HomeHub állapotát…</p></article>}</div><form className="aiComposerV15" onSubmit={e=>{e.preventDefault();sendChat()}}><textarea value={chatText} onChange={e=>setChatText(e.target.value)} placeholder="Például: Mi történt a hálózaton ma este?"/><button disabled={!ai.configured||settings.aiMode==="off"||chatBusy||!chatText.trim()}>Küldés</button></form></section>
      <section className="panel aiAutomationPanelV15"><span className="smartEyebrowV12">TERMÉSZETES NYELV → AKCIÓ</span><h3>AI akciókészítő</h3><p>Írd le normál mondatban a szabályt. Az AI csak a ténylegesen ismert eszköz- és DP-azonosítókból épít draftot.</p><textarea value={automationText} onChange={e=>setAutomationText(e.target.value)}/><button className="primaryAction" disabled={!ai.configured||settings.aiMode==="off"||automationBusy||!automationText.trim()} onClick={makeAutomation}>{automationBusy?"Tervezés…":"Szabály tervezése"}</button>{automationDraft&&<div className={automationDraft.valid?"aiDraftV15 valid":"aiDraftV15 warning"}><div className="aiDraftTitleV15"><strong>{automationDraft.draft?.name||"Nem menthető draft"}</strong><span>{automationDraft.valid?"Validált":"Ellenőrzést igényel"}</span></div><p>{automationDraft.explanation}</p>{automationDraft.draft&&<div className="aiRulePreviewV15"><span>HA</span><b>{triggerLabel({id:"ai",createdAt:"",updatedAt:"",lastTriggeredAt:undefined,...automationDraft.draft},smart,network)}</b><span>AKKOR</span><b>{automationDraft.draft.actions.map(a=>actionLabel(a,smart)).join(" + ")}</b></div>}{automationDraft.warnings.length>0&&<ul>{automationDraft.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>}<button disabled={!automationDraft.valid||!automationDraft.draft} onClick={saveAutomation}>Mentés az Akciók közé</button></div>}</section>
    </div>
    <section className="panel aiQuickActionV15"><div className="aiSectionHeadV15"><div><span className="smartEyebrowV12">JÓVÁHAGYOTT VÉGREHAJTÁS</span><h3>Gyors AI parancs</h3><p>Az AI először csak tervet készít. A szerver újraellenőrzi a DP-t és a biztonsági policy-t, majd külön megerősítés után hajtja végre.</p></div><span className={settings.aiMode==="approved"?"aiExecutionBadgeV15 on":"aiExecutionBadgeV15"}>{settings.aiMode==="approved"?"Engedélyezve":"Csak javaslat"}</span></div><div className="aiQuickComposerV15"><input value={actionText} onChange={e=>setActionText(e.target.value)} placeholder="Például: kapcsold be a klímát"/><button disabled={!ai.configured||settings.aiMode==="off"||actionBusy||!actionText.trim()} onClick={makeAction}>{actionBusy?"Elemzés…":"Parancsterv"}</button></div>{actionDraft&&<div className={`aiActionPlanV15 risk-${actionDraft.plan.risk}`}><div><strong>{actionDraft.plan.summary||"Nincs végrehajtható művelet"}</strong><p>{actionDraft.warning||actionDraft.plan.reason}</p><small>{actionDraft.plan.kind!=="none"?`${actionDraft.plan.kind} · ${actionDraft.plan.code||actionDraft.plan.vacuumAction}`:"A kérés blokkolva vagy nem eszközparancs."}</small></div><button disabled={!actionDraft.valid||settings.aiMode!=="approved"||actionDraft.plan.risk==="blocked"||actionBusy} onClick={executeAction}>{settings.aiMode!=="approved"?"Válts jóváhagyott módra":"Jóváhagyás és végrehajtás"}</button></div>}<div className="aiSafetyStripV15"><b>Mindig blokkolt AI-ból:</b><span>kapunyitás/zárás és gate parancsok</span><span>learn / erase / reset telepítő DP-k</span><span>EV töltő áramlimit és nagyáramú preset módosítás</span></div></section>
  </div>
}

function MediaTab({media,bridgeOnline}:{media?:MediaSnapshot;bridgeOnline:boolean}){
  const[query,setQuery]=useState(""),[folder,setFolder]=useState("all"),[sort,setSort]=useState<"new"|"name"|"size">("new");
  const folders=useMemo(()=>Array.from(new Set((media?.items||[]).map(i=>i.folder).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"hu")),[media?.items]);
  const visible=useMemo(()=>{
    const q=query.trim().toLowerCase();
    const rows=(media?.items||[]).filter(i=>(folder==="all"||i.folder===folder)&&(!q||`${i.name} ${i.folder}`.toLowerCase().includes(q)));
    return [...rows].sort((a,b)=>sort==="name"?a.name.localeCompare(b.name,"hu"):sort==="size"?b.sizeBytes-a.sizeBytes:new Date(b.modifiedAt).getTime()-new Date(a.modifiedAt).getTime());
  },[media?.items,query,folder,sort]);
  const nativeCount=(media?.items||[]).filter(i=>i.nativePlay).length;
  return <div className="tabPanel mediaTabV16">
    <section className="panel mediaHeroV16"><div><span className="smartEyebrowV12">WD MY CLOUD</span><h2>Médiatár</h2><p>A WD-n lévő filmeket közvetlenül az otthoni hálózatról nyitja meg. A videó nem megy át a Renderen, így a teljes helyi hálózati sebesség használható.</p></div><div className="mediaHeroStateV16"><span className={media?.online&&bridgeOnline?"mediaStatusV16 ready":"mediaStatusV16"}><i></i>{media?.online&&bridgeOnline?`${media.count} film elérhető`:"Médiatár nem elérhető"}</span><small>{media?.publicBaseUrl||"A WD Bridge media server még nem jelentkezett."}</small></div></section>
    {!media?.enabled&&<section className="panel mediaSetupV16"><strong>A Média modul ki van kapcsolva a WD Bridge-ben.</strong><p>A <code>media.enabled</code> értékét állítsd <code>true</code>-ra. A v0.16 régi konfigurációnál automatikusan a <code>Filmek</code> mappát használja.</p></section>}
    {media?.enabled&&media.error&&<section className="panel mediaSetupV16"><strong>A WD médiamappa nem olvasható.</strong><p>{media.error}</p></section>}
    <section className="mediaStatsV16"><div><span>Filmek</span><strong>{media?.count||0}</strong><small>indexelt videófájl</small></div><div><span>iPhone natív</span><strong>{nativeCount}</strong><small>MP4 / M4V / MOV</small></div><div><span>Egyéb formátum</span><strong>{Math.max(0,(media?.count||0)-nativeCount)}</strong><small>Infuse / VLC ajánlott</small></div><div><span>Elérés</span><strong>{media?.online?"LAN":"Offline"}</strong><small>WD → iPhone közvetlenül</small></div></section>
    <section className="panel mediaLibraryV16"><div className="mediaToolbarV16"><label className="mediaSearchV16"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Film keresése…"/></label><select value={folder} onChange={e=>setFolder(e.target.value)}><option value="all">Minden mappa</option>{folders.map(f=><option key={f} value={f}>{f}</option>)}</select><select value={sort} onChange={e=>setSort(e.target.value as "new"|"name"|"size")}><option value="new">Legújabb</option><option value="name">Név szerint</option><option value="size">Méret szerint</option></select></div>
      {media?.truncated&&<div className="infoLine">A médiatár nagyobb a beállított indexlimitenél. A Bridge jelenleg az első {media.count} videót küldi a HomeHubnak.</div>}
      <div className="mediaListV16">{visible.map(item=><article className="mediaItemV16" key={item.id}><div className="mediaGlyphV16">▶</div><div className="mediaMainV16"><strong title={item.name}>{item.name}</strong><span>{item.folder||"Filmek"}</span><small>{fmtBytes(item.sizeBytes)} · {item.extension.toUpperCase()} · {new Date(item.modifiedAt).toLocaleDateString("hu-HU")}</small></div><div className="mediaBadgesV16"><span className={item.nativePlay?"native":"app"}>{item.nativePlay?"iPhone":"Infuse / VLC"}</span></div><div className="mediaActionsV16"><a className="primary" href={item.playUrl} target="_blank" rel="noreferrer">{item.nativePlay?"Lejátszás":"Megnyitás"}</a><a className="secondary" href={item.downloadUrl} target="_blank" rel="noreferrer">Offline letöltés</a></div></article>)}{visible.length===0&&<div className="empty">{media?.online?"Nincs a szűrésnek megfelelő film.":"A WD Bridge még nem küldött médiaindexet."}</div>}</div>
    </section>
    <section className="panel mediaHelpV16"><div><h3>iPhone használat</h3><p>Az MP4, M4V és MOV fájlok a Safari/iOS lejátszóban közvetlenül indulhatnak. MKV, AVI és hasonló formátumokhoz az Infuse vagy a VLC a biztosabb megoldás.</p></div><div className="mediaStepsV16"><span><b>1</b> iPhone ugyanazon az otthoni Wi-Fi-n</span><span><b>2</b> Lejátszás vagy Offline letöltés</span><span><b>3</b> Letöltött fájl a Fájlok appból is megnyitható</span></div><div className="safetyNote">A HomeHub 24 órás, aláírt helyi linkeket használ. A médiafájlok nem kerülnek a Render szerverére és nem lesznek publikus internetes URL-en elérhetők.</div></section>
  </div>
}

function App(){
  const[auth,setAuth]=useState<"checking"|"yes"|"no">("checking"),[state,setState]=useState<State|null>(null),[mediaLibrary,setMediaLibrary]=useState<MediaSnapshot|undefined>(),[magnet,setMagnet]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[deleteTarget,setDeleteTarget]=useState<Torrent|null>(null),[detailTarget,setDetailTarget]=useState<TuyaDevice|null>(null),[vacuumDetail,setVacuumDetail]=useState(false),[tab,setTab]=useState<Tab>(initialTab),[smartFilter,setSmartFilter]=useState<SmartFilter>("all"),[smartQuery,setSmartQuery]=useState(""),[smartOnlineOnly,setSmartOnlineOnly]=useState(false);
  async function checkAuth(){const r=await fetch("/api/auth/status");const j=await r.json();setAuth(j.authenticated?"yes":"no")}
  async function load(){try{setState(await api("/api/state"));setAuth("yes")}catch(err){if(err instanceof Error&&err.message==="AUTH_REQUIRED")setAuth("no")}}
  useEffect(()=>{checkAuth();if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(r=>r.update()).catch(()=>{})},[]);
  useEffect(()=>{if(auth!=="yes")return;load();const id=setInterval(load,3000);return()=>clearInterval(id)},[auth]);
  useEffect(()=>{if(auth!=="yes"||tab!=="media")return;let active=true;const getMedia=async()=>{try{const m=await api("/api/media") as MediaSnapshot;if(active)setMediaLibrary(m)}catch(err){if(active&&err instanceof Error&&err.message==="AUTH_REQUIRED")setAuth("no")}};getMedia();const id=setInterval(getMedia,60000);return()=>{active=false;clearInterval(id)}},[auth,tab]);
  useEffect(()=>{const onHash=()=>setTab(initialTab());window.addEventListener("hashchange",onHash);return()=>window.removeEventListener("hashchange",onHash)},[]);
  const torrents=state?.snapshot?.kd20.torrents||[],printer=state?.snapshot?.printer,network=state?.snapshot?.network||[],vacuum=state?.snapshot?.vacuum,mediaSummary=state?.snapshot?.media,media=mediaLibrary??mediaSummary,smart:SmartHome=state?.smartHome??{configured:false,online:false,lastUpdatedAt:null,devices:[],scenes:[]},automation:AutomationState=state?.automation??{rules:[],alerts:[],unread:0,email:{configured:false,recipients:0}},ai:AIState=state?.ai??{configured:false,model:"gpt-5",mode:state?.settings?.aiMode||"suggest",policy:"confirm-before-execute"};
  const totalDl=useMemo(()=>torrents.reduce((a,t)=>a+t.rateDownload,0),[torrents]),totalUl=useMemo(()=>torrents.reduce((a,t)=>a+t.rateUpload,0),[torrents]),wdUsed=state?.snapshot?.wd.totalBytes?1-state.snapshot.wd.freeBytes/state.snapshot.wd.totalBytes:0;
  const smartVisible=smart.devices.filter(d=>(smartFilter==="all"||deviceKind(d)===smartFilter)&&(!smartOnlineOnly||d.online)&&(!smartQuery.trim()||`${d.name} ${d.productName} ${d.category}`.toLowerCase().includes(smartQuery.trim().toLowerCase()))).sort((a,b)=>Number(b.online)-Number(a.online)||a.name.localeCompare(b.name,"hu"));
  const vacuumVisible=Boolean(vacuum?.configured&&(smartFilter==="all"||smartFilter==="vacuum")&&(!smartOnlineOnly||vacuum.online)&&(!smartQuery.trim()||`${vacuum.name} ${vacuum.model}`.toLowerCase().includes(smartQuery.trim().toLowerCase())));
  const smartDeviceTotal=smart.devices.length+(vacuum?.configured?1:0);
  const onlineSmart=smart.devices.filter(d=>d.online).length+(vacuum?.configured&&vacuum.online?1:0),offlineSmart=smartDeviceTotal-onlineSmart;
  const controllableSmart=smart.devices.filter(d=>["switch","light","climate","charger","gate"].includes(deviceKind(d))).length+(vacuum?.configured&&vacuum.controlReady?1:0);
  const resolvedDetail=detailTarget?(smart.devices.find(d=>d.id===detailTarget.id)||detailTarget):null;
  const runningTorrents=torrents.filter(t=>t.status===4).length;
  function chooseTab(next:Tab){setTab(next);window.history.replaceState(null,"",`#${next}`);window.scrollTo({top:0,behavior:"smooth"})}
  function flash(m:string){setNotice(m);window.setTimeout(()=>setNotice(""),4000)}
  async function addMagnet(e:React.FormEvent){e.preventDefault();if(!magnet.trim())return;setBusy(true);try{await api("/api/torrents/magnet",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({magnet})});setMagnet("");flash("Magnet link elküldve a KD20-nak.")}catch(err){flash(`Hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setBusy(false);load()}}
  async function addFile(file?:File){if(!file)return;const fd=new FormData();fd.append("torrent",file);setBusy(true);try{await api("/api/torrents/file",{method:"POST",body:fd});flash(".torrent fájl elküldve a KD20-nak.")}catch(err){flash(`Hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}finally{setBusy(false);load()}}
  async function copy(t:Torrent){try{await api(`/api/torrents/${t.id}/copy`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});flash("Másolási feladat elküldve.")}catch(err){flash(`Hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}load()}
  async function retryCopy(hash:string){try{await api(`/api/copies/${encodeURIComponent(hash)}/retry`,{method:"POST"});flash("Másolás újrapróbálása elküldve.")}catch(err){flash(`Hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}load()}
  async function removeTorrent(deleteData:boolean){if(!deleteTarget)return;const t=deleteTarget;setDeleteTarget(null);try{await api(`/api/torrents/${t.id}`,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({deleteData,confirm:true})});flash(deleteData?"Torrent és KD20 fájlok törlése elküldve. A WD másolat megmarad.":"Torrent eltávolítása elküldve. A KD20 fájlok megmaradnak.")}catch(err){flash(`Törlési hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}setTimeout(load,1000)}
  async function updateSettings(patch:Partial<State["settings"]>){if(!state)return;const next={...state.settings,...patch};try{await api("/api/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(next)});load()}catch(err){flash(`Hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  async function smartCommand(d:TuyaDevice,code:string,value:unknown){try{await api(`/api/smart-home/devices/${encodeURIComponent(d.id)}/command`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code,value,confirm:deviceKind(d)==="gate"||isDangerous(d.name)})});flash(`${d.name}: parancs elküldve`);setTimeout(load,900)}catch(err){flash(`Smart Life hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  async function runScene(s:TuyaScene){const dangerous=isDangerous(s.name);if(dangerous&&!window.confirm(`${s.name}: biztosan elindítod ezt a jelenetet?`))return;try{await api(`/api/smart-home/scenes/${encodeURIComponent(s.id)}/run`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({confirm:dangerous})});flash(`${s.name}: jelenet elindítva`);setTimeout(load,700)}catch(err){flash(`Jelenet hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  async function refreshSmart(){try{await api("/api/smart-home/refresh",{method:"POST"});load();flash("Smart Life frissítve")}catch(err){flash(`Tuya hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}

  async function vacuumAction(action:"start"|"pause"|"stop"|"dock"){try{await api("/api/vacuum/command",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action})});flash(`Porszívó: ${action==="start"?"indítás":action==="pause"?"szünet":action==="stop"?"stop":"dokkolás"} elküldve`);setTimeout(load,900)}catch(err){flash(`Porszívó hiba: ${err instanceof Error?err.message:"ismeretlen"}`)}}
  async function logout(){await fetch("/api/auth/logout",{method:"POST"});setState(null);setMediaLibrary(undefined);setAuth("no")}
  if(auth==="checking")return<main className="splash"><div className="brandMark">H</div><p>HomeHub betöltése…</p></main>;
  if(auth==="no")return<Login onDone={()=>setAuth("yes")}/>;

  const summaryCards=<section className="cards four summaryCards"><button className="card summaryButton" onClick={()=>chooseTab("downloads")}><span>KD20</span><strong>{state?.bridgeOnline&&state?.snapshot?.kd20.online?"Online":"Offline"}</strong><small>{torrents.length} torrent · ↓ {fmtSpeed(totalDl)} · ↑ {fmtSpeed(totalUl)}</small></button><button className="card summaryButton" onClick={()=>chooseTab("downloads")}><span>WD My Cloud</span><strong>{state?.bridgeOnline&&state?.snapshot?.wd.online?"Online":"Offline"}</strong><small>{state?.snapshot?`${fmtBytes(state.snapshot.wd.freeBytes)} szabad · ${Math.round(wdUsed*100)}% foglalt`:"Nincs adat"}</small></button><button className="card summaryButton" onClick={()=>chooseTab("network")}><span>Hálózat</span><strong>{network.filter(n=>n.online).length}/{network.length||0} online</strong><small>krankovics2 + krankovics mesh</small></button><button className="card summaryButton" onClick={()=>chooseTab("smart")}><span>Smart Life</span><strong>{smart.configured?(smart.online?"Online":"Hiba"):"Nincs konfigurálva"}</strong><small>{onlineSmart}/{smartDeviceTotal} eszköz online · {smart.scenes.length} jelenet</small></button></section>;

  return <main>{notice&&<div className="toast">{notice}</div>}{deleteTarget&&<DeleteDialog torrent={deleteTarget} onClose={()=>setDeleteTarget(null)} onDelete={removeTorrent}/>} {resolvedDetail&&<DeviceDetailDialog device={resolvedDetail} onClose={()=>setDetailTarget(null)} onCommand={smartCommand}/>} {vacuumDetail&&vacuum&&<VacuumDetailDialog vacuum={vacuum} onClose={()=>setVacuumDetail(false)} onAction={vacuumAction}/>}<header className="hero"><div><div className="eyebrow">HOME HUB · CORE</div><h1>Otthoni vezérlőközpont</h1><p>NAS, média, torrent, hálózat, nyomtató és okosotthon egyetlen PWA-ban.</p></div><div className="heroActions"><div className="live"><span className={state?.bridgeOnline?"dot on":"dot"}></span>{state?.bridgeOnline?"Bridge online":`Bridge offline · ${bridgeAge(state?.bridgeLastSeenAt)}`}</div><button className="ghost" onClick={logout}>Kilépés</button></div></header>

    <nav className="tabBar" aria-label="HomeHub funkciók">{tabDefs.map(t=><button key={t.id} className={tab===t.id?"active":""} onClick={()=>chooseTab(t.id)}><span className="tabFull">{t.label}</span><span className="tabShort">{t.short}</span>{t.id==="actions"&&automation.unread>0&&<i className="navAlertBadge">{automation.unread}</i>}</button>)}</nav>

    {tab==="overview"&&<div className="tabPanel">{summaryCards}<section className="overviewGrid"><article className="panel overviewCard"><div className="sectionHead"><div><h2>Letöltések</h2><p>KD20 Transmission és WD automatikus másolás.</p></div><button className="ghost" onClick={()=>chooseTab("downloads")}>Megnyitás</button></div><div className="overviewStats"><span><b>{runningTorrents}</b> aktív letöltés</span><span><b>{torrents.filter(t=>t.percentDone>=1).length}</b> kész torrent</span><span><b>{state?.settings.autoCopyEnabled?"Be":"Ki"}</b> automatikus másolás</span></div></article><article className="panel overviewCard"><div className="sectionHead"><div><h2>Otthoni hálózat</h2><p>Két Wi-Fi és a vezetékes topológia.</p></div><button className="ghost" onClick={()=>chooseTab("network")}>Térkép</button></div><div className="ssidSummary"><span><i className="wifiIcon">⌁</i><b>krankovics2</b><small>Technicolor FGA2233</small></span><span><i className="wifiIcon">⌁</i><b>krankovics</b><small>Archer C6 + mesh</small></span></div></article><article className="panel overviewCard"><div className="sectionHead"><div><h2>Médiatár</h2><p>WD My Cloud filmek közvetlenül iPhone-ra.</p></div><button className="ghost" onClick={()=>chooseTab("media")}>Filmek</button></div><div className="overviewStats"><span><b>{media?.count||0}</b> film</span><span><b>{media?.online?"LAN":"Offline"}</b> helyi elérés</span><span><b>24 óra</b> aláírt link</span></div></article><article className="panel overviewCard"><div className="sectionHead"><div><h2>Smart Life</h2><p>Tuya és Xiaomi Home eszközök egyetlen nézetben.</p></div><button className="ghost" onClick={()=>chooseTab("smart")}>Eszközök</button></div><div className="overviewStats"><span><b>{onlineSmart}</b> online</span><span><b>{smart.devices.filter(d=>deviceKind(d)==="sensor").length}</b> szenzor</span><span><b>{smart.devices.filter(d=>deviceKind(d)==="climate").length}</b> klíma</span></div></article><article className="panel overviewCard"><div className="sectionHead"><div><h2>Nyomtató</h2><p>KD20 USB Print Server.</p></div><button className="ghost" onClick={()=>chooseTab("printer")}>Megnyitás</button></div><span className={printer?.online?"statusBadge good":"statusBadge"}>{printer?.online?"Nyomtatószolgáltatás elérhető":"Nincs észlelve"}</span></article></section></div>}

    {tab==="downloads"&&<div className="tabPanel"><section className="panel add"><div><h2>Új torrent</h2><p>Magnet link vagy .torrent fájl.</p></div><form onSubmit={addMagnet} className="magnet"><input value={magnet} onChange={e=>setMagnet(e.target.value)} placeholder="magnet:?xt=urn:btih:…"/><button disabled={busy||!state?.bridgeOnline}>Hozzáadás</button></form><label className={`filebtn ${!state?.bridgeOnline?"disabled":""}`}>.torrent fájl<input disabled={!state?.bridgeOnline} type="file" accept=".torrent,application/x-bittorrent" onChange={e=>addFile(e.target.files?.[0])}/></label></section><section className="panel"><div className="sectionHead"><div><h2>Torrentek</h2><p>Letöltés, seedelés, WD-re másolás és manuális törlés.</p></div><button className="ghost" onClick={load}>Frissítés</button></div><div className="torrentList">{torrents.length===0&&<div className="empty">Még nincs torrent, vagy a Bridge nem küldött adatot.</div>}{torrents.map(t=>{const cp=t.hashString?state?.copies?.[t.hashString]:undefined,copying=cp&&(cp.state==="queued"||cp.state==="running"),done=cp?.state==="done",copyPct=Math.max(0,Math.min(100,Math.round((cp?.percent||0)*100)));return <article className="torrent" key={t.hashString||t.id}><div className="torrentTop"><div><strong>{t.name}</strong><span>{Math.round(t.percentDone*100)}%</span><small className="torrentStatus">{statusLabel(t.status)}</small></div><div className="copyActions">{cp?.state==="error"&&<button className="retry" onClick={()=>retryCopy(t.hashString)}>Újrapróbálás</button>}<button onClick={()=>copy(t)} disabled={t.percentDone<1||!state?.bridgeOnline||Boolean(copying)||Boolean(done)}>{done?"Átmásolva":copying?"Másolás…":"Másolás WD-re"}</button><button className="deleteBtn" onClick={()=>setDeleteTarget(t)} disabled={!state?.bridgeOnline}>Törlés</button></div></div><div className="bar"><i style={{width:`${Math.max(1,t.percentDone*100)}%`}}></i></div><small>↓ {fmtSpeed(t.rateDownload)} · ↑ {fmtSpeed(t.rateUpload)} · ID {t.id}{t.eta>0&&t.eta<31536000?` · ETA ${fmtDuration(t.eta)}`:""}</small>{cp&&<div className={`copyState ${cp.state}`}><div className="copyStateLine"><span>Másolás: {cp.state==="queued"?"sorban":cp.state==="running"?"folyamatban":cp.state==="done"?`kész → ${cp.destination}`:`hiba${cp.message?` · ${cp.message}`:""}`}</span>{cp.state==="running"&&<b>{copyPct}%</b>}</div>{cp.state==="running"&&<><div className="copyBar"><i style={{width:`${Math.max(1,copyPct)}%`}}></i></div><div className="copyMeta"><span>{fmtBytes(cp.copiedBytes||0)} / {fmtBytes(cp.totalBytes||0)}</span><span>{fmtSpeed(cp.speedBytesPerSec||0)}</span><span>~ {fmtDuration(cp.etaSeconds)}</span></div>{cp.currentFile&&<div className="copyFile">{cp.currentFile}</div>}</>}</div>}</article>})}</div></section></div>}

    {tab==="media"&&<MediaTab media={media} bridgeOnline={Boolean(state?.bridgeOnline)}/>}

    {tab==="smart"&&<div className="tabPanel smartLifeV12">
      <section className="panel smartPanel smartPanelV12">
        <div className="smartHeroV12">
          <div>
            <span className="smartEyebrowV12">SMART HOME</span>
            <h2>Smart Life</h2>
            <p>Letisztult vezérlés a Tuya és Xiaomi Home eszközökhöz, a fontos állapotokra fókuszálva.</p>
          </div>
          <div className="smartHeroActionsV12">
            <span className={smart.online?"smartCloudStateV12 online":"smartCloudStateV12"}><i></i>{smart.online?"Tuya Cloud online":"Tuya Cloud hiba"}</span>
            {vacuum?.configured&&<span className={vacuum.online?"smartCloudStateV12 online xiaomiLocalV13":"smartCloudStateV12 xiaomiLocalV13"}><i></i>{vacuum.online?"Xiaomi helyi online":"Xiaomi offline"}</span>}
            <button className="refreshV12" onClick={refreshSmart}>↻ <span>Frissítés</span></button>
          </div>
        </div>

        <div className="smartSummaryV12">
          <div className="smartSummaryTileV12 online"><span>Online</span><strong>{onlineSmart}</strong><small>{smartDeviceTotal?`${Math.round(onlineSmart/smartDeviceTotal*100)}% elérhető`:"Nincs eszköz"}</small></div>
          <div className="smartSummaryTileV12"><span>Offline</span><strong>{offlineSmart}</strong><small>figyelmet igényelhet</small></div>
          <div className="smartSummaryTileV12"><span>Vezérelhető</span><strong>{controllableSmart}</strong><small>kapcsoló, klíma, kapu, EV</small></div>
          <div className="smartSummaryTileV12"><span>Utolsó szinkron</span><strong className="syncTimeV12">{smart.lastUpdatedAt?new Date(smart.lastUpdatedAt).toLocaleTimeString("hu-HU",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—"}</strong><small>{smart.lastUpdatedAt?new Date(smart.lastUpdatedAt).toLocaleDateString("hu-HU"):"Még nincs adat"}</small></div>
        </div>

        <div className="smartToolbarV12">
          <div className="filterBar filterBarV12">{(["all","switch","sensor","climate","charger","light","gate","vacuum","device"] as SmartFilter[]).map(f=><button key={f} className={smartFilter===f?"active":""} onClick={()=>setSmartFilter(f)}><i>{f==="all"?"◉":smartIcon(f)}</i>{f==="all"?"Összes":labelKind(f)} <span>{f==="all"?smartDeviceTotal:f==="vacuum"?(vacuum?.configured?1:0):smart.devices.filter(d=>deviceKind(d)===f).length}</span></button>)}</div>
          <div className="smartToolsV12">
            <label className="smartSearchV12"><span>⌕</span><input value={smartQuery} onChange={e=>setSmartQuery(e.target.value)} placeholder="Eszköz keresése…"/></label>
            <label className="onlineOnlyV12"><input type="checkbox" checked={smartOnlineOnly} onChange={e=>setSmartOnlineOnly(e.target.checked)}/><span></span>Csak online</label>
          </div>
        </div>

        {!smart.configured&&<div className="empty">Renderben add meg a TUYA_ACCESS_ID, TUYA_ACCESS_SECRET és TUYA_API_ENDPOINT változókat.</div>}
        {smart.configured&&!smart.online&&<div className="smartError">Tuya kapcsolat: {smart.error||"nem elérhető"}</div>}
        {!vacuum?.configured&&<div className="xiaomiSetupV13"><div className="xiaomiSetupIconV13">◉</div><div><strong>Xiaomi Robot Vacuum E10</strong><span>A porszívó integrációja elő van készítve. A WD Bridge configban az IP, a helyi Xiaomi token és a konkrét MIoT mapping megadása után automatikusan megjelenik itt.</span></div><span className="integrationBadgeV13">Xiaomi Home</span></div>}

        {(smartVisible.length>0||vacuumVisible)&&<div className="smartGrid smartGridV12 smartGridV13">{vacuumVisible&&vacuum&&<VacuumCard vacuum={vacuum} onOpen={()=>setVacuumDetail(true)} onAction={vacuumAction}/>} {smartVisible.map(d=><SmartDeviceCard key={d.id} device={d} onCommand={smartCommand} onOpen={setDetailTarget}/>)}</div>}
        {smartVisible.length===0&&!vacuumVisible&&smartDeviceTotal>0&&<div className="empty smartEmptyV12">A jelenlegi szűréssel nincs megjeleníthető eszköz.</div>}

        {smart.scenes.length>0&&<div className="scenes scenesV12"><div className="scenesHeadV12"><div><span className="smartEyebrowV12">GYORS MŰVELETEK</span><h3>Jelenetek</h3></div><span>{smart.scenes.length} jelenet</span></div><div className="sceneGrid">{smart.scenes.map(s=><button className={isDangerous(s.name)?"scene danger":"scene"} key={`${s.homeId||"x"}-${s.id}`} disabled={s.enabled===false} onClick={()=>runScene(s)}><i>▶</i><span>{s.name}</span>{isDangerous(s.name)&&<small>Megerősítés szükséges</small>}</button>)}</div></div>}
        {smart.online&&smart.scenes.length===0&&<div className="infoLine smartInfoV12">A Smart Life Tap-to-Run jelenetek még nem érkeznek meg. A Xiaomi porszívó külön, helyi WD Bridge kapcsolaton jelenik meg, ha az integrációt bekapcsolod.</div>}
      </section>
    </div>}

    {tab==="actions"&&<ActionsTab state={automation} smart={smart} network={network} vacuum={vacuum} reload={load} flash={flash}/>}

    {tab==="ai"&&state&&<AIAssistantTab ai={ai} settings={state.settings} smart={smart} network={network} reload={load} flash={flash} updateSettings={updateSettings}/>}

    {tab==="network"&&<div className="tabPanel"><section className="panel networkPanel"><div className="sectionHead"><div><h2>Otthoni hálózati térkép</h2><p>A fizikai topológia, a két Wi-Fi és az élő Bridge mérések egy nézetben.</p></div></div><NetworkTopology network={network}/></section><section className="panel networkPanel"><div className="sectionHead"><div><h2>Élő eszközállapot</h2><p>Ping, ARP és admin-port ellenőrzés a WD Bridge-ről.</p></div><span className="sectionCounter">{network.filter(n=>n.online).length}/{network.length} online</span></div><div className="networkGrid">{network.map(n=><NetworkDeviceCard n={n} key={n.id}/>)}{network.length===0&&<div className="empty">A Bridge még nem küldött hálózati adatot.</div>}</div><div className="infoLine">A D-Link GO-SW-5G és a TP-Link LiteWave LS105G nem menedzselhető, ezért passzív topológiai elemként jelennek meg. Az élő állapotot a mögöttük lévő gépeken mérjük.</div></section></div>}

    {tab==="printer"&&<div className="tabPanel"><section className="panel printerPanel"><div><h2>USB nyomtatómegosztás</h2><p>A KD20 USB Print Server funkcióját használjuk.</p></div><div className="printerStatus"><span className={printer?.online?"statusBadge good":"statusBadge"}>{printer?.online?"Nyomtatószolgáltatás elérhető":"Nyomtató még nincs észlelve"}</span><small>{printer?.note||"A Bridge figyeli a nyomtatóportokat."}</small></div><div className="printerActions">{printer?.adminUrl&&<a className="actionLink" href={printer.adminUrl} target="_blank" rel="noreferrer">KD20 Printer Setting</a>}<span>USB → KD20 → Printer Setting → Enable.</span></div></section><section className="panel helpPanel"><h2>Windows hozzáadás</h2><p>A nyomtató bekapcsolása után a KD20 hálózati print serverét használhatod. A pontos driver a nyomtató típusától függ.</p><div className="stepGrid"><span><b>1</b> Nyomtató USB-n a KD20-ra</span><span><b>2</b> Printer Setting → Enable</span><span><b>3</b> Windowsban hálózati nyomtató hozzáadása</span></div></section></div>}

    {tab==="settings"&&<div className="tabPanel"><section className="panel settings settingsPanel"><div><h2>Torrent automatika</h2><p>A kész torrentet WD-re másolja, a KD20-on seedeléshez megőrzi. A beállítás a WD-n is tartósan mentődik.</p></div><label className="switch"><input type="checkbox" checked={state?.settings.autoCopyEnabled||false} onChange={e=>updateSettings({autoCopyEnabled:e.target.checked})}/><span></span> Automatikus másolás</label><label>Célmappa a WD-n<input value={state?.settings.autoCopyDestination||""} onChange={e=>setState(s=>s?({...s,settings:{...s.settings,autoCopyDestination:e.target.value}}):s)} onBlur={e=>updateSettings({autoCopyDestination:e.target.value})}/></label></section><section className="panel systemInfo"><div><span>Bridge</span><strong>{state?.bridgeOnline?"Online":"Offline"}</strong><small>Utolsó kapcsolat: {bridgeAge(state?.bridgeLastSeenAt)}</small></div><div><span>WD állapotmentés</span><strong>Aktív</strong><small>/DataVolume/homehub/server-state.json</small></div><div><span>Email alert</span><strong>{automation.email.configured?"Konfigurálva":"Nincs beállítva"}</strong><small>{automation.email.configured?`${automation.email.recipients} címzett`:`SMTP_HOST / SMTP_* + ALERT_EMAIL_TO`}</small></div><div><span>AI Asszisztens</span><strong>{ai.configured?`${ai.model} · ${state?.settings.aiMode==="approved"?"jóváhagyott":"javaslat"}`:"Nincs API kulcs"}</strong><small>OpenAI Responses API · szerveroldali kulcs · policy ellenőrzés</small></div><div><span>HomeHub</span><strong>v0.16.1</strong><small>Médiatár · iPhone streaming/offline · AI Asszisztens · Akciómotor</small></div></section></div>}
  </main>
}

createRoot(document.getElementById("root")!).render(<App/>);
