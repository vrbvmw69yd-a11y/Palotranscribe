import { useEffect, useMemo, useRef, useState } from "react";
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import { HERO_IMAGE } from "./hero";

type ModelKey = "fast" | "recommended" | "pro";
type ResultItem = { name: string; text: string; ok: boolean };

const MODELS: Record<ModelKey, { title: string; detail: string }> = {
  fast: { title: "🚀 Rápido", detail: "Whisper Tiny · máxima velocidad" },
  recommended: { title: "⚡ Recomendado", detail: "Whisper Base · equilibrio" },
  pro: { title: "🎯 Pro", detail: "Whisper Small · más precisión" },
};
const HEALTH = "https://dpnjavicsonidjjuwkug.supabase.co/functions/v1/palotranscribe-health";
const SR = 16000;
const BLOCK = SR * 75;

const safe = (s: string) => s.replace(/[\\/:*?\"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "Transcripciones";
const size = (n: number) => n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function resample(buffer: AudioBuffer) {
  const ratio = buffer.sampleRate / SR;
  const out = new Float32Array(Math.max(1, Math.floor(buffer.length / ratio)));
  const ch = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < out.length; i++) {
    const p = i * ratio, a = Math.floor(p), b = Math.min(a + 1, buffer.length - 1), t = p - a;
    let v = 0;
    for (const c of ch) v += (c[a] || 0) + ((c[b] || 0) - (c[a] || 0)) * t;
    out[i] = v / Math.max(1, ch.length);
  }
  return out;
}

class Queue {
  parts: Float32Array[] = [];
  length = 0;
  push(v: Float32Array) { if (v.length) { this.parts.push(v); this.length += v.length; } }
  take(n: number) {
    n = Math.min(n, this.length); const out = new Float32Array(n); let w = 0;
    while (w < n && this.parts.length) {
      const h = this.parts[0], k = Math.min(h.length, n - w); out.set(h.subarray(0, k), w); w += k; this.length -= k;
      if (k === h.length) this.parts.shift(); else this.parts[0] = h.subarray(k);
    }
    return out;
  }
}

function normalize(text: string, medical: boolean, glossary: string) {
  let out = text.replace(/\s+/g, " ").trim();
  if (medical) {
    const fixes: [RegExp, string][] = [[/\bglasco\b/gi,"Glasgow"],[/\bcenetec\b/gi,"CENETEC"],[/\bceftriasona\b/gi,"ceftriaxona"],[/\bhipovolemico\b/gi,"hipovolémico"]];
    for (const [r, v] of fixes) out = out.replace(r, v);
  }
  for (const term of glossary.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean)) {
    const e = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); out = out.replace(new RegExp(`\\b${e}\\b`, "gi"), term);
  }
  return out;
}

function download(text: string, name: string) {
  const u = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
}

