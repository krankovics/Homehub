import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Torrent = { id:number; hashString:string; name:string; status:number; percentDone:number; rateDownload:number; rateUpload:number; eta:number };
type PrinterStatus = { configured:boolean; online:boolean; host:string; adminUrl:string; detectedPorts:number[]; protocol:string; note:string };
type NetworkStatus = { id:string; name:string; kind:string; online:boolean; adminOnline?:boolean; ip:string; mac:string; latencyMs:number; adminUrl:string; note:string };
type CopyState = { torrentName:string; destination:string; state:string; message?:string; attempts?:number; copiedBytes?:number; totalBytes?:number; currentFile?:string; fileCopiedBytes?:number; fileTotalBytes?:number; speedBytesPerSec?:number; etaSeconds?:number; percent?:number };
type TuyaPoint = { code:string; value:unknown };
type TuyaSpec = { code:string; type:string; values:string; dp_id?:number; dpId?:number };
type TuyaDevice = { id:string; name:string; online:boolean; category:string; productName:string; productId?:string; homeId?:string; profile?:"mygate"|"feyree"|"aircon"; status:TuyaPoint[]; functions:TuyaSpec[]; statusSpec:TuyaSpec[] };
type TuyaScene = { id:string; name:string; homeId?:string; enabled?:boolean; capabilities?:Array<{interface_name?:string; commands?:string[]}> };
type SmartHome = { configured:boolean; online:boolean; lastUpdatedAt:string|null; error?:string; devices:TuyaDevice[]; scenes:TuyaScene[] };
type State = {
  snapshot:null|{
    timestamp:string;
    kd20:{online:boolean;torrents:Torrent[]};
    wd:{online:boolean;freeBytes:number;totalBytes:number;mediaRoot:string};
    printer?:PrinterStatus;
    network?:NetworkStatus[];
  };
  bridgeLastSeenAt:string|null;
  bridgeOnline:boolean;
  settings:{autoCopyEnabled:boolean;autoCopyDestination:string};
  copies:Record<string,CopyState>;
  recentCommands:Array<{id:string;type:string;createdAt:string;completedAt?:string;ok?:boolean;message?:string}>;
  smartHome:SmartHome;
};
type Tab = "overview"|"downloads"|"smart"|"network"|"printer"|"settings";
type SmartFilter = "all"|"switch"|"sensor"|"climate"|"light"|"gate"|"charger"|"device";

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
  {id:"smart",label:"Smart Life",short:"Smart"},
  {id:"network",label:"Hálózat",short:"Hálózat"},
  {id:"printer",label:"Nyomtató",short:"Nyomtató"},
  {id:"settings",label:"Beállítások",short:"Beállítás"},
];

