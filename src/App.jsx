import { useState, useEffect, useRef, useCallback } from “react”;

const API_URL = “https://mojid-gold-bot-production.up.railway.app/gold-price”;

function getBinaryExpiries() {
const now = new Date();
const times = [];
const start = new Date(now);
start.setSeconds(0, 0);
const mins = start.getMinutes();
const nextSlot = Math.ceil((mins + 2) / 15) * 15;
start.setMinutes(nextSlot);
for (let i = 0; i < 8; i++) {
const t = new Date(start.getTime() + i * 15 * 60000);
if (t.getHours() >= 21) break;
const hh = String(t.getHours()).padStart(2, “0”);
const mm = String(t.getMinutes()).padStart(2, “0”);
const diffMs = t - now;
const diffMins = Math.floor(diffMs / 60000);
const diffSecs = Math.floor((diffMs % 60000) / 1000);
times.push({
label: `${hh}:${mm}`,
remaining: `${diffMins}:${String(diffSecs).padStart(2, "0")}`,
mins: diffMins,
});
}
return times;
}

function calcCFD(invest, leverage, price) {
const volume = invest * leverage;
const pipValue = volume / price;
return {
pipValue: +pipValue.toFixed(2),
sl20: +(20 / pipValue).toFixed(1),
sl50: +(50 / pipValue).toFixed(1),
tp40: +(40 / pipValue).toFixed(1),
tp100: +(100 / pipValue).toFixed(1),
};
}

const CHECKLIST_BINARY = [
“Trend confirmed on 5M chart”,
“RSI aligned with direction”,
“MACD cross confirmed”,
“Price at key S/R level”,
“EMA ribbon fanning”,
“Stochastic not exhausted”,
“Williams %R confirmed”,
“No news in next 15 mins”,
];

const CHECKLIST_CFD = [
“Trend confirmed on 5M chart”,
“RSI aligned with direction”,
“MACD cross confirmed”,
“Clear entry level identified”,
“SL placed below/above structure”,
“TP at next key level”,
“Spread acceptable (< 1.0)”,
“No news in next 30 mins”,
];

function getCurrentSession() {
const h = new Date().getHours() + new Date().getMinutes() / 60;
if (h >= 0 && h < 21) return “OPEN”;
return “CLOSED”;
}

function formatTime(date, addMins = 0) {
const d = new Date(date.getTime() + addMins * 60000);
return d.toTimeString().slice(0, 5);
}

function playFireAlarm(ctx) {
if (!ctx) return;
[880, 1100, 880, 1100, 1320, 880, 1100].forEach((freq, i) => {
const osc = ctx.createOscillator();
const gain = ctx.createGain();
osc.connect(gain); gain.connect(ctx.destination);
osc.frequency.value = freq; osc.type = “square”;
gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + i * 0.18 + 0.06);
gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.18 + 0.15);
osc.start(ctx.currentTime + i * 0.18);
osc.stop(ctx.currentTime + i * 0.18 + 0.18);
});
}