export default function App() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }>());
  const readyWait = useRef(new Map<ModelKey, Array<() => void>>());
  const [files, setFiles] = useState<File[]>([]);
  const [model, setModel] = useState<ModelKey>("recommended");
  const [medical, setMedical] = useState(true);
  const [glossary, setGlossary] = useState("");
  const [filename, setFilename] = useState("");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState((navigator as any).gpu ? "WEBGPU" : "WASM");
  const [status, setStatus] = useState("Listo para transcribir");
  const [detail, setDetail] = useState("Selecciona tus audios para preparar el modelo.");
  const [progress, setProgress] = useState(0);
  const [supabase, setSupabase] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(HEALTH, { cache: "no-store" }).then(r => r.json()).then(x => setSupabase(x?.ok && x?.project === "PaloTranscribe")).catch(() => setSupabase(false));
    const w = new Worker(new URL("./transcriber.worker.ts", import.meta.url), { type: "module" }); worker.current = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "loading") { setReady(false); setDevice(String(m.device).toUpperCase()); setStatus("Preparando modelo"); setDetail("Primera carga: descarga y caché local."); }
      if (m.type === "model-progress" && typeof m.progress === "number") setProgress(Math.min(35, Math.max(1, m.progress * .35)));
      if (m.type === "ready") { setReady(true); setDevice(String(m.device).toUpperCase()); (readyWait.current.get(m.modelKey as ModelKey) || []).forEach(fn => fn()); readyWait.current.delete(m.modelKey); setStatus("Modelo listo"); setDetail("Ya puedes transcribir."); }
      if (m.type === "result") { const p = pending.current.get(m.id); if (p) { p.resolve(m.text || ""); pending.current.delete(m.id); } }
      if (m.type === "error") { const p = pending.current.get(m.id); if (p) { p.reject(new Error(m.message)); pending.current.delete(m.id); } else { setStatus("Error del motor"); setDetail(m.message || "Error desconocido"); } }
    };
    return () => w.terminate();
  }, []);

  const load = (key: ModelKey) => new Promise<void>((resolve) => {
    const a = readyWait.current.get(key) || []; a.push(resolve); readyWait.current.set(key, a); worker.current?.postMessage({ type: "load", modelKey: key });
  });
  const warm = (key: ModelKey) => worker.current?.postMessage({ type: "load", modelKey: key });
  const ask = (audio: Float32Array) => new Promise<string>((resolve, reject) => {
    const id = crypto.randomUUID(); pending.current.set(id, { resolve, reject }); worker.current?.postMessage({ type: "transcribe", id, modelKey: model, audio: audio.buffer }, [audio.buffer]);
  });

  const choose = (list: FileList | File[]) => {
    const a = Array.from(list).filter(f => f.type.startsWith("audio/") || f.type.startsWith("video/") || /\.(m4a|mp3|wav|aac|ogg|flac|mp4|mov|webm)$/i.test(f.name)).slice(0, 20);
    setFiles(a); setResults([]); setReady(false); if (a.length) warm(model);
  };

  useEffect(() => { if (files.length) { setReady(false); warm(model); } }, [model]);

  const oneFile = async (file: File, fi: number, total: number) => {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack(); if (!track) throw new Error("No hay pista de audio");
      if (!(await track.canDecode())) throw new Error("Códec no compatible en este navegador");
      const duration = (await track.getDurationFromMetadata()) || (await track.computeDuration());
      const sink = new AudioBufferSink(track), q = new Queue(), pieces: string[] = []; let bi = 0;
      const flush = async (last = false) => {
        while (q.length >= BLOCK || (last && q.length >= SR)) {
          const pcm = q.take(q.length >= BLOCK ? BLOCK : q.length); bi++;
          const within = Math.min(1, (bi * 75) / Math.max(1, duration)); setProgress(38 + ((fi + within) / total) * 60);
          setStatus(`Transcribiendo ${fi + 1}/${total}`); setDetail(`${file.name} · bloque ${bi}`);
          const txt = await ask(pcm); if (txt.trim()) pieces.push(txt.trim());
        }
      };
      for await (const { buffer } of sink.buffers()) { q.push(resample(buffer)); await flush(); }
      await flush(true); return pieces.join("\n").trim();
    } finally { input.dispose(); }
  };

  const run = async () => {
    if (!files.length || busy) return; setBusy(true); setResults([]); setProgress(2); setStatus("Preparando");
    const done: ResultItem[] = [];
    try {
      if (!ready) await load(model);
      for (let i = 0; i < files.length; i++) {
        try { const text = normalize((await oneFile(files[i], i, files.length)) || "[Sin texto reconocible]", medical, glossary); done.push({ name: files[i].name, text, ok: true }); }
        catch (e) { done.push({ name: files[i].name, text: `[ARCHIVO OMITIDO: ${e instanceof Error ? e.message : String(e)}]`, ok: false }); }
        setResults([...done]);
      }
      setProgress(100); setStatus("Transcripción terminada ✨"); setDetail(`${done.filter(x => x.ok).length} de ${done.length} procesados.`);
    } finally { setBusy(false); }
  };

  const combined = useMemo(() => {
    const title = safe(filename || `Transcripciones ${results.length} clases`);
    return `${title}\nModelo: ${MODELS[model].title}\nAceleración: ${device}\n${"=".repeat(72)}\n\n` + results.map((r, i) => `${"#".repeat(72)}\nClase ${i + 1} — ${r.name}\n${"#".repeat(72)}\n\n${r.text}`).join("\n\n");
  }, [results, filename, model, device]);

  return <div className="page">
    <header><a className="brand" href="#inicio"><span className="wave">▂▄▆█▆▄▂</span> palotranscribe</a><nav><a href="#transcribir">Transcribir</a><a href="#como">Cómo funciona</a></nav></header>
    <section className="hero" id="inicio"><div><span className="eyebrow">✧ AUDIO A TEXTO</span><h1>para Paloma<br/>mi novia <b>❤️</b></h1><p>Transcribe tus clases rápido y de forma privada, directamente en el navegador.</p><div className="pills"><span>ϟ Rápido</span><span>◎ Privado</span><span>♡ Para Paloma</span></div></div><div className="art"><img src={HERO_IMAGE} alt="Ilustración de pareja"/></div></section>
    <section className="engine"><div><i className={ready ? "ok" : ""}/><strong>{ready ? "Motor preparado" : "Motor local"}</strong><small>{device} · caché local</small></div><span className={supabase ? "connected" : ""}>● Supabase nuevo: {supabase === null ? "comprobando" : supabase ? "conectado" : "sin conexión"}</span></section>
    <section className="card" id="transcribir"><label>Nombre del archivo final<input value={filename} onChange={e => setFilename(e.target.value)} placeholder="Ej.: Gastroenterología — Primer parcial"/></label>
      <label className="drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();choose(e.dataTransfer.files)}}><input type="file" multiple accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.flac,.mp4,.mov,.webm" onChange={e=>e.target.files&&choose(e.target.files)}/><span>⇧</span><strong>{files.length ? `${files.length} archivo${files.length===1?"":"s"} listo${files.length===1?"":"s"}` : "Arrastra y suelta tus audios aquí"}</strong><small>o selecciónalos desde Archivos · máximo 20</small><b>Seleccionar archivos</b></label>
      {files.length>0&&<div className="files">{files.map((f,i)=><div key={f.name+f.lastModified}><span>{i+1}. {f.name}</span><small>{size(f.size)}</small></div>)}</div>}
      <div className="grid"><div><h3>Modelo local</h3>{(Object.keys(MODELS) as ModelKey[]).map(k=><label className={`model ${model===k?"sel":""}`} key={k}><input type="radio" checked={model===k} onChange={()=>setModel(k)}/><i/><span><strong>{MODELS[k].title}</strong><small>{MODELS[k].detail}</small></span></label>)}</div><div className="opts"><label>Idioma<div>Español</div></label><label className="check"><input type="checkbox" checked={medical} onChange={e=>setMedical(e.target.checked)}/><span>Modo médico</span></label><label>Glosario opcional<textarea value={glossary} onChange={e=>setGlossary(e.target.value)} placeholder="ceftriaxona, Glasgow, CENETEC…"/></label></div></div>
      <button className="go" disabled={!files.length||busy} onClick={run}>{busy?"TRANSCRIBIENDO…":"TRANSCRIBIR"}</button>
      {(busy||progress>0||ready)&&<div className="prog"><div><strong>{status}</strong><small>{detail}</small><b>{Math.round(progress)}%</b></div><span><i style={{width:`${progress}%`}}/></span></div>}
    </section>
    {results.length>0&&<section className="result"><div><span><h2>Resultado</h2><small>{results.filter(x=>x.ok).length} de {results.length} procesados</small></span><button onClick={()=>download(combined,`${safe(filename||"Transcripciones")}.txt`)}>↓ TXT completo</button></div><pre>{combined}</pre></section>}
    <section className="features" id="como"><article><b>ϟ</b><span><strong>Optimizado</strong><small>WebGPU cuando está disponible, WASM como respaldo.</small></span></article><article><b>◎</b><span><strong>Audio local</strong><small>Procesamiento por fragmentos para cuidar la memoria.</small></span></article><article><b>♡</b><span><strong>Resistente</strong><small>Si un archivo falla, continúa con los demás.</small></span></article></section>
    <footer>PaloTranscribe · proyecto nuevo aislado · audio procesado localmente.</footer>
  </div>;
}