function specFor(d:TuyaDevice,code:string){return[...d.functions,...d.statusSpec].find(s=>s.code===code)}
function specValues(d:TuyaDevice,code:string){const x=specFor(d,code);if(!x)return{} as Record<string,unknown>;try{return JSON.parse(x.values||"{}") as Record<string,unknown>}catch{return{} as Record<string,unknown>}}
function findFunction(d:TuyaDevice,patterns:string[],type?:string){return d.functions.find(x=>(!type||x.type.toLowerCase()===type.toLowerCase())&&patterns.some(p=>x.code.toLowerCase()===p||x.code.toLowerCase().includes(p)))}
function findStatus(d:TuyaDevice,patterns:string[]){return d.status.find(x=>patterns.some(p=>x.code.toLowerCase()===p||x.code.toLowerCase().includes(p)))}
function deviceKind(d:TuyaDevice):SmartFilter{if(d.profile==="feyree")return"charger";if(d.profile==="aircon")return"climate";if(d.profile==="mygate")return"gate";const s=`${d.name} ${d.productName} ${d.category}`.toLowerCase();if(/feyree|portable charger|ev charger|evse|autó.*tölt|car charger/.test(s))return"charger";if(/air conditioner|klíma|climate|aircon|新风分体机/.test(s))return"climate";if(/temperature|humidity|hőmér|thermo|sensor/.test(s))return"sensor";if(/gate|kapu|garage|garázs|lock/.test(s))return"gate";if(/light|bulb|lamp|lámpa|rgb|cct/.test(s))return"light";if(/plug|socket|switch|outlet|konnektor/.test(s))return"switch";return"device"}
function metric(d:TuyaDevice,patterns:string[]){const p=findStatus(d,patterns);if(!p||typeof p.value!=="number")return null;const meta=specValues(d,p.code);const scale=Number(meta.scale||0);const v=p.value/Math.pow(10,scale);return{value:v,unit:String(meta.unit||""),scale}}
function batteryPercent(d:TuyaDevice){const direct=["battery_percentage","battery_percent","battery_pct","battery_value"];const p=d.status.find(x=>direct.includes(x.code.toLowerCase())&&typeof x.value==="number");if(p){const meta=specValues(d,p.code);const scale=Number(meta.scale||0);let v=Number(p.value)/Math.pow(10,scale);const max=Number(meta.max||100);if(max>100&&v>100)v=v/max*100;if(v>=0&&v<=100)return Math.round(v)}const state=findStatus(d,["battery_state"]);if(state&&typeof state.value==="string"){const map:Record<string,number>={high:100,middle:55,medium:55,low:20};return map[state.value.toLowerCase()]??null}return null}
function enumRange(d:TuyaDevice,code?:string):string[]{if(!code)return[];const m=specValues(d,code) as {range?:unknown};return Array.isArray(m.range)?m.range.map((value:unknown)=>String(value)):[]}
function labelKind(kind:SmartFilter){return kind==="climate"?"Klíma":kind==="sensor"?"Szenzor":kind==="switch"?"Kapcsoló":kind==="light"?"Világítás":kind==="gate"?"Kapu":kind==="charger"?"Autótöltő":"Eszköz"}
function gateStateLabel(value:unknown){const v=String(value??"").toLowerCase().replace(/[_-]+/g," ").trim();if(["closed","close","zárt"].includes(v))return"Zárt";if(["opening","nyitás","nyílik"].includes(v))return"Nyílik";if(["partially opened","partial open","part open","részben nyitva"].includes(v))return"Részben nyitva";if(["opened","open","nyitva"].includes(v))return"Nyitva";if(["closing","zárás","záródik"].includes(v))return"Záródik";return value===undefined||value===null||value===""?"Ismeretlen":String(value)}
function humanValue(value:unknown){if(typeof value==="boolean")return value?"Be":"Ki";if(value===undefined||value===null||value==="")return"—";return String(value).replace(/_/g," ")}
function boolState(d:TuyaDevice,code?:string){return code?Boolean(statusMap(d)[code]):false}

