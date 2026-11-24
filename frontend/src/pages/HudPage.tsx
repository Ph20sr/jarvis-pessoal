/**
 * HUD — tela de comando por voz (pt-BR).
 *
 * Um núcleo animado que respira, escuta, pensa e fala; espectro de áudio ao
 * vivo; cards de hora, clima e sistema; e o fio da conversa. Usa o mesmo
 * backend do chat (/v1/chat/completions com o agente do servidor), a
 * transcrição local (/v1/speech/transcribe) e a voz local
 * (/v1/speech/synthesize). Quando o backend de voz não está disponível, cai
 * para o reconhecimento e a fala do próprio navegador.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { MessageSquare, Mic, Send, Volume2, VolumeX, Ear, EarOff } from 'lucide-react';
import { streamChat } from '../lib/sse';
import {
  checkHealth,
  fetchServerInfo,
  fetchSpeechHealth,
  fetchTtsHealth,
  synthesizeSpeech,
  transcribeAudio,
} from '../lib/api';
import { toSpeakableText } from '../lib/message-text';
import { useAppStore } from '../lib/store';
import './hud.css';

type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking';
interface HudMsg {
  role: 'user' | 'assistant';
  content: string;
}
interface TickerItem {
  id: number;
  time: string;
  text: string;
}

const PALETTE: Record<CoreState, [number, number, number]> = {
  idle: [64, 196, 255],
  listening: [72, 255, 196],
  thinking: [168, 128, 255],
  speaking: [255, 184, 77],
};

const STATE_LABEL: Record<CoreState, string> = {
  idle: 'EM ESPERA',
  listening: 'OUVINDO',
  thinking: 'PROCESSANDO',
  speaking: 'RESPONDENDO',
};

const TOOL_LABEL: Record<string, string> = {
  web_search: 'pesquisando na web',
  weather_free: 'consultando o clima',
  get_weather: 'consultando o clima',
  open_app: 'abrindo programa',
  open_url: 'abrindo navegador',
  media_control: 'controlando mídia',
  lock_screen: 'bloqueando a tela',
  memory_manage: 'acessando memória',
  calculator: 'calculando',
  think: 'raciocinando',
};

const WMO: Record<number, string> = {
  0: 'Céu limpo', 1: 'Poucas nuvens', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Neblina', 48: 'Neblina', 51: 'Garoa', 53: 'Garoa', 55: 'Garoa forte',
  61: 'Chuva fraca', 63: 'Chuva', 65: 'Chuva forte', 80: 'Pancadas', 81: 'Pancadas', 82: 'Temporal',
  95: 'Trovoadas', 96: 'Trovoadas', 99: 'Trovoadas',
};

// ---------- preferências locais (sempre com try/catch) ----------
function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`hud-${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`hud-${key}`, JSON.stringify(value));
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Web Speech API (não tipada no lib.dom de todos os TS)
type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
const SRCtor: (new () => SR) | undefined =
  typeof window !== 'undefined'
    ? ((window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition)
    : undefined;

export function HudPage() {
  const navigate = useNavigate();
  const pickedModel = useAppStore((s) => s.selectedModel);
  const serverInfo = useAppStore((s) => s.serverInfo);
  // O HUD sempre usa o cérebro configurado no núcleo (ex.: Gemini); o modelo
  // escolhido no chat só vale se o núcleo ainda não respondeu.
  const selectedModel = serverInfo?.model || pickedModel;

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchServerInfo()
        .then((info) => alive && useAppStore.getState().setServerInfo(info))
        .catch(() => alive && window.setTimeout(load, 3000));
    load();
    return () => {
      alive = false;
    };
  }, []);

  const [core, setCore] = useState<CoreState>('idle');
  const [caption, setCaption] = useState('');
  const [interim, setInterim] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<HudMsg[]>([]);
  const [ticker, setTicker] = useState<TickerItem[]>([]);
  const [now, setNow] = useState(new Date());
  const [online, setOnline] = useState<boolean | null>(null);
  const [backendStt, setBackendStt] = useState(false);
  const [backendTts, setBackendTts] = useState(false);
  const [voiceOn, setVoiceOn] = useState<boolean>(() => loadPref('voice', true));
  const [wakeOn, setWakeOn] = useState<boolean>(() => loadPref('wake', false));
  const [wakeWord, setWakeWord] = useState<string>(() => loadPref('wakeWord', 'Jarvis'));
  const [city, setCity] = useState<string>(() => loadPref('city', 'São Paulo'));
  const [weather, setWeather] = useState<{ temp: number; feels: number; desc: string; max: number; min: number; rain: number } | null>(null);
  const [lastLatency, setLastLatency] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef<HTMLCanvasElement>(null);
  const coreRef = useRef<CoreState>('idle');
  const levelRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsQueueRef = useRef<Promise<void>>(Promise.resolve());
  const ttsTokenRef = useRef(0);
  const busyRef = useRef(false);
  const recRef = useRef<SR | null>(null);
  const wakeArmedRef = useRef(false);
  const messagesRef = useRef<HudMsg[]>([]);
  const tickerId = useRef(0);

  coreRef.current = core;
  messagesRef.current = messages;

  const log = useCallback((text: string) => {
    const t = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setTicker((prev) => [{ id: ++tickerId.current, time: t, text }, ...prev].slice(0, 14));
  }, []);

  // ---------- relógio, saúde do backend, voz disponível ----------
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  useEffect(() => {
    const check = () => checkHealth().then(setOnline).catch(() => setOnline(false));
    check();
    const i = setInterval(check, 20000);
    fetchSpeechHealth().then((h) => setBackendStt(h.available)).catch(() => setBackendStt(false));
    fetchTtsHealth().then((h) => setBackendTts(h.available)).catch(() => setBackendTts(false));
    if (tickerId.current === 0) log('Sistema iniciado');
    return () => clearInterval(i);
  }, [log]);

  // ---------- clima (Open-Meteo, grátis) ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const g = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&name=${encodeURIComponent(city)}`,
        ).then((r) => r.json());
        const loc = g.results?.[0];
        if (!loc) return;
        const w = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
            '&current=temperature_2m,apparent_temperature,weather_code' +
            '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto',
        ).then((r) => r.json());
        if (cancelled) return;
        setWeather({
          temp: Math.round(w.current.temperature_2m),
          feels: Math.round(w.current.apparent_temperature),
          desc: WMO[w.current.weather_code] ?? '—',
          max: Math.round(w.daily.temperature_2m_max[0]),
          min: Math.round(w.daily.temperature_2m_min[0]),
          rain: w.daily.precipitation_probability_max[0] ?? 0,
        });
      } catch {
        if (!cancelled) setWeather(null);
      }
    })();
    const i = setInterval(() => setCity((c) => c), 15 * 60000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, [city]);

  // ---------- áudio: um analisador compartilhado (mic e voz) ----------
  const ensureAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    }
    if (audioCtxRef.current.state === 'suspended') void audioCtxRef.current.resume();
    return { ctx: audioCtxRef.current, analyser: analyserRef.current! };
  }, []);

  // ---------- desenho do núcleo e do espectro ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    const spec = spectrumRef.current;
    if (!canvas || !spec) return;
    const ctx = canvas.getContext('2d')!;
    const sctx = spec.getContext('2d')!;
    let raf = 0;
    let energy = 0;
    const color = [...PALETTE.idle];
    const freq = new Uint8Array(128);
    const start = performance.now();

    const fit = (c: HTMLCanvasElement) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = c.getBoundingClientRect();
      if (c.width !== Math.round(r.width * dpr)) c.width = Math.round(r.width * dpr);
      if (c.height !== Math.round(r.height * dpr)) c.height = Math.round(r.height * dpr);
      return dpr;
    };

    const draw = (t0: number) => {
      const t = (t0 - start) / 1000;
      const state = coreRef.current;
      const target = PALETTE[state];
      for (let i = 0; i < 3; i++) color[i] += (target[i] - color[i]) * 0.06;
      const rgb = color.map(Math.round).join(',');

      // nível de áudio atual
      let level = 0;
      const analyser = analyserRef.current;
      if (analyser && (state === 'listening' || state === 'speaking')) {
        analyser.getByteFrequencyData(freq);
        let s = 0;
        for (let i = 2; i < 64; i++) s += freq[i];
        level = Math.min(1, s / (62 * 160));
      } else {
        freq.fill(0);
      }
      levelRef.current = level;
      const base = state === 'thinking' ? 0.45 : state === 'idle' ? 0.08 : 0.2;
      energy += (base + level * 1.4 - energy) * 0.15;

      // ----- núcleo -----
      const dpr = fit(canvas);
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.2 * (1 + Math.sin(t * 1.5) * 0.02 + energy * 0.12);

      const halo = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 2.6);
      halo.addColorStop(0, `rgba(${rgb},${0.22 + energy * 0.25})`);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);

      // anel de marcações (gira devagar; rápido quando pensa)
      const spin = state === 'thinking' ? 1.6 : 0.15;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * spin * 0.3);
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const long = i % 6 === 0;
        const r1 = R * 1.62;
        const r2 = r1 + (long ? 12 : 5) * dpr;
        ctx.strokeStyle = `rgba(${rgb},${long ? 0.7 : 0.3})`;
        ctx.lineWidth = (long ? 2 : 1) * dpr;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();

      // arcos segmentados
      for (let k = 0; k < 3; k++) {
        const rr = R * (1.25 + k * 0.17);
        const dir = k % 2 ? -1 : 1;
        const off = t * (0.4 + k * 0.25 + (state === 'thinking' ? 1.5 : 0)) * dir;
        ctx.strokeStyle = `rgba(${rgb},${0.25 + energy * 0.35})`;
        ctx.lineWidth = (k === 1 ? 3 : 1.5) * dpr;
        for (let s = 0; s < 4; s++) {
          const a0 = off + (s * Math.PI) / 2;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, a0, a0 + Math.PI * (0.18 + k * 0.08));
          ctx.stroke();
        }
      }

      // forma de onda circular reagindo ao áudio
      ctx.beginPath();
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        const f = freq[(i % 64) + 2] / 255;
        const wob = Math.sin(a * 6 + t * 2) * 0.03 + Math.sin(a * 3 - t * 1.3) * 0.02;
        const r = R * (1.02 + wob * (1 + energy * 3) + f * 0.35);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${rgb},0.85)`;
      ctx.lineWidth = 1.5 * dpr;
      ctx.shadowColor = `rgba(${rgb},0.9)`;
      ctx.shadowBlur = 18 * dpr;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // esfera interna
      const g = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R);
      g.addColorStop(0, `rgba(255,255,255,${0.5 + energy * 0.4})`);
      g.addColorStop(0.35, `rgba(${rgb},0.55)`);
      g.addColorStop(1, `rgba(${rgb},0.04)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.92, 0, Math.PI * 2);
      ctx.fill();

      // ----- espectro -----
      const sd = fit(spec);
      const SW = spec.width;
      const SH = spec.height;
      sctx.clearRect(0, 0, SW, SH);
      const bars = 48;
      const bw = SW / bars;
      for (let i = 0; i < bars; i++) {
        const idle = (Math.sin(t * 2 + i * 0.5) * 0.5 + 0.5) * 0.08;
        const v = Math.max(idle, freq[i + 2] / 255);
        const h = Math.max(2 * sd, v * SH);
        sctx.fillStyle = `rgba(${rgb},${0.35 + v * 0.6})`;
        sctx.fillRect(i * bw + bw * 0.2, (SH - h) / 2, bw * 0.6, h);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------- fala ----------
  const stopSpeaking = useCallback(() => {
    ttsTokenRef.current += 1;
    ttsQueueRef.current = Promise.resolve();
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();
  }, []);

  const speakChunk = useCallback(
    (text: string) => {
      const clean = toSpeakableText(text).trim();
      if (!voiceOn || !clean) return;
      const token = ttsTokenRef.current;
      ttsQueueRef.current = ttsQueueRef.current.then(async () => {
        if (token !== ttsTokenRef.current) return;
        if (backendTts) {
          try {
            const blob = await synthesizeSpeech(clean);
            if (token !== ttsTokenRef.current) return;
            const url = URL.createObjectURL(blob);
            const el = new Audio(url);
            ttsAudioRef.current = el;
            const { ctx, analyser } = ensureAudio();
            const src = ctx.createMediaElementSource(el);
            src.connect(analyser);
            analyser.connect(ctx.destination);
            setCore('speaking');
            await el.play();
            await new Promise<void>((res) => {
              el.onended = () => res();
              el.onerror = () => res();
            });
            src.disconnect();
            try {
              analyser.disconnect(ctx.destination);
            } catch {
              /* já desconectado */
            }
            URL.revokeObjectURL(url);
            return;
          } catch {
            /* cai para a voz do navegador */
          }
        }
        await new Promise<void>((res) => {
          const synth = window.speechSynthesis;
          if (!synth) return res();
          const u = new SpeechSynthesisUtterance(clean);
          u.lang = 'pt-BR';
          const v = synth
            .getVoices()
            .filter((x) => /pt[-_]BR/i.test(x.lang))
            .sort((a, b) => Number(/Natural|Online/.test(b.name)) - Number(/Natural|Online/.test(a.name)))[0];
          if (v) u.voice = v;
          u.onstart = () => setCore('speaking');
          u.onend = () => res();
          u.onerror = () => res();
          synth.speak(u);
        });
      });
      void ttsQueueRef.current.then(() => {
        if (token === ttsTokenRef.current && !busyRef.current) setCore('idle');
      });
    },
    [backendTts, ensureAudio, voiceOn],
  );

  // ---------- conversa ----------
  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;
      if (!selectedModel) {
        setCaption('Nenhum modelo selecionado. Abra o chat e escolha um modelo (Ctrl+K).');
        return;
      }
      stopSpeaking();
      busyRef.current = true;
      setCore('thinking');
      setInterim('');
      setCaption('');
      log(`Comando: "${text.slice(0, 60)}"`);
      const history: HudMsg[] = [...messagesRef.current, { role: 'user', content: text }];
      setMessages([...history, { role: 'assistant', content: '' }]);

      const started = performance.now();
      let full = '';
      let pending = '';
      const flushSentences = (final: boolean) => {
        const re = /[^.!?\n]+[.!?]+["')\]]?\s+|[^\n]+\n+/g;
        let m: RegExpExecArray | null;
        let last = 0;
        while ((m = re.exec(pending))) {
          speakChunk(m[0]);
          last = re.lastIndex;
        }
        pending = pending.slice(last);
        if (final && pending.trim()) {
          speakChunk(pending);
          pending = '';
        }
      };

      try {
        for await (const ev of streamChat({
          model: selectedModel,
          messages: history.slice(-20),
          stream: true,
        })) {
          if (ev.event === 'tool_call_start') {
            try {
              const d = JSON.parse(ev.data);
              log(TOOL_LABEL[d.tool] ? `${TOOL_LABEL[d.tool]}…` : `ferramenta: ${d.tool}`);
            } catch {
              /* ignora */
            }
            continue;
          }
          if (ev.event && ev.event !== 'message') continue;
          try {
            const d = JSON.parse(ev.data);
            const delta: string | undefined = d.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              pending += delta;
              const visible = full.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
              setCaption(visible.slice(-320));
              setMessages([...history, { role: 'assistant', content: visible }]);
              if (!/<think>(?![\s\S]*<\/think>)/.test(full)) {
                pending = pending.replace(/<think>[\s\S]*?<\/think>/g, '');
                flushSentences(false);
              }
            }
            if (d.choices?.[0]?.finish_reason === 'stop') break;
          } catch {
            /* trecho malformado */
          }
        }
        pending = pending.replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
        flushSentences(true);
        setLastLatency(Math.round(performance.now() - started));
        log('Resposta concluída');
      } catch (err) {
        const msg = 'Não consegui falar com o núcleo. O servidor e o Ollama estão rodando?';
        setCaption(msg);
        speakChunk(msg);
        log(`Erro: ${err instanceof Error ? err.message : String(err)}`);
        setMessages(history);
      } finally {
        busyRef.current = false;
        void ttsQueueRef.current.then(() => {
          if (!busyRef.current && coreRef.current !== 'listening') setCore('idle');
        });
      }
    },
    [log, selectedModel, speakChunk, stopSpeaking],
  );

  // ---------- escuta: gravação + transcrição local, com corte por silêncio ----------
  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state === 'recording') r.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (recorderRef.current?.state === 'recording') return;
    stopSpeaking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const { ctx, analyser } = ensureAudio();
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        src.disconnect();
        stream.getTracks().forEach((tr) => tr.stop());
        micStreamRef.current = null;
        recorderRef.current = null;
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 2000) {
          setCore('idle');
          return;
        }
        setCore('thinking');
        setInterim('transcrevendo…');
        try {
          const r = await transcribeAudio(blob);
          setInterim('');
          if (r.text?.trim()) void send(r.text);
          else setCore('idle');
        } catch {
          setInterim('');
          setCaption('Não entendi o áudio. Tente de novo.');
          setCore('idle');
        }
      };
      recorderRef.current = rec;
      rec.start();
      setCore('listening');
      log('Microfone aberto');

      // corta sozinho depois de ~1,3 s de silêncio (após ter ouvido voz) ou 15 s
      const began = performance.now();
      let heard = false;
      let quietSince = 0;
      const watch = () => {
        if (rec.state !== 'recording') return;
        const lvl = levelRef.current;
        const t = performance.now();
        if (lvl > 0.08) {
          heard = true;
          quietSince = 0;
        } else if (heard) {
          quietSince ||= t;
          if (t - quietSince > 1300) return rec.stop();
        }
        if (t - began > 15000 || (!heard && t - began > 6000)) return rec.stop();
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    } catch {
      setCaption('Permita o microfone para falar comigo.');
      setCore('idle');
    }
  }, [ensureAudio, log, send, stopSpeaking]);

  // reconhecimento do navegador (fallback e palavra de ativação)
  const browserListenOnce = useCallback(() => {
    if (!SRCtor) return;
    stopSpeaking();
    const rec = new SRCtor();
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let txt = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) void send(r[0].transcript);
        else txt += r[0].transcript;
      }
      setInterim(txt);
    };
    rec.onend = () => {
      setInterim('');
      if (coreRef.current === 'listening') setCore('idle');
    };
    rec.onerror = () => setCore('idle');
    setCore('listening');
    rec.start();
  }, [send, stopSpeaking]);

  const listen = useCallback(() => {
    if (recorderRef.current?.state === 'recording') return stopRecording();
    if (backendStt) void startRecording();
    else if (SRCtor) browserListenOnce();
    else setCaption('Sem reconhecimento de voz: ative o speech no servidor ou use Chrome/Edge.');
  }, [backendStt, browserListenOnce, startRecording, stopRecording]);

  // palavra de ativação: escuta contínua do navegador procurando o nome
  useEffect(() => {
    if (!wakeOn || !SRCtor) return;
    let alive = true;
    const word = normalize(wakeWord.trim());
    const pattern = new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
    const startWake = () => {
      if (!alive) return;
      const rec = new SRCtor();
      recRef.current = rec;
      rec.lang = 'pt-BR';
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          const said = e.results[i][0].transcript;
          if (busyRef.current || coreRef.current === 'speaking') continue;
          if (wakeArmedRef.current) {
            wakeArmedRef.current = false;
            void send(said);
            continue;
          }
          const m = pattern.exec(normalize(said));
          if (!m) continue;
          const rest = said.slice(m.index + m[0].length).replace(/^[\s,.!?]+/, '');
          if (rest.length > 2) void send(rest);
          else {
            wakeArmedRef.current = true;
            setCore('listening');
            log('Palavra de ativação');
            setTimeout(() => {
              if (wakeArmedRef.current) {
                wakeArmedRef.current = false;
                if (coreRef.current === 'listening') setCore('idle');
              }
            }, 7000);
          }
        }
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed') {
          alive = false;
          setWakeOn(false);
          setCaption('Permita o microfone para usar a palavra de ativação.');
        }
      };
      rec.onend = () => {
        if (alive) setTimeout(startWake, 300);
      };
      try {
        rec.start();
      } catch {
        /* já rodando */
      }
    };
    startWake();
    return () => {
      alive = false;
      recRef.current?.abort();
      recRef.current = null;
    };
  }, [wakeOn, wakeWord, send, log]);

  // atalhos: segurar Espaço fala, Esc cala
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.code === 'Space' && !typing && !e.repeat) {
        e.preventDefault();
        listen();
      }
      if (e.code === 'Escape') {
        stopSpeaking();
        setCore('idle');
      }
    };
    const up = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.code === 'Space' && !typing) stopRecording();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [listen, stopRecording, stopSpeaking]);

  useEffect(() => savePref('voice', voiceOn), [voiceOn]);
  useEffect(() => savePref('wake', wakeOn), [wakeOn]);
  useEffect(() => savePref('wakeWord', wakeWord), [wakeWord]);
  useEffect(() => savePref('city', city), [city]);

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const lastPair = messages.slice(-6);

  return (
    <div className={`hud hud-${core}`}>
      <div className="hud-grid" aria-hidden="true" />
      <div className="hud-scan" aria-hidden="true" />

      <header className="hud-top">
        <div className="hud-brand">
          <span className="hud-dot" /> J.A.R.V.I.S <small>pessoal</small>
        </div>
        <div className="hud-status">
          <span className={online ? 'ok' : online === false ? 'bad' : ''}>
            {online ? 'SISTEMA ONLINE' : online === false ? 'NÚCLEO OFFLINE' : 'CONECTANDO'}
          </span>
          <span>·</span>
          <span>{STATE_LABEL[core]}</span>
        </div>
        <div className="hud-top-actions">
          <button className={`hud-chip ${wakeOn ? 'on' : ''}`} onClick={() => setWakeOn((v) => !v)} disabled={!SRCtor} title={SRCtor ? 'Ficar ouvindo a palavra de ativação' : 'Requer Chrome ou Edge'}>
            {wakeOn ? <Ear size={14} /> : <EarOff size={14} />} Ativação
          </button>
          <button className={`hud-chip ${voiceOn ? 'on' : ''}`} onClick={() => { setVoiceOn((v) => !v); stopSpeaking(); }}>
            {voiceOn ? <Volume2 size={14} /> : <VolumeX size={14} />} Voz
          </button>
          <button className="hud-chip" onClick={() => navigate('/')}>
            <MessageSquare size={14} /> Chat completo
          </button>
        </div>
      </header>

      <section className="hud-left">
        <div className="hud-card">
          <div className="hud-card-title">Relógio</div>
          <div className="hud-clock">{now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}<small>{String(now.getSeconds()).padStart(2, '0')}</small></div>
          <div className="hud-sub">{now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>

        <div className="hud-card">
          <div className="hud-card-title">
            Clima ·{' '}
            <input
              className="hud-inline"
              defaultValue={city}
              onBlur={(e) => e.target.value.trim() && setCity(e.target.value.trim())}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label="Cidade"
            />
          </div>
          {weather ? (
            <>
              <div className="hud-big">{weather.temp}°<small> sensação {weather.feels}°</small></div>
              <div className="hud-sub">{weather.desc} · {weather.min}°/{weather.max}° · chuva {weather.rain}%</div>
            </>
          ) : (
            <div className="hud-sub">sem dados</div>
          )}
        </div>

        <div className="hud-card">
          <div className="hud-card-title">Núcleo</div>
          <dl className="hud-kv">
            <dt>Modelo</dt><dd>{selectedModel || '—'}</dd>
            <dt>Motor</dt><dd>{serverInfo?.engine ?? '—'}</dd>
            <dt>Agente</dt><dd>{serverInfo?.agent ?? '—'}</dd>
            <dt>Ouvido</dt><dd>{backendStt ? 'Whisper local' : SRCtor ? 'navegador' : 'indisponível'}</dd>
            <dt>Voz</dt><dd>{backendTts ? 'Kokoro local' : 'navegador'}</dd>
            <dt>Latência</dt><dd>{lastLatency ? `${(lastLatency / 1000).toFixed(1)} s` : '—'}</dd>
          </dl>
        </div>
      </section>

      <section className="hud-center">
        <canvas ref={canvasRef} className="hud-core" onClick={listen} aria-label="Núcleo: clique para falar" />
        <div className="hud-caption" aria-live="polite">
          {interim ? <span className="hud-interim">{interim}</span> : caption || `${greeting}. Como posso ajudar?`}
        </div>
      </section>

      <section className="hud-right">
        <div className="hud-card hud-convo">
          <div className="hud-card-title">Conversa</div>
          {lastPair.length === 0 && <div className="hud-sub">Diga "{wakeWord}, ..." ou segure Espaço.</div>}
          {lastPair.map((m, i) => (
            <div key={i} className={`hud-line ${m.role}`}>
              <span>{m.role === 'user' ? 'VOCÊ' : 'JARVIS'}</span>
              {m.content || '…'}
            </div>
          ))}
        </div>
        <div className="hud-card hud-ticker">
          <div className="hud-card-title">Registro</div>
          {ticker.map((it) => (
            <div key={it.id} className="hud-tick">
              <time>{it.time}</time> {it.text}
            </div>
          ))}
        </div>
      </section>

      <footer className="hud-bottom">
        <div className="hud-spectrum-wrap">
          <span className="hud-card-title">Sinal · Espectro</span>
          <canvas ref={spectrumRef} className="hud-spectrum" />
        </div>
        <form
          className="hud-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = input;
            setInput('');
            void send(v);
          }}
        >
          <button type="button" className={`hud-mic ${core === 'listening' ? 'on' : ''}`} onClick={listen} aria-label="Falar">
            <Mic size={20} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite um comando ou segure Espaço para falar…"
            aria-label="Comando"
          />
          <button type="submit" className="hud-send" aria-label="Enviar">
            <Send size={18} />
          </button>
        </form>
        <div className="hud-wake">
          ativação:
          <input className="hud-inline" value={wakeWord} onChange={(e) => setWakeWord(e.target.value)} aria-label="Palavra de ativação" />
        </div>
      </footer>
    </div>
  );
}