function analyzeIndicators(prices) {
if (prices.length < 27) return { signals: {}, greenCount: 0, direction: null, rsi: null, stoch: null };
const last = prices[prices.length - 1];
const ema = (data, period) => {
const k = 2 / (period + 1);
return data.reduce((prev, cur, i) => i === 0 ? cur : cur * k + prev * (1 - k), data[0]);
};
const ema5  = ema(prices.slice(-5), 5);
const ema8  = ema(prices.slice(-8), 8);
const ema13 = ema(prices.slice(-13), 13);
const ema21 = ema(prices.slice(-21), 21);
const gains = [], losses = [];
for (let i = prices.length - 14; i < prices.length; i++) {
const d = prices[i] - prices[i - 1];
if (d > 0) gains.push(d); else losses.push(Math.abs(d));
}
const avgGain = gains.reduce((a, b) => a + b, 0) / 14 || 0.001;
const avgLoss = losses.reduce((a, b) => a + b, 0) / 14 || 0.001;
const rsi = 100 - 100 / (1 + avgGain / avgLoss);
const macd     = ema(prices.slice(-12), 12) - ema(prices.slice(-26), 26);
const prevMacd = ema(prices.slice(-13), 12) - ema(prices.slice(-27), 26);
const bbSlice = prices.slice(-20);
const bbMean  = bbSlice.reduce((a, b) => a + b, 0) / 20;
const hi14  = Math.max(…prices.slice(-14));
const lo14  = Math.min(…prices.slice(-14));
const stoch = ((last - lo14) / (hi14 - lo14)) * 100;
const willR = ((hi14 - last) / (hi14 - lo14)) * -100;
const bullBias = last > ema21;
const signals = {
“EMA Ribbon”:      bullBias ? (ema5 > ema8 && ema8 > ema13) : (ema5 < ema8 && ema8 < ema13),
“RSI”:             bullBias ? (rsi > 52 && rsi < 75) : (rsi < 48 && rsi > 25),
“MACD”:            bullBias ? (macd > 0 && macd > prevMacd) : (macd < 0 && macd < prevMacd),
“Bollinger Bands”: bullBias ? (last > bbMean) : (last < bbMean),
“Stochastic”:      bullBias ? (stoch > 40 && stoch < 80) : (stoch < 60 && stoch > 20),
“Williams %R”:     bullBias ? (willR > -60 && willR < -20) : (willR < -40 && willR > -80),
};
const greenCount = Object.values(signals).filter(Boolean).length;
return { signals, greenCount, direction: bullBias ? “HIGHER” : “LOWER”, rsi: +rsi.toFixed(1), stoch: +stoch.toFixed(1) };
}

