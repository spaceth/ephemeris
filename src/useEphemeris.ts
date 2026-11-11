import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { coverageSpan, liveSeconds, segmentAtTime } from "./core";
import type { OemFile } from "./core";
import type { ArcBuffer, WorkerResponse } from "./session";
import type { SceneClock } from "./view/types";

const MAX_BYTES = 50 * 1024 * 1024;

export const EXAMPLES = [
  { id: "EM2", label: "EM-2", path: "/sample/EM2.oem", fileName: "EM2.oem" },
  { id: "ISS", label: "ISS", path: "/sample/ISS.OEM_J2K_EPH.txt", fileName: "ISS.OEM_J2K_EPH.txt" },
  { id: "DART", label: "DART", path: "/sample/dart_2021_328_2022_091_rec_v01.oem", fileName: "dart_2021_328_2022_091_rec_v01.oem" },
  { id: "CE7", label: "CE7", path: "/sample/CE7_Trajectory_2027.oem", fileName: "CE7_Trajectory_2027.oem" },
  { id: "LRO", label: "LRO", path: "/sample/lrorg_2009169_2010001_v01.oem", fileName: "lrorg_2009169_2010001_v01.oem" },
] as const;

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsText(file);
  });
}

export function useEphemeris() {
  const workerRef = useRef<Worker | null>(null);
  const parseId = useRef(0);
  const fileRef = useRef<OemFile | null>(null);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const clockRef = useRef<SceneClock>({ file: null, t: 0, segment: 0 });
  const dragDepth = useRef(0);

  const [file, setFile] = useState<OemFile | null>(null);
  const [arcs, setArcs] = useState<ArcBuffer[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [t, setT] = useState(0);
  const [segment, setSegment] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [resetToken, setResetToken] = useState(0);
  const [webgl] = useState(webglAvailable);
  const [dragOver, setDragOver] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const span = file ? coverageSpan(file) : null;

  fileRef.current = file;
  speedRef.current = speed;
  clockRef.current.file = file;
  clockRef.current.segment = segment;
  if (!playingRef.current) clockRef.current.t = t;

  const syncSegment = useCallback((at: number) => {
    const current = fileRef.current;
    if (!current) return;
    const next = segmentAtTime(current, at, clockRef.current.segment);
    if (next === clockRef.current.segment) return;
    clockRef.current.segment = next;
    setSegment(next);
  }, []);

  const seek = useCallback((next: number) => {
    const coverage = fileRef.current ? coverageSpan(fileRef.current) : null;
    const value = coverage ? Math.min(coverage.stop, Math.max(coverage.start, next)) : next;
    clockRef.current.t = value;
    syncSegment(value);
    setT(value);
  }, [syncSegment]);

  const nudge = useCallback((seconds: number) => {
    seek(clockRef.current.t + seconds);
  }, [seek]);

  const togglePlay = useCallback(() => {
    if (!fileRef.current || !coverageSpan(fileRef.current)) return;
    if (playingRef.current) {
      playingRef.current = false;
      setT(clockRef.current.t);
      setPlaying(false);
      return;
    }
    const coverage = coverageSpan(fileRef.current);
    if (coverage && clockRef.current.t >= coverage.stop) {
      clockRef.current.t = coverage.start;
      setT(coverage.start);
    }
    playingRef.current = true;
    setPlaying(true);
  }, []);

  const closeFile = useCallback(() => {
    parseId.current += 1;
    playingRef.current = false;
    clockRef.current.file = null;
    clockRef.current.t = 0;
    clockRef.current.segment = 0;
    setPlaying(false);
    setFile(null);
    setArcs([]);
    setFileName("");
    setError(null);
    setLoading(false);
    setT(0);
    setSegment(0);
  }, []);

  const goLive = useCallback(() => {
    const at = fileRef.current ? liveSeconds(fileRef.current, new Date()) : null;
    if (at == null) return;
    speedRef.current = 1;
    setSpeed(1);
    seek(at);
  }, [seek]);

  const submit = useCallback((text: string, name: string) => {
    if (text.length > MAX_BYTES) {
      setLoading(false);
      setError("File is larger than 50 MB.");
      return;
    }
    if (!workerRef.current) {
      setLoading(false);
      setError("The parser is not ready. Reload the page and try again.");
      return;
    }
    const id = ++parseId.current;
    setLoading(true);
    setError(null);
    workerRef.current.postMessage({ type: "parse", id, text, name });
  }, []);

  const ingest = useCallback(async (picked: File) => {
    if (picked.size > MAX_BYTES) {
      setError("File is larger than 50 MB.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      submit(await readFile(picked), picked.name || "ephemeris.oem");
    } catch (reason) {
      setLoading(false);
      setError(reason instanceof Error ? reason.message : "Could not read that file");
    }
  }, [submit]);

  const onPick = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    await ingest(picked);
  }, [ingest]);

  const loadExample = useCallback(async (id: string) => {
    const example = EXAMPLES.find((item) => item.id === id);
    if (!example) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(example.path);
      if (!response.ok) throw new Error("The example could not be read.");
      submit(await response.text(), example.fileName);
    } catch (reason) {
      setLoading(false);
      setError(reason instanceof Error ? reason.message : "The example could not be read.");
    }
  }, [submit]);

  const onDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
  }, []);

  const onDragLeave = useCallback(() => {
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragOver(false);
    }
  }, []);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const picked = event.dataTransfer.files?.[0];
    if (picked) void ingest(picked);
  }, [ingest]);

  useEffect(() => {
    if (!file) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [file]);

  useEffect(() => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "parsed") {
        if (message.id !== parseId.current) return;
        const start = coverageSpan(message.file)?.start ?? 0;
        const nextSegment = segmentAtTime(message.file, start, 0);
        playingRef.current = false;
        clockRef.current.t = start;
        clockRef.current.segment = nextSegment;
        setLoading(false);
        setError(null);
        setFile(message.file);
        setArcs(message.arcs);
        setFileName(message.name);
        setSegment(nextSegment);
        setPlaying(false);
        setT(start);
      } else if (message.type === "parse-error") {
        if (message.id !== parseId.current) return;
        setLoading(false);
        setError(message.message);
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!file) return;
    let frame = 0;
    let last = performance.now();
    let painted = 0;
    const tick = (stamp: number) => {
      const dt = Math.min(0.1, (stamp - last) / 1000);
      last = stamp;
      const current = fileRef.current;
      const coverage = current ? coverageSpan(current) : null;
      if (playingRef.current && coverage && coverage.stop > coverage.start) {
        let next = clockRef.current.t + dt * speedRef.current;
        if (next >= coverage.stop) {
          next = coverage.stop;
          playingRef.current = false;
          setPlaying(false);
        }
        clockRef.current.t = next;
        syncSegment(next);
        if (!playingRef.current || stamp - painted > 40) {
          painted = stamp;
          setT(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [file, syncSegment]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!fileRef.current) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
        if (tag === "BUTTON" && event.key === " ") return;
      }
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const step = (event.shiftKey ? 600 : 60) * (event.key === "ArrowLeft" ? -1 : 1);
        nudge(step);
      } else if (event.key === "Home") {
        event.preventDefault();
        const coverage = fileRef.current ? coverageSpan(fileRef.current) : null;
        if (coverage) seek(coverage.start);
      } else if (event.key === "End") {
        event.preventDefault();
        const coverage = fileRef.current ? coverageSpan(fileRef.current) : null;
        if (coverage) seek(coverage.stop);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nudge, seek, togglePlay]);

  return {
    file,
    arcs,
    fileName,
    error,
    loading,
    webgl,
    dragOver,
    t,
    segment,
    playing,
    speed,
    setSpeed,
    resetToken,
    resetView: () => setResetToken((value) => value + 1),
    span,
    now,
    clockRef,
    onPick,
    loadExample,
    closeFile,
    seek,
    togglePlay,
    goLive,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}

export type EphemerisSession = ReturnType<typeof useEphemeris>;
