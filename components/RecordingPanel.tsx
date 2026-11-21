"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GAP_SECONDS, ImportError, addPoint, clearActiveRecording, createRecording, gapsOf, importTrack, markPageHidden, pauseRecording,
  recordingToGeoJson, recordingToGpx, recoverActiveRecording, resumeRecording, saveActiveRecording, stopRecording, type Recording,
} from "@/lib/free-recording";

/**
 * Independent GPS recording: it needs no destination and no navigation, and it keeps its own location watch. It records only
 * while the page is open and visible: iOS suspends a web page in the background, and the track then shows a gap instead of a
 * line drawn across missing data.
 */
type View = { state: Recording["state"]; points: number; gaps: number; gapSeconds: number; source: Recording["source"]; lastAccuracy: number | null };
const SAVE_EVERY_MS = 10_000;

export function useFreeRecording() {
  const recRef = useRef<Recording | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastSaveRef = useRef(0);
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recoverable, setRecoverable] = useState(false);

  const storage = () => { try { return window.localStorage; } catch { return null; } };
  const refresh = useCallback((accuracy?: number | null) => {
    const rec = recRef.current;
    if (!rec) { setView(null); return; }
    const gaps = gapsOf(rec);
    setView((previous) => ({
      state: rec.state, points: rec.points.length, gaps: gaps.length, gapSeconds: gaps.reduce((sum, gap) => sum + gap.seconds, 0),
      source: rec.source, lastAccuracy: accuracy !== undefined ? accuracy : previous?.lastAccuracy ?? null,
    }));
  }, []);
  const save = useCallback((force = false) => {
    const rec = recRef.current;
    const store = storage();
    if (!rec || !store || rec.source !== "device") return;
    if (!force && Date.now() - lastSaveRef.current < SAVE_EVERY_MS) return;
    lastSaveRef.current = Date.now();
    if (!saveActiveRecording(store, rec)) setMessage("Il telefono non ha spazio per salvare la registrazione: esportala appena puoi.");
  }, []);
  const disarm = useCallback(() => {
    if (watchRef.current !== null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
  }, []);
  const arm = useCallback(() => {
    disarm();
    if (!navigator.geolocation) { setMessage("Il GPS non è disponibile su questo dispositivo."); return; }
    watchRef.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        const rec = recRef.current;
        if (!rec) return;
        addPoint(rec, { at: timestamp, lon: coords.longitude, lat: coords.latitude, accuracy: coords.accuracy, heading: coords.heading, speed: coords.speed });
        refresh(coords.accuracy);
        save();
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          const rec = recRef.current;
          if (rec) pauseRecording(rec, Date.now());
          disarm();
          setMessage("Permesso di posizione negato. Attivalo nelle impostazioni del browser e riprendi.");
          refresh();
          save(true);
        }
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 20_000 },
    );
  }, [disarm, refresh, save]);

  const start = useCallback(() => {
    const store = storage();
    if (store) clearActiveRecording(store);
    recRef.current = createRecording(crypto.randomUUID(), Date.now());
    setMessage(null); setRecoverable(false);
    arm(); refresh(null); save(true);
  }, [arm, refresh, save]);
  const pause = useCallback(() => {
    const rec = recRef.current; if (!rec) return;
    pauseRecording(rec, Date.now()); disarm(); refresh(); save(true);
  }, [disarm, refresh, save]);
  const resume = useCallback(() => {
    const rec = recRef.current; if (!rec) return;
    resumeRecording(rec); setMessage(null); arm(); refresh(); save(true);
  }, [arm, refresh, save]);
  const stop = useCallback(() => {
    const rec = recRef.current; if (!rec) return;
    stopRecording(rec); disarm(); refresh(); save(true);
  }, [disarm, refresh, save]);
  const discard = useCallback(() => {
    disarm(); recRef.current = null;
    const store = storage(); if (store) clearActiveRecording(store);
    setView(null); setMessage(null); setRecoverable(false);
  }, [disarm]);

  const download = useCallback(async (format: "gpx" | "geojson") => {
    const rec = recRef.current;
    if (!rec || rec.points.length < 2) { setMessage("Servono almeno due punti per esportare."); return; }
    const stamp = new Date(rec.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const name = `lastrico-registrazione-${stamp}.${format === "gpx" ? "gpx" : "geojson"}`;
    const file = format === "gpx"
      ? new File([recordingToGpx(rec)], name, { type: "application/gpx+xml" })
      : new File([JSON.stringify(recordingToGeoJson(rec))], name, { type: "application/geo+json" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Registrazione GPS Lastrico" }); return; } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);
  const importFile = useCallback(async (file: File) => {
    try {
      const imported = importTrack(await file.text(), crypto.randomUUID(), Date.now());
      disarm();
      recRef.current = imported;
      setMessage(`Traccia importata: ${imported.points.length} punti.`); setRecoverable(false);
      refresh(null);
    } catch (error) {
      setMessage(error instanceof ImportError ? `Non riesco a leggere il file: ${error.message}.` : "Non riesco a leggere il file.");
    }
  }, [disarm, refresh]);

  // A recording left behind by a closed or suspended page is offered back, paused, never resumed silently.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      const store = storage();
      const found = store ? recoverActiveRecording(store, Date.now()) : null;
      if (cancelled || !found || recRef.current) return;
      recRef.current = found;
      setRecoverable(found.state !== "stopped");
      refresh(null);
    });
    return () => { cancelled = true; };
  }, [refresh]);

  // Hidden page: no fixes can arrive, so the gap is named; visible again: the watch is renewed (iOS can silently end it).
  useEffect(() => {
    const onVisibility = () => {
      const rec = recRef.current;
      if (!rec) return;
      if (document.visibilityState === "hidden") { markPageHidden(rec, Date.now()); save(true); }
      else if (rec.state === "recording") { arm(); refresh(); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, [arm, refresh, save]);

  return { view, message, recoverable, start, pause, resume, stop, discard, download, importFile };
}

export type FreeRecording = ReturnType<typeof useFreeRecording>;

function minutes(seconds: number) { return seconds >= 120 ? `${Math.round(seconds / 60)} min` : `${seconds} s`; }

export function RecordingPanel({ recording }: { recording: FreeRecording }) {
  const { view, message, recoverable } = recording;
  const label = !view ? "Nessuna registrazione"
    : view.source !== "device" ? "Traccia importata"
      : view.state === "recording" ? "Registrazione in corso" : view.state === "paused" ? "In pausa" : "Registrazione terminata";
  return (
    <div className="preference-group recording-panel" data-testid="recording-panel">
      <span className="preference-label">Registra un percorso</span>
      <small>Registra la tua traccia GPS senza scegliere una destinazione. Funziona solo con la pagina aperta e lo schermo acceso: se iPhone sospende la pagina, il buco resta segnato e non viene unito con una linea.</small>
      <div className="recording-status" role="status" data-testid="recording-status">
        <b>{label}</b>
        {view ? <span> · {view.points} punti{view.gaps > 0 ? ` · ${view.gaps} ${view.gaps === 1 ? "buco" : "buchi"} (${minutes(view.gapSeconds)} senza dati, oltre ${GAP_SECONDS} s)` : ""}{view.lastAccuracy !== null && view.state === "recording" ? ` · ±${Math.round(view.lastAccuracy)} m` : ""}</span> : null}
      </div>
      {recoverable ? <small data-testid="recording-recovered">Ho ritrovato una registrazione interrotta. Il tempo da quando l’app si è fermata è segnato come buco: riprendila o terminala.</small> : null}
      <div className="segmented recording-actions" role="group" aria-label="Registrazione GPS">
        {!view || view.source !== "device" || view.state === "stopped"
          ? <button type="button" onClick={recording.start} data-testid="recording-start">Avvia</button> : null}
        {view?.state === "recording" && view.source === "device" ? <button type="button" onClick={recording.pause} data-testid="recording-pause">Pausa</button> : null}
        {view?.state === "paused" && view.source === "device" ? <button type="button" onClick={recording.resume} data-testid="recording-resume">Riprendi</button> : null}
        {view && view.source === "device" && view.state !== "stopped" ? <button type="button" onClick={recording.stop} data-testid="recording-stop">Termina</button> : null}
      </div>
      {view && view.points >= 2 ? (
        <div className="segmented recording-export" role="group" aria-label="Esporta la registrazione">
          <button type="button" onClick={() => void recording.download("gpx")} data-testid="recording-export-gpx">Esporta GPX</button>
          <button type="button" onClick={() => void recording.download("geojson")} data-testid="recording-export-geojson">Esporta GeoJSON</button>
          <button type="button" onClick={recording.discard} data-testid="recording-discard">Elimina</button>
        </div>
      ) : null}
      <label className="recording-import">
        <span>Importa una traccia (GPX con orari o GeoJSON)</span>
        <input
          type="file"
          accept=".gpx,.geojson,.json,application/gpx+xml,application/geo+json,application/json"
          data-testid="recording-import"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void recording.importFile(file); event.target.value = ""; }}
        />
      </label>
      {message ? <small role="alert" data-testid="recording-message">{message}</small> : null}
    </div>
  );
}