function Sparkline({ prices }) {
if (!prices || prices.length < 2) return null;
const min = Math.min(…prices), max = Math.max(…prices);
const range = max - min || 0.01;
const W = 300, H = 48;
const pts = prices.map((p, i) =>
`${(i / (prices.length - 1)) * W},${H - ((p - min) / range) * H}`
).join(” “);
const color = prices[prices.length - 1] >= prices[prices.length - 2] ? “#22c55e” : “#ef4444”;
return (
<svg width=“100%” viewBox={`0 0 ${W} ${H}`} style={{ display: “block” }}>
<defs>
<linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stopColor={color} stopOpacity="0.2" />
<stop offset="100%" stopColor={color} stopOpacity="0" />
</linearGradient>
</defs>
<polygon points={`0,${H} ${pts} ${W},${H}`} fill=“url(#sg)” />
<polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
</svg>
);
}

export default function GoldBot() {
const [mode, setMode]                 = useState(null);
const [price, setPrice]               = useState(null);
const [spotPrice, setSpotPrice]       = useState(null);
const [priceHistory, setPriceHistory] = useState([]);
const [source, setSource]             = useState(””);
const [fetchError, setFetchError]     = useState(false);
const [lastUpdated, setLastUpdated]   = useState(null);
const [analysis, setAnalysis]         = useState({ signals: {}, greenCount: 0, direction: null });
const [now, setNow]                   = useState(new Date());
const [alarmActive, setAlarmActive]   = useState(false);
const [alarmDismissed, setAlarmDismissed] = useState(false);
const [showChecklist, setShowChecklist]   = useState(false);
const [checklist, setChecklist]       = useState({});
const [signal, setSignal]             = useState(null);
const [generating, setGenerating]     = useState(false);
const [copied, setCopied]             = useState(false);
const [selectedExpiry, setSelectedExpiry] = useState(null);
const [expiries, setExpiries]         = useState([]);
const [invest, setInvest]             = useState(24);
const [dataPoints, setDataPoints]     = useState(0);
const [lastAlarmTime, setLastAlarmTime] = useState(0);

const audioCtxRef   = useRef(null);
const prevStrongRef = useRef(false);
const historyRef    = useRef([]);

useEffect(() => {
const t = setInterval(() => { setNow(new Date()); setExpiries(getBinaryExpiries()); }, 1000);
setExpiries(getBinaryExpiries());
return () => clearInterval(t);
}, []);

useEffect(() => {
if (!mode) return;
const items = mode === “binary” ? CHECKLIST_BINARY : CHECKLIST_CFD;
setChecklist(Object.fromEntries(items.map(k => [k, false])));
setSignal(null); setShowChecklist(false);
setAlarmActive(false); setAlarmDismissed(false);
prevStrongRef.current = false;
}, [mode]);

function ensureAudio() {
if (!audioCtxRef.current)
audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
if (audioCtxRef.current.state === “suspended”) audioCtxRef.current.resume();
}

const fetchPrice = useCallback(async () => {
try {
const res = await fetch(API_URL);
if (res.ok) {
const data = await res.json();
if (data.status === “ok”) {
const iqPrice = +(data.iq_price || data.spot).toFixed(1);
setPrice(iqPrice); setSpotPrice(data.spot);
setSource(data.source); setLastUpdated(new Date());
setFetchError(false);
historyRef.current = […historyRef.current.slice(-59), iqPrice];
setPriceHistory([…historyRef.current]);
setDataPoints(historyRef.current.length);
return;
}
}
} catch (_) {}
setFetchError(true); setSource(“⚠️ API offline”);
}, []);

useEffect(() => {
fetchPrice();
const t = setInterval(fetchPrice, 15000);
return () => clearInterval(t);
}, [fetchPrice]);

useEffect(() => {
if (priceHistory.length < 27) return;
const result = analyzeIndicators(priceHistory);
setAnalysis(result);
const isStrong = result.greenCount >= 5 && result.direction;
const t = Date.now();
if (isStrong && !prevStrongRef.current && !alarmDismissed && t - lastAlarmTime > 90000) {
setAlarmActive(true); setLastAlarmTime(t);
playFireAlarm(audioCtxRef.current);
}
if (!isStrong) { prevStrongRef.current = false; setAlarmDismissed(false); }
else prevStrongRef.current = true;
}, [priceHistory]);

useEffect(() => {
if (!alarmActive) return;
const t = setInterval(() => playFireAlarm(audioCtxRef.current), 2500);
return () => clearInterval(t);
}, [alarmActive]);

function dismissAlarm() { setAlarmActive(false); setAlarmDismissed(true); setShowChecklist(true); }

const cfd = price ? calcCFD(invest, 800, price) : null;
const checklistItems = mode === “binary” ? CHECKLIST_BINARY : CHECKLIST_CFD;
const checklistDone  = Object.values(checklist).filter(Boolean).length;
const sessionStatus  = getCurrentSession();
const priceUp = priceHistory.length > 1 && priceHistory[priceHistory.length - 1] >= priceHistory[priceHistory.length - 2];
const strengthColor = analysis.greenCount >= 5 ? “#22c55e” : analysis.greenCount >= 4 ? “#f5c842” : “#3a2a06”;
const strengthLabel = dataPoints < 27 ? `BUILDING ${dataPoints}/27` : analysis.greenCount >= 5 ? “STRONG 🔥” : analysis.greenCount >= 4 ? “MEDIUM ⚡” : “WEAK”;
const dirColor = analysis.direction === “HIGHER” ? “#22c55e” : “#ef4444”;

async function generateSignal() {
if (generating) return;
setGenerating(true);
const dir = analysis.direction || “HIGHER”;
let text = “”;
if (mode === “binary”) {
const expiry = selectedExpiry || expiries[0]?.label || “–”;
text = `🥇 GOLD XAU — BINARY\n${dir === "HIGHER" ? "📈 HIGHER" : "📉 LOWER"}\n⏰ Entry: ${formatTime(now)}\n⏳ Expiry: ${expiry}\n💪 STRONG 🔥\n📊 ${analysis.greenCount}/6 confirmed\n\n🔄 Gale 1: $${Math.round(invest * 2.2)}\n🔄 Gale 2: $${Math.round(invest * 2.2 * 2.2)}\n🔄 Gale 3: $${Math.round(invest * 2.2 * 2.2 * 2.2)}`;
} else {
const action = dir === “HIGHER” ? “BUY” : “SELL”;
const slPrice = dir === “HIGHER” ? (price - cfd.sl20).toFixed(1) : (price + cfd.sl20).toFixed(1);
const tpPrice = dir === “HIGHER” ? (price + cfd.tp40).toFixed(1) : (price - cfd.tp40).toFixed(1);
text = `🥇 GOLD XAU — CFD\n${action === "BUY" ? "📈 BUY" : "📉 SELL"}\n⏰ Entry: ${formatTime(now)}\n💰 $${invest} × 800\n📊 ${analysis.greenCount}/6 confirmed\n💪 STRONG 🔥\n\n🎯 Entry: ${price}\n🛑 SL: ${slPrice}\n✅ TP: ${tpPrice}`;
}
try {
const res = await fetch(“https://api.anthropic.com/v1/messages”, {
method: “POST”,
headers: { “Content-Type”: “application/json” },
body: JSON.stringify({
model: “claude-sonnet-4-20250514”,
max_tokens: 1000,
messages: [{ role: “user”, content: `Gold IQ Option ${mode} signal. ONE punchy trader note max 10 words. Direction=${dir}, RSI=${analysis.rsi}, ${analysis.greenCount}/6 confirmed. No hashtags.` }]
})
});
const data = await res.json();
setSignal({ text, note: data.content?.[0]?.text?.trim() || “” });
} catch {
setSignal({ text, note: “Gold setup confirmed. Execute clean.” });
}
setGenerating(false);
}

function copySignal() {
if (!signal) return;
navigator.clipboard.writeText(signal.text);
setCopied(true); setTimeout(() => setCopied(false), 2000);
}

function resetAll() {
setSignal(null); setShowChecklist(false);
const items = mode === “binary” ? CHECKLIST_BINARY : CHECKLIST_CFD;
setChecklist(Object.fromEntries(items.map(k => [k, false])));
setAlarmActive(false); setAlarmDismissed(false);
prevStrongRef.current = false;
}

return (
<div onClick={ensureAudio} style={{ minHeight: “100vh”, background: “#060400”, color: “#f5c842”, fontFamily: “‘Courier New’, monospace”, overflowX: “hidden” }}>
<style>{`@keyframes fireFlash { 0%,100%{background:#090400} 50%{background:#200900} } @keyframes pulse { 0%,100%{box-shadow:0 0 8px #f5c84240} 50%{box-shadow:0 0 32px #f5c842cc} } @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.15} } @keyframes slideIn { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} } @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} } @keyframes greenPulse { 0%,100%{box-shadow:0 0 4px #22c55e30} 50%{box-shadow:0 0 22px #22c55e90} } @keyframes scanPing { 0%{transform:scaleX(0);opacity:1} 100%{transform:scaleX(1);opacity:0} } .signal-card { animation: slideIn 0.35s ease; } .alarm-emoji { animation: shake 0.4s infinite; display:inline-block; } .alarm-bg { animation: fireFlash 0.4s infinite; }`}</style>

```
  {alarmActive && (
    <div className="alarm-bg" style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="alarm-emoji" style={{ fontSize: 80 }}>🔥</div>
      <div style={{ fontSize: 11, letterSpacing: 6, color: "#ff8800", marginBottom: 6 }}>MOJIDTRADEBOT</div>
      <div style={{ fontSize: 30, fontWeight: 900, color: "#ff5500", letterSpacing: 3, textAlign: "center" }}>STRONG SIGNAL</div>
      <div style={{ fontSize: 12, color: "#f5c842", marginTop: 4, letterSpacing: 4 }}>GOLD XAU · {mode === "binary" ? "BINARY" : "CFD"}</div>
      {price && <div style={{ fontSize: 28, fontWeight: 900, color: "#ffe066", marginTop: 10 }}>${price.toFixed(1)}</div>}
      <div style={{ fontSize: 44, fontWeight: 900, marginTop: 12, color: dirColor }}>{analysis.direction === "HIGHER" ? "📈 HIGHER" : "📉 LOWER"}</div>
      <div style={{ fontSize: 11, color: "#6a5010", marginTop: 6 }}>{analysis.greenCount}/6 confirmed</div>
      <button onClick={dismissAlarm} style={{ marginTop: 28, padding: "16px 52px", borderRadius: 12, border: "2px solid #f5c842", background: "#f5c84220", color: "#f5c842", fontFamily: "inherit", fontWeight: 900, fontSize: 15, letterSpacing: 3, cursor: "pointer", animation: "pulse 1s infinite" }}>✅ CONFIRM TRADE</button>
      <button onClick={() => { setAlarmActive(false); setAlarmDismissed(true); }} style={{ marginTop: 10, padding: "10px 32px", borderRadius: 8, border: "1px solid #1a1200", background: "transparent", color: "#3a2a06", fontFamily: "inherit", fontSize: 11, letterSpacing: 2, cursor: "pointer" }}>SKIP</button>
    </div>
  )}

  <div style={{ maxWidth: 480, margin: "0 auto", padding: "20px 14px" }}>
    <div style={{ textAlign: "center", marginBottom: 18 }}>
      <div style={{ fontSize: 9, letterSpacing: 6, color: "#3a2a06" }}>MOJIDTRADEBOT</div>
      <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 2, textShadow: "0 0 18px #f5c84250" }}>🥇 GOLD BOT</div>
      <div style={{ fontSize: 9, letterSpacing: 3, color: "#3a2a06" }}>IQ OPTION · XAU · REAL DATA</div>
      <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: sessionStatus === "OPEN" ? "#f5c842" : "#2a1a04" }}>{now.toTimeString().slice(0, 8)}</div>
      <div style={{ display: "inline-block", marginTop: 5, padding: "3px 14px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: 2, background: sessionStatus === "OPEN" ? "#f5c84215" : "#1a0a00", border: `1px solid ${sessionStatus === "OPEN" ? "#f5c842" : "#2a1000"}`, color: sessionStatus === "OPEN" ? "#f5c842" : "#4a2000" }}>
        {sessionStatus === "OPEN" ? "🟢 GOLD MARKET OPEN" : "🔴 CLOSED · Opens 00:00"}
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
      {[{ key: "binary", label: "📊 BINARY", sub: "HIGHER / LOWER" }, { key: "cfd", label: "📈 CFD", sub: "BUY / SELL · SL & TP" }].map(m => (
        <button key={m.key} onClick={() => setMode(m.key)} style={{ padding: "14px 10px", borderRadius: 12, border: `2px solid ${mode === m.key ? "#f5c842" : "#1a1200"}`, background: mode === m.key ? "#f5c84218" : "#0a0700", color: mode === m.key ? "#f5c842" : "#3a2a06", fontFamily: "inherit", cursor: "pointer", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 900 }}>{m.label}</div>
          <div style={{ fontSize: 8, marginTop: 4, color: mode === m.key ? "#a08030" : "#2a1a04" }}>{m.sub}</div>
        </button>
      ))}
    </div>

    <div style={{ background: "#0a0700", border: `1px solid ${fetchError ? "#3a1010" : "#1e1600"}`, borderRadius: 12, padding: "14px 16px", marginBottom: 12, animation: analysis.greenCount >= 5 ? "greenPulse 1.5s infinite" : "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 8, letterSpacing: 2, color: "#3a2a06", marginBottom: 4 }}>{source || "CONNECTING..."}</div>
          {price ? (
            <>
              <div style={{ fontSize: 9, color: "#4a3a08", letterSpacing: 2 }}>GOLD XAU · IQ OPTION</div>
              <div style={{ fontSize: 34, fontWeight: 900, color: priceUp ? "#22c55e" : "#ef4444", lineHeight: 1, marginTop: 2, transition: "color 0.3s" }}>${price.toFixed(1)}</div>
            </>
          ) : (
            <div style={{ fontSize: 16, color: fetchError ? "#ef4444" : "#3a2a06", fontWeight: 700, marginTop: 6, animation: "blink 1s infinite" }}>{fetchError ? "⚠️ API OFFLINE" : "LOADING..."}</div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#3a2a06" }}>SIGNAL</div>
          <div style={{ fontSize: 12, fontWeight: 900, color: strengthColor, marginTop: 2 }}>{strengthLabel}</div>
          <div style={{ fontSize: 9, color: "#2a1a04", marginTop: 2 }}>{analysis.greenCount}/6</div>
          {lastUpdated && <div style={{ fontSize: 8, color: "#2a1a04", marginTop: 4 }}>↻ {lastUpdated.toTimeString().slice(0, 8)}</div>}
        </div>
      </div>
      {dataPoints < 27 && dataPoints > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 8, color: "#4a3a08", marginBottom: 4 }}>WARMING UP — {dataPoints}/27 (~{(27 - dataPoints) * 15}s)</div>
          <div style={{ height: 3, background: "#1a1200", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(dataPoints / 27) * 100}%`, background: "#f5c842", borderRadius: 3, transition: "width 0.5s" }} />
          </div>
        </div>
      )}
      <Sparkline prices={priceHistory} />
      <div style={{ marginTop: 8, height: 2, background: "#120e00", borderRadius: 2, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, transparent, ${strengthColor}, transparent)`, animation: "scanPing 1.6s infinite", transformOrigin: "left" }} />
      </div>
      <button onClick={fetchPrice} style={{ marginTop: 8, width: "100%", padding: "5px", borderRadius: 6, border: "1px solid #1a1200", background: "transparent", color: "#3a2a06", fontFamily: "inherit", fontSize: 9, letterSpacing: 2, cursor: "pointer" }}>↻ REFRESH</button>
    </div>

    {analysis.direction && dataPoints >= 27 && (
      <div style={{ padding: "11px", borderRadius: 10, background: dirColor + "0d", border: `1px solid ${dirColor}35`, textAlign: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 900, color: dirColor, letterSpacing: 2 }}>{analysis.direction === "HIGHER" ? "📈 BULLISH — HIGHER" : "📉 BEARISH — LOWER"}</span>
      </div>
    )}

    {mode === "binary" && (
      <div style={{ background: "#0a0700", border: "1px solid #1a1200", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 9, letterSpacing: 4, color: "#3a2a06", marginBottom: 10 }}>SELECT EXPIRY TIME</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
          {expiries.map(e => (
            <button key={e.label} onClick={() => setSelectedExpiry(e.label)} style={{ padding: "10px", borderRadius: 8, border: `1px solid ${selectedExpiry === e.label ? "#f5c842" : "#1a1200"}`, background: selectedExpiry === e.label ? "#f5c84218" : "transparent", color: selectedExpiry === e.label ? "#f5c842" : "#4a3a08", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}>
              <div style={{ fontSize: 13, fontWeight: 900 }}>{e.label}</div>
              <div style={{ fontSize: 9, color: selectedExpiry === e.label ? "#a08030" : "#2a1a04", marginTop: 2 }}>in {e.remaining}</div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 9, letterSpacing: 3, color: "#3a2a06", marginBottom: 8 }}>INVEST</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[20, 24, 50, 100].map(v => (
              <button key={v} onClick={() => setInvest(v)} style={{ flex: 1, padding: "7px 0", borderRadius: 6, border: `1px solid ${invest === v ? "#f5c842" : "#1a1200"}`, background: invest === v ? "#f5c84212" : "transparent", color: invest === v ? "#f5c842" : "#2a1a04", fontFamily: "inherit", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>${v}</button>
            ))}
          </div>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {[1, 2, 3].map(g => (
              <div key={g} style={{ padding: "8px", borderRadius: 7, border: "1px solid #1a1200", background: "#060400", textAlign: "center" }}>
                <div style={{ fontSize: 8, color: "#3a2a06" }}>GALE {g}</div>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#f5c842", marginTop: 2 }}>${Math.round(invest * Math.pow(2.2, g))}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

    {mode === "cfd" && cfd && (
      <div style={{ background: "#0a0700", border: "1px solid #1a1200", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 9, letterSpacing: 4, color: "#3a2a06", marginBottom: 10 }}>CFD RISK CALCULATOR · ×800</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[24, 50, 100, 200].map(v => (
            <button key={v} onClick={() => setInvest(v)} style={{ flex: 1, padding: "7px 0", borderRadius: 6, border: `1px solid ${invest === v ? "#f5c842" : "#1a1200"}`, background: invest === v ? "#f5c84212" : "transparent", color: invest === v ? "#f5c842" : "#2a1a04", fontFamily: "inherit", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>${v}</button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { label: "VOLUME", value: `${(invest * 800).toLocaleString()}`, color: "#f5c842" },
            { label: "PIP VALUE", value: `$${cfd.pipValue}`, color: "#f5c842" },
            { label: "SL −$20", value: `${cfd.sl20} pts`, color: "#ef4444" },
            { label: "SL −$50", value: `${cfd.sl50} pts`, color: "#ef4444" },
            { label: "TP +$40", value: `${cfd.tp40} pts`, color: "#22c55e" },
            { label: "TP +$100", value: `${cfd.tp100} pts`, color: "#22c55e" },
          ].map(r => (
            <div key={r.label} style={{ padding: "10px", borderRadius: 8, border: "1px solid #1a1200", background: "#060400" }}>
              <div style={{ fontSize: 8, color: "#3a2a06", letterSpacing: 2 }}>{r.label}</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: r.color, marginTop: 3 }}>{r.value}</div>
            </div>
          ))}
        </div>
        {price && analysis.direction && (
          <div style={{ marginTop: 10, padding: "10px", borderRadius: 8, background: "#060400", border: `1px solid ${dirColor}30` }}>
            <div style={{ fontSize: 9, color: "#3a2a06", marginBottom: 6, letterSpacing: 2 }}>PRICE LEVELS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, textAlign: "center" }}>
              {[
                { label: "SL", color: "#ef4444", val: analysis.direction === "HIGHER" ? (price - cfd.sl20).toFixed(1) : (price + cfd.sl20).toFixed(1) },
                { label: "ENTRY", color: "#f5c842", val: price.toFixed(1) },
                { label: "TP", color: "#22c55e", val: analysis.direction === "HIGHER" ? (price + cfd.tp40).toFixed(1) : (price - cfd.tp40).toFixed(1) },
              ].map(l => (
                <div key={l.label}>
                  <div style={{ fontSize: 8, color: l.color }}>{l.label}</div>
                  <div style={{ fontSize: 11, fontWeight: 900, color: l.color }}>{l.val}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )}

    {mode && !showChecklist && analysis.greenCount >= 5 && analysis.direction && !signal && dataPoints >= 27 && (
      <button onClick={() => { ensureAudio(); setShowChecklist(true); }} style={{ width: "100%", padding: "13px", borderRadius: 12, border: "2px solid #22c55e", background: "#22c55e12", color: "#22c55e", fontFamily: "inherit", fontWeight: 900, fontSize: 13, letterSpacing: 3, cursor: "pointer", marginBottom: 12, animation: "greenPulse 1.5s infinite" }}>
        🔥 STRONG SIGNAL — OPEN CHECKLIST
      </button>
    )}

    {mode && showChecklist && (
      <div className="signal-card" style={{ background: "#0a0700", border: "1px solid #f5c84240", borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 9, letterSpacing: 4, color: "#f5c842" }}>✅ {mode === "binary" ? "BINARY" : "CFD"} CHECKLIST</div>
          <div style={{ fontSize: 10, color: checklistDone >= 6 ? "#22c55e" : "#3a2a06" }}>{checklistDone}/{checklistItems.length}</div>
        </div>
        {checklistItems.map(item => (
          <div key={item} onClick={() => setChecklist(p => ({ ...p, [item]: !p[item] }))} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: "1px solid #120e00", cursor: "pointer" }}>
            <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, border: `1px solid ${checklist[item] ? "#22c55e" : "#1e1600"}`, background: checklist[item] ? "#22c55e18" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
              {checklist[item] && <span style={{ fontSize: 9, color: "#22c55e" }}>✓</span>}
            </div>
            <span style={{ fontSize: 10, color: checklist[item] ? "#22c55e" : "#3a2a06", lineHeight: 1.5 }}>{item}</span>
          </div>
        ))}
        <div style={{ marginTop: 10, height: 3, background: "#120e00", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(checklistDone / checklistItems.length) * 100}%`, background: checklistDone >= 6 ? "#22c55e" : "#f5c842", transition: "width 0.3s" }} />
        </div>
        {checklistDone >= 6 && (
          <button onClick={generateSignal} disabled={generating} style={{ width: "100%", marginTop: 12, padding: "13px", borderRadius: 10, border: "2px solid #22c55e", background: "#22c55e12", color: "#22c55e", fontFamily: "inherit", fontWeight: 900, fontSize: 13, letterSpacing: 3, cursor: "pointer", animation: "greenPulse 1.5s infinite" }}>
            {generating ? "⚙️ GENERATING..." : "🥇 GENERATE SIGNAL"}
          </button>
        )}
      </div>
    )}

    {signal && (
      <div className="signal-card" style={{ background: "#0a0700", border: "1px solid #f5c842", borderRadius: 12, padding: 18, marginBottom: 14, boxShadow: "0 0 26px #f5c84220" }}>
        <div style={{ fontSize: 9, letterSpacing: 4, color: "#f5c842", marginBottom: 12 }}>📡 SIGNAL READY</div>
        <pre style={{ fontFamily: "inherit", fontSize: 13, lineHeight: 1.9, color: "#ffe066", margin: 0, whiteSpace: "pre-wrap" }}>{signal.text}</pre>
        {signal.note && (
          <div style={{ marginTop: 12, padding: "9px 12px", background: "#100c00", borderRadius: 8, borderLeft: "3px solid #f5c842", fontSize: 11, color: "#7a6018", fontStyle: "italic" }}>🤖 {signal.note}</div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
          <button onClick={copySignal} style={{ padding: "11px", borderRadius: 8, border: "1px solid #f5c842", background: copied ? "#f5c84218" : "transparent", color: "#f5c842", fontFamily: "inherit", fontWeight: 700, fontSize: 11, letterSpacing: 2, cursor: "pointer" }}>{copied ? "✅ COPIED" : "📋 COPY"}</button>
          <button onClick={resetAll} style={{ padding: "11px", borderRadius: 8, border: "1px solid #1a1200", background: "transparent", color: "#2a1a04", fontFamily: "inherit", fontWeight: 700, fontSize: 11, letterSpacing: 2, cursor: "pointer" }}>🔄 RESET</button>
        </div>
      </div>
    )}

    <div style={{ textAlign: "center", fontSize: 8, color: "#180f00", letterSpacing: 3, marginTop: 10 }}>MOJIDTRADEBOT © 2025 — GOLD EDITION</div>
  </div>
</div>
```

);
}