function actionFunction(d:TuyaDevice,patterns:string[]){
  return d.functions.find(fn=>patterns.some(p=>fn.code.toLowerCase()===p||fn.code.toLowerCase().includes(p)));
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
function chargerMetric(d:TuyaDevice,patterns:string[],fallbackUnit=""){return displayMetric(d,patterns,fallbackUnit)}
function numericFunctionMeta(d:TuyaDevice,fn?:TuyaSpec){if(!fn)return null;const meta=specValues(d,fn.code);return{min:Number(meta.min??0),max:Number(meta.max??100),step:Number(meta.step??1),scale:Number(meta.scale??0),unit:String(meta.unit||"")}}
function networkKind(kind:string){return kind==="gateway"?"Telekom gateway":kind==="router"?"Router":kind==="extender"?"Wi-Fi erősítő":kind==="switch"?"Switch":kind==="nas"?"NAS":kind==="computer"?"Gép":"Eszköz"}
function initialTab():Tab{const v=window.location.hash.replace(/^#/,"") as Tab;return tabDefs.some(t=>t.id===v)?v:"overview"}
async function api(path:string,init?:RequestInit){const r=await fetch(path,init);if(r.status===401)throw new Error("AUTH_REQUIRED");const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b?.error||`HTTP ${r.status}`);return b}

function Login({onDone}:{onDone:()=>void}){
  const[password,setPassword]=useState("");const[busy,setBusy]=useState(false);const[error,setError]=useState("");
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{await api("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password})});onDone()}catch(err){setError(err instanceof Error&&err.message==="too_many_attempts"?"Túl sok sikertelen próbálkozás. Próbáld később.":"Hibás jelszó.")}finally{setBusy(false)}}
  return <main className="loginShell"><section className="loginCard"><div className="brandMark">H</div><div className="eyebrow">HOME HUB</div><h1>Belépés</h1><p>NAS, hálózat és okosotthon egyetlen felületen.</p><form onSubmit={submit}><input type="password" autoFocus autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="HomeHub jelszó"/><button disabled={busy||!password}>{busy?"Belépés…":"Belépés"}</button></form>{error&&<div className="loginError">{error}</div>}</section></main>
}

function smartIcon(kind:SmartFilter){return kind==="climate"?"❄":kind==="sensor"?"⌁":kind==="switch"?"⏻":kind==="light"?"✦":kind==="gate"?"⌂":kind==="charger"?"⚡":"◇"}
function prettySmartValue(value:unknown){
  const raw=humanValue(value),v=raw.toLowerCase().trim();
  const map:Record<string,string>={
    "auto":"Automata","cool":"Hűtés","cold":"Hűtés","heat":"Fűtés","hot":"Fűtés","dry":"Párátlanítás","fan":"Ventilátor",
    "charger free":"Szabad","charging":"Töltés","finish":"Befejezve","finished":"Befejezve",
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
  const switchCode=switchFn?.code, switchValue=switchCode?Boolean(sm[switchCode]):undefined;
  const volts=kind==="charger"?chargerMetric(device,["a_voltage"],"V"):null;
  const amps=kind==="charger"?chargerMetric(device,["a_current"],"A"):null;
  const power=kind==="charger"?chargerMetric(device,["devicekw"],"kW"):null;
  const chargerState=kind==="charger"?findStatus(device,["work_statesvg","work_state","devicestate"]):null;
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
        <small title={device.productName||device.category}>{device.productName||device.category||"Smart Life eszköz"}</small>
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
      <div className="chargerStateV12"><span>EV töltő</span><strong>{chargerState?prettySmartValue(chargerState.value):"Állapot ismeretlen"}</strong></div>
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

  const chargerSwitch=findFunction(device,["switchsvg","switch","charge_switch","power","start_charge"],"Boolean");
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
  const chargerInfo=[
    ["Állapot",findStatus(device,["work_statesvg","work_state","devicestate"])],
    ["Mód",findStatus(device,["work_modesvg","work_mode"])],
    ["Töltés energia",findStatus(device,["charge_energy_oncesvg","charge_energy_once"])],
    ["Töltési idő",findStatus(device,["ctime"])],
    ["PE",findStatus(device,["pe"])],
    ["Művelet",findStatus(device,["chargingoperation"])],
  ] as Array<[string,TuyaPoint|undefined]>;
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
  return <div className="modalBack" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className={`modal deviceDetail ${detailClass}`}><div className="detailHead"><div><span className="deviceKind">{labelKind(kind)}</span><h2>{device.name}</h2><p>{device.productName||device.category} · {device.online?"Online":"Offline"}</p></div><button className="closeBtn" onClick={onClose}>×</button></div>
    {isGate&&<><div className={`gateHero gate-${String(gateState?.value||"").toLowerCase().replace(/\s+/g,"-")}`}><div className="gateGlyph">▰▰▰</div><div><strong>Kapuvezérlés</strong><span>Állapot: {gateStateLabel(gateState?.value)}</span></div></div><div className="gateActionGrid">{gateActions.map(a=>{const fn=actionFunction(device,a.patterns);const needsConfirm=["start","pedestrian","open","close"].includes(a.key);return <button key={a.key} disabled={!device.online||!fn} onClick={()=>{if(!fn)return;if(needsConfirm&&!window.confirm(`${device.name}: ${a.label} végrehajtása?`))return;onCommand(device,fn.code,true)}}><span>{a.key==="start"?"▶":a.key==="stop"?"■":a.key==="open"?"⌂":a.key==="close"?"🔒":a.key==="light"?"💡":"●"}</span>{a.label}<small>{fn?fn.code:"nem elérhető"}</small></button>})}</div><div className="gateStatusGrid"><div><span>Kapu állapota</span><strong>{gateStateLabel(gateState?.value)}</strong></div><div><span>Figyelmeztetés</span><strong>{warning?prettySmartValue(warning.value):"Nincs"}</strong></div></div>{(keepOpen||pauseTime||operativeMode)&&<div className="detailInfoGrid">{keepOpen&&<div><span>Nyitva tartás</span><strong>{prettySmartValue(keepOpen.value)}</strong></div>}{pauseTime&&<div><span>Automata zárási idő</span><strong>{humanValue(pauseTime.value)}</strong></div>}{operativeMode&&<div><span>Üzemmód</span><strong>{prettySmartValue(operativeMode.value)}</strong></div>}</div>}<div className="safetyNote">A myGate Open / Close / Start / Stop / Pedestrian / Light parancsai impulzusos DP-k. A HomeHub csak <b>On / true</b> impulzust küld, az eszköz állítja vissza Off-ra.</div></>}

    {isCharger&&<><div className="chargerHero"><div className="chargerMetrics">{chargerMetrics.map(([label,m])=><div key={label}><span>{label}</span><strong>{m?`${m.value}${m.unit?` ${m.unit}`:""}`:"—"}</strong></div>)}</div></div><div className="detailInfoGrid">{chargerInfo.map(([label,p])=><div key={label}><span>{label}</span><strong>{p?prettySmartValue(p.value):"—"}</strong></div>)}</div><div className="chargerActions">{chargerSwitch&&<button className={Boolean(sm[chargerSwitch.code])?"danger":"primary"} onClick={()=>onCommand(device,chargerSwitch.code,!Boolean(sm[chargerSwitch.code]))}>{Boolean(sm[chargerSwitch.code])?"Töltés leállítása":"Töltés indítása"}</button>}<SettingControl device={device} fn={currentFn} label="Max. áramerősség" value={current} setValue={setCurrent} meta={currentMeta} suffix="A" onSave={()=>sendNumeric(currentFn,current,currentMeta)} onCommand={onCommand}/><SettingControl device={device} fn={delayFn} label="Késleltetés" value={delay} setValue={setDelay} meta={delayMeta} suffix="h" onSave={()=>sendNumeric(delayFn,delay,delayMeta)} onCommand={onCommand}/><SettingControl device={device} fn={chargeTimeFn} label="Töltési idő" value={chargeTime} setValue={setChargeTime} meta={chargeMeta} suffix="h" onSave={()=>sendNumeric(chargeTimeFn,chargeTime,chargeMeta)} onCommand={onCommand}/></div>{phaseMetrics.some(([,m])=>Boolean(m))&&<><h3 className="detailSubhead">Fázisadatok</h3><div className="detailInfoGrid">{phaseMetrics.filter(([,m])=>Boolean(m)).map(([label,m])=><div key={label}><span>{label}</span><strong>{m?`${m.value} ${m.unit}`:"—"}</strong></div>)}</div></>}<div className="safetyNote">Áramerősséget a HomeHub csak akkor enged állítani, ha a Tuya API a DP-hez konkrét típust, minimumot, maximumot és lépésközt publikál. A Set16A / Set32A / Set40A / Set50A / set60a / set80a DP-ket nem aktiváljuk találomra.</div></>}

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

function App(){
  const[auth,setAuth]=useState<"checking"|"yes"|"no">("checking"),[state,setState]=useState<State|null>(null),[magnet,setMagnet]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[deleteTarget,setDeleteTarget]=useState<Torrent|null>(null),[detailTarget,setDetailTarget]=useState<TuyaDevice|null>(null),[tab,setTab]=useState<Tab>(initialTab),[smartFilter,setSmartFilter]=useState<SmartFilter>("all"),[smartQuery,setSmartQuery]=useState(""),[smartOnlineOnly,setSmartOnlineOnly]=useState(false);
  async function checkAuth(){const r=await fetch("/api/auth/status");const j=await r.json();setAuth(j.authenticated?"yes":"no")}
  async function load(){try{setState(await api("/api/state"));setAuth("yes")}catch(err){if(err instanceof Error&&err.message==="AUTH_REQUIRED")setAuth("no")}}
  useEffect(()=>{checkAuth();if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(r=>r.update()).catch(()=>{})},[]);
  useEffect(()=>{if(auth!=="yes")return;load();const id=setInterval(load,3000);return()=>clearInterval(id)},[auth]);
  useEffect(()=>{const onHash=()=>setTab(initialTab());window.addEventListener("hashchange",onHash);return()=>window.removeEventListener("hashchange",onHash)},[]);
  const torrents=state?.snapshot?.kd20.torrents||[],printer=state?.snapshot?.printer,network=state?.snapshot?.network||[],smart:SmartHome=state?.smartHome??{configured:false,online:false,lastUpdatedAt:null,devices:[],scenes:[]};
  const totalDl=useMemo(()=>torrents.reduce((a,t)=>a+t.rateDownload,0),[torrents]),totalUl=useMemo(()=>torrents.reduce((a,t)=>a+t.rateUpload,0),[torrents]),wdUsed=state?.snapshot?.wd.totalBytes?1-state.snapshot.wd.freeBytes/state.snapshot.wd.totalBytes:0;
  const smartVisible=smart.devices.filter(d=>(smartFilter==="all"||deviceKind(d)===smartFilter)&&(!smartOnlineOnly||d.online)&&(!smartQuery.trim()||`${d.name} ${d.productName} ${d.category}`.toLowerCase().includes(smartQuery.trim().toLowerCase()))).sort((a,b)=>Number(b.online)-Number(a.online)||a.name.localeCompare(b.name,"hu"));
  const onlineSmart=smart.devices.filter(d=>d.online).length,offlineSmart=smart.devices.length-onlineSmart;
  const controllableSmart=smart.devices.filter(d=>["switch","light","climate","charger","gate"].includes(deviceKind(d))).length;
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
  async function logout(){await fetch("/api/auth/logout",{method:"POST"});setState(null);setAuth("no")}
  if(auth==="checking")return<main className="splash"><div className="brandMark">H</div><p>HomeHub betöltése…</p></main>;
  if(auth==="no")return<Login onDone={()=>setAuth("yes")}/>;

  const summaryCards=<section className="cards four summaryCards"><button className="card summaryButton" onClick={()=>chooseTab("downloads")}><span>KD20</span><strong>{state?.bridgeOnline&&state?.snapshot?.kd20.online?"Online":"Offline"}</strong><small>{torrents.length} torrent · ↓ {fmtSpeed(totalDl)} · ↑ {fmtSpeed(totalUl)}</small></button><button className="card summaryButton" onClick={()=>chooseTab("downloads")}><span>WD My Cloud</span><strong>{state?.bridgeOnline&&state?.snapshot?.wd.online?"Online":"Offline"}</strong><small>{state?.snapshot?`${fmtBytes(state.snapshot.wd.freeBytes)} szabad · ${Math.round(wdUsed*100)}% foglalt`:"Nincs adat"}</small></button><button className="card summaryButton" onClick={()=>chooseTab("network")}><span>Hálózat</span><strong>{network.filter(n=>n.online).length}/{network.length||0} online</strong><small>krankovics2 + krankovics mesh</small></button><button className="card summaryButton" onClick={()=>chooseTab("smart")}><span>Smart Life</span><strong>{smart.configured?(smart.online?"Online":"Hiba"):"Nincs konfigurálva"}</strong><small>{onlineSmart}/{smart.devices.length} eszköz online · {smart.scenes.length} jelenet</small></button></section>;

  return <main>{notice&&<div className="toast">{notice}</div>}{deleteTarget&&<DeleteDialog torrent={deleteTarget} onClose={()=>setDeleteTarget(null)} onDelete={removeTorrent}/>} {detailTarget&&<DeviceDetailDialog device={detailTarget} onClose={()=>setDetailTarget(null)} onCommand={smartCommand}/>}<header className="hero"><div><div className="eyebrow">HOME HUB · CORE</div><h1>Otthoni vezérlőközpont</h1><p>NAS, torrent, hálózat, nyomtató és Smart Life egyetlen PWA-ban.</p></div><div className="heroActions"><div className="live"><span className={state?.bridgeOnline?"dot on":"dot"}></span>{state?.bridgeOnline?"Bridge online":`Bridge offline · ${bridgeAge(state?.bridgeLastSeenAt)}`}</div><button className="ghost" onClick={logout}>Kilépés</button></div></header>

    <nav className="tabBar" aria-label="HomeHub funkciók">{tabDefs.map(t=><button key={t.id} className={tab===t.id?"active":""} onClick={()=>chooseTab(t.id)}><span className="tabFull">{t.label}</span><span className="tabShort">{t.short}</span></button>)}</nav>

    {tab==="overview"&&<div className="tabPanel">{summaryCards}<section className="overviewGrid"><article className="panel overviewCard"><div className="sectionHead"><div><h2>Letöltések</h2><p>KD20 Transmission és WD automatikus másolás.</p></div><button className="ghost" onClick={()=>chooseTab("downloads")}>Megnyitás</button></div><div className="overviewStats"><span><b>{runningTorrents}</b> aktív letöltés</span><span><b>{torrents.filter(t=>t.percentDone>=1).length}</b> kész torrent</span><span><b>{state?.settings.autoCopyEnabled?"Be":"Ki"}</b> automatikus másolás</span></div></article><article className="panel overviewCard"><div className="sectionHead"><div><h2>Otthoni hálózat</h2><p>Két Wi-Fi és a vezetékes topológia.</p></div><button className="ghost" onClick={()=>chooseTab("network")}>Térkép</button></div><div className="ssidSummary"><span><i className="wifiIcon">⌁</i><b>krankovics2</b><small>Technicolor FGA2233</small></span><span><i className="wifiIcon">⌁</i><b>krankovics</b><small>Archer C6 + mesh</small></span></div></article><article className="panel overviewCard"><div className="sectionHead"><div><h2>Smart Life</h2><p>Élő szenzorok és kapcsolható eszközök.</p></div><button className="ghost" onClick={()=>chooseTab("smart")}>Eszközök</button></div><div className="overviewStats"><span><b>{onlineSmart}</b> online</span><span><b>{smart.devices.filter(d=>deviceKind(d)==="sensor").length}</b> szenzor</span><span><b>{smart.devices.filter(d=>deviceKind(d)==="climate").length}</b> klíma</span></div></article><article className="panel overviewCard"><div className="sectionHead"><div><h2>Nyomtató</h2><p>KD20 USB Print Server.</p></div><button className="ghost" onClick={()=>chooseTab("printer")}>Megnyitás</button></div><span className={printer?.online?"statusBadge good":"statusBadge"}>{printer?.online?"Nyomtatószolgáltatás elérhető":"Nincs észlelve"}</span></article></section></div>}

    {tab==="downloads"&&<div className="tabPanel"><section className="panel add"><div><h2>Új torrent</h2><p>Magnet link vagy .torrent fájl.</p></div><form onSubmit={addMagnet} className="magnet"><input value={magnet} onChange={e=>setMagnet(e.target.value)} placeholder="magnet:?xt=urn:btih:…"/><button disabled={busy||!state?.bridgeOnline}>Hozzáadás</button></form><label className={`filebtn ${!state?.bridgeOnline?"disabled":""}`}>.torrent fájl<input disabled={!state?.bridgeOnline} type="file" accept=".torrent,application/x-bittorrent" onChange={e=>addFile(e.target.files?.[0])}/></label></section><section className="panel"><div className="sectionHead"><div><h2>Torrentek</h2><p>Letöltés, seedelés, WD-re másolás és manuális törlés.</p></div><button className="ghost" onClick={load}>Frissítés</button></div><div className="torrentList">{torrents.length===0&&<div className="empty">Még nincs torrent, vagy a Bridge nem küldött adatot.</div>}{torrents.map(t=>{const cp=t.hashString?state?.copies?.[t.hashString]:undefined,copying=cp&&(cp.state==="queued"||cp.state==="running"),done=cp?.state==="done",copyPct=Math.max(0,Math.min(100,Math.round((cp?.percent||0)*100)));return <article className="torrent" key={t.hashString||t.id}><div className="torrentTop"><div><strong>{t.name}</strong><span>{Math.round(t.percentDone*100)}%</span><small className="torrentStatus">{statusLabel(t.status)}</small></div><div className="copyActions">{cp?.state==="error"&&<button className="retry" onClick={()=>retryCopy(t.hashString)}>Újrapróbálás</button>}<button onClick={()=>copy(t)} disabled={t.percentDone<1||!state?.bridgeOnline||Boolean(copying)||Boolean(done)}>{done?"Átmásolva":copying?"Másolás…":"Másolás WD-re"}</button><button className="deleteBtn" onClick={()=>setDeleteTarget(t)} disabled={!state?.bridgeOnline}>Törlés</button></div></div><div className="bar"><i style={{width:`${Math.max(1,t.percentDone*100)}%`}}></i></div><small>↓ {fmtSpeed(t.rateDownload)} · ↑ {fmtSpeed(t.rateUpload)} · ID {t.id}{t.eta>0&&t.eta<31536000?` · ETA ${fmtDuration(t.eta)}`:""}</small>{cp&&<div className={`copyState ${cp.state}`}><div className="copyStateLine"><span>Másolás: {cp.state==="queued"?"sorban":cp.state==="running"?"folyamatban":cp.state==="done"?`kész → ${cp.destination}`:`hiba${cp.message?` · ${cp.message}`:""}`}</span>{cp.state==="running"&&<b>{copyPct}%</b>}</div>{cp.state==="running"&&<><div className="copyBar"><i style={{width:`${Math.max(1,copyPct)}%`}}></i></div><div className="copyMeta"><span>{fmtBytes(cp.copiedBytes||0)} / {fmtBytes(cp.totalBytes||0)}</span><span>{fmtSpeed(cp.speedBytesPerSec||0)}</span><span>~ {fmtDuration(cp.etaSeconds)}</span></div>{cp.currentFile&&<div className="copyFile">{cp.currentFile}</div>}</>}</div>}</article>})}</div></section></div>}

    {tab==="smart"&&<div className="tabPanel smartLifeV12">
      <section className="panel smartPanel smartPanelV12">
        <div className="smartHeroV12">
          <div>
            <span className="smartEyebrowV12">SMART HOME</span>
            <h2>Smart Life</h2>
            <p>Az otthoni Tuya eszközök gyors vezérlése, állapota és részletes műszaki adatai.</p>
          </div>
          <div className="smartHeroActionsV12">
            <span className={smart.online?"smartCloudStateV12 online":"smartCloudStateV12"}><i></i>{smart.online?"Tuya Cloud online":"Tuya Cloud hiba"}</span>
            <button className="refreshV12" onClick={refreshSmart}>↻ <span>Frissítés</span></button>
          </div>
        </div>

        <div className="smartSummaryV12">
          <div className="smartSummaryTileV12 online"><span>Online</span><strong>{onlineSmart}</strong><small>{smart.devices.length?`${Math.round(onlineSmart/smart.devices.length*100)}% elérhető`:"Nincs eszköz"}</small></div>
          <div className="smartSummaryTileV12"><span>Offline</span><strong>{offlineSmart}</strong><small>figyelmet igényelhet</small></div>
          <div className="smartSummaryTileV12"><span>Vezérelhető</span><strong>{controllableSmart}</strong><small>kapcsoló, klíma, kapu, EV</small></div>
          <div className="smartSummaryTileV12"><span>Utolsó szinkron</span><strong className="syncTimeV12">{smart.lastUpdatedAt?new Date(smart.lastUpdatedAt).toLocaleTimeString("hu-HU",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—"}</strong><small>{smart.lastUpdatedAt?new Date(smart.lastUpdatedAt).toLocaleDateString("hu-HU"):"Még nincs adat"}</small></div>
        </div>

        <div className="smartToolbarV12">
          <div className="filterBar filterBarV12">{(["all","switch","sensor","climate","charger","light","gate","device"] as SmartFilter[]).map(f=><button key={f} className={smartFilter===f?"active":""} onClick={()=>setSmartFilter(f)}><i>{f==="all"?"◉":smartIcon(f)}</i>{f==="all"?"Összes":labelKind(f)} <span>{f==="all"?smart.devices.length:smart.devices.filter(d=>deviceKind(d)===f).length}</span></button>)}</div>
          <div className="smartToolsV12">
            <label className="smartSearchV12"><span>⌕</span><input value={smartQuery} onChange={e=>setSmartQuery(e.target.value)} placeholder="Eszköz keresése…"/></label>
            <label className="onlineOnlyV12"><input type="checkbox" checked={smartOnlineOnly} onChange={e=>setSmartOnlineOnly(e.target.checked)}/><span></span>Csak online</label>
          </div>
        </div>

        {!smart.configured&&<div className="empty">Renderben add meg a TUYA_ACCESS_ID, TUYA_ACCESS_SECRET és TUYA_API_ENDPOINT változókat.</div>}
        {smart.configured&&!smart.online&&<div className="smartError">Tuya kapcsolat: {smart.error||"nem elérhető"}</div>}

        {smartVisible.length>0&&<div className="smartGrid smartGridV12">{smartVisible.map(d=><SmartDeviceCard key={d.id} device={d} onCommand={smartCommand} onOpen={setDetailTarget}/>)}</div>}
        {smartVisible.length===0&&smart.devices.length>0&&<div className="empty smartEmptyV12">A jelenlegi szűréssel nincs megjeleníthető eszköz.</div>}

        {smart.scenes.length>0&&<div className="scenes scenesV12"><div className="scenesHeadV12"><div><span className="smartEyebrowV12">GYORS MŰVELETEK</span><h3>Jelenetek</h3></div><span>{smart.scenes.length} jelenet</span></div><div className="sceneGrid">{smart.scenes.map(s=><button className={isDangerous(s.name)?"scene danger":"scene"} key={`${s.homeId||"x"}-${s.id}`} disabled={s.enabled===false} onClick={()=>runScene(s)}><i>▶</i><span>{s.name}</span>{isDangerous(s.name)&&<small>Megerősítés szükséges</small>}</button>)}</div></div>}
        {smart.online&&smart.scenes.length===0&&<div className="infoLine smartInfoV12">A Smart Life Tap-to-Run jelenetek még nem érkeznek meg. A Scene Management jogosultság bekötése után itt külön gyorsindító blokkban jelennek meg.</div>}
      </section>
    </div>}

    {tab==="network"&&<div className="tabPanel"><section className="panel networkPanel"><div className="sectionHead"><div><h2>Otthoni hálózati térkép</h2><p>A fizikai topológia, a két Wi-Fi és az élő Bridge mérések egy nézetben.</p></div></div><NetworkTopology network={network}/></section><section className="panel networkPanel"><div className="sectionHead"><div><h2>Élő eszközállapot</h2><p>Ping, ARP és admin-port ellenőrzés a WD Bridge-ről.</p></div><span className="sectionCounter">{network.filter(n=>n.online).length}/{network.length} online</span></div><div className="networkGrid">{network.map(n=><NetworkDeviceCard n={n} key={n.id}/>)}{network.length===0&&<div className="empty">A Bridge még nem küldött hálózati adatot.</div>}</div><div className="infoLine">A D-Link GO-SW-5G és a TP-Link LiteWave LS105G nem menedzselhető, ezért passzív topológiai elemként jelennek meg. Az élő állapotot a mögöttük lévő gépeken mérjük.</div></section></div>}

    {tab==="printer"&&<div className="tabPanel"><section className="panel printerPanel"><div><h2>USB nyomtatómegosztás</h2><p>A KD20 USB Print Server funkcióját használjuk.</p></div><div className="printerStatus"><span className={printer?.online?"statusBadge good":"statusBadge"}>{printer?.online?"Nyomtatószolgáltatás elérhető":"Nyomtató még nincs észlelve"}</span><small>{printer?.note||"A Bridge figyeli a nyomtatóportokat."}</small></div><div className="printerActions">{printer?.adminUrl&&<a className="actionLink" href={printer.adminUrl} target="_blank" rel="noreferrer">KD20 Printer Setting</a>}<span>USB → KD20 → Printer Setting → Enable.</span></div></section><section className="panel helpPanel"><h2>Windows hozzáadás</h2><p>A nyomtató bekapcsolása után a KD20 hálózati print serverét használhatod. A pontos driver a nyomtató típusától függ.</p><div className="stepGrid"><span><b>1</b> Nyomtató USB-n a KD20-ra</span><span><b>2</b> Printer Setting → Enable</span><span><b>3</b> Windowsban hálózati nyomtató hozzáadása</span></div></section></div>}

    {tab==="settings"&&<div className="tabPanel"><section className="panel settings settingsPanel"><div><h2>Torrent automatika</h2><p>A kész torrentet WD-re másolja, a KD20-on seedeléshez megőrzi. A beállítás a WD-n is tartósan mentődik.</p></div><label className="switch"><input type="checkbox" checked={state?.settings.autoCopyEnabled||false} onChange={e=>updateSettings({autoCopyEnabled:e.target.checked})}/><span></span> Automatikus másolás</label><label>Célmappa a WD-n<input value={state?.settings.autoCopyDestination||""} onChange={e=>setState(s=>s?({...s,settings:{...s.settings,autoCopyDestination:e.target.value}}):s)} onBlur={e=>updateSettings({autoCopyDestination:e.target.value})}/></label></section><section className="panel systemInfo"><div><span>Bridge</span><strong>{state?.bridgeOnline?"Online":"Offline"}</strong><small>Utolsó kapcsolat: {bridgeAge(state?.bridgeLastSeenAt)}</small></div><div><span>WD állapotmentés</span><strong>Aktív</strong><small>/DataVolume/homehub/server-state.json</small></div><div><span>HomeHub</span><strong>v0.12.0</strong><small>Smart Life UX/UI v2 · eszköztípusos kártyák és részletes vezérlők</small></div></section></div>}
  </main>
}

createRoot(document.getElementById("root")!).render(<App/>);
