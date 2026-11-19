"use client";

import { useEffect, useState } from "react";

/**
 * Live traffic in the planner: the optional switch, and the honest note under the route cards. Everything shown comes
 * from the route response: when the provider did not answer, the note says so and the times are the ones without traffic.
 */
export type TrafficIncidentInfo = {
  category: string;
  magnitude: number;
  delaySeconds: number | null;
  description: string;
  lengthMeters: number | null;
};

export type RouteTrafficInfo = {
  freeMinutes: number;
  delaySeconds: number;
  coveragePercent: number;
  slowestSpeedPercent: number | null;
  congestedMeters: number;
  closedMeters: number;
  delayShare: number;
  incidents: TrafficIncidentInfo[];
};

export type TrafficInfo =
  | { status: "live"; provider: string; mode: string; delayShare: number | null; fetchedAt: string | null; ageSeconds: number | null; savedVsStandardSeconds: number; note: string }
  | { status: "unavailable"; provider: string; reason: string };

type StatusAnswer = { configured: boolean; available: boolean; reason: string };
let statusProbe: { at: number; promise: Promise<StatusAnswer | null> } | null = null;

/** Whether live traffic can be offered now, asked once a minute at most. `null` while unknown. */
export function useTrafficStatus(enabled: boolean) {
  const [status, setStatus] = useState<StatusAnswer | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    if (!statusProbe || Date.now() - statusProbe.at > 60_000) {
      statusProbe = {
        at: Date.now(),
        promise: fetch("/api/traffic/status").then((r) => (r.ok ? (r.json() as Promise<StatusAnswer>) : null)).catch(() => null),
      };
    }
    let cancelled = false;
    void statusProbe.promise.then((value) => { if (!cancelled) setStatus(value); });
    return () => { cancelled = true; };
  }, [enabled]);
  return status;
}

export function trafficUnavailableText(reason: string) {
  switch (reason) {
    case "no-key":
    case "no-binding":
      return "Il traffico live non è attivo in questa versione.";
    case "quota-daily":
    case "quota-overlay":
      return "La quota gratuita giornaliera del traffico è esaurita: riprova domani.";
    case "quota-monthly":
      return "La quota gratuita mensile del traffico è esaurita.";
    case "calculation-cap":
      return "Il tragitto è troppo lungo per il traffico live.";
    default:
      return "Il servizio di traffico non risponde in questo momento.";
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  accident: "Incidente",
  jam: "Coda",
  "road-closed": "Strada chiusa",
  "lane-closed": "Corsia chiusa",
  "road-works": "Lavori",
  danger: "Pericolo",
  weather: "Condizioni meteo",
  "broken-down": "Veicolo in panne",
  unknown: "Segnalazione",
};

/** The current time, refreshed every 30 s, so a note about old data ages on screen without a new calculation. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const minutesText = (minutes: number) => `${Math.max(1, Math.round(minutes))} min`;

/** The line under the route cards. Renders nothing when traffic was not requested. */
export function TrafficNotice({ requested, info, route, mode }: {
  requested: boolean;
  info: TrafficInfo | null;
  route: { minutes: number; traffic?: RouteTrafficInfo } | null;
  mode: "car" | "motorcycle" | "bicycle";
}) {
  const now = useNow();
  if (!requested) return null;
  if (!info) return null;
  if (info.status === "unavailable") {
    return (
      <div className="plan-alert info" role="status" data-testid="traffic-unavailable">
        <p>{trafficUnavailableText(info.reason)} I tempi mostrati sono senza traffico.</p>
      </div>
    );
  }
  const traffic = route?.traffic;
  const ageMinutes = info.fetchedAt ? Math.max(0, Math.round((now - new Date(info.fetchedAt).getTime()) / 60_000)) : null;
  const partial = traffic !== undefined && traffic.coveragePercent < 90;
  return (
    <div className="traffic-notice" role="status" data-testid="traffic-notice">
      <strong>
        Traffico live · {info.provider}{info.fetchedAt ? ` · aggiornato alle ${clock(info.fetchedAt)}` : ""}
      </strong>
      {ageMinutes !== null && ageMinutes >= 10 && <span className="traffic-stale">Dato di {ageMinutes} min fa: ricalcola per aggiornarlo.</span>}
      {traffic && mode !== "bicycle" && (
        <span data-testid="traffic-eta">
          {traffic.delaySeconds >= 30
            ? `${minutesText(route!.minutes)} con il traffico (${minutesText(traffic.freeMinutes)} senza): +${minutesText(traffic.delaySeconds / 60)}.`
            : `${minutesText(route!.minutes)}: nessun ritardo rilevante sul percorso.`}
          {partial ? ` Dati sul ${Math.round(traffic.coveragePercent)}% del percorso: è una stima.` : ""}
          {mode === "motorcycle" && traffic.delaySeconds >= 30 ? " Per la moto è contata metà del ritardo." : ""}
        </span>
      )}
      {traffic && mode === "bicycle" && <span>{info.note}</span>}
      {mode !== "bicycle" && info.savedVsStandardSeconds >= 60 && (
        <span data-testid="traffic-saving">Con il traffico di ora risparmi {minutesText(info.savedVsStandardSeconds / 60)} rispetto al percorso standard.</span>
      )}
      {traffic && traffic.closedMeters > 0 && <span className="traffic-warning">Un tratto è segnalato chiuso dal provider ({Math.round(traffic.closedMeters)} m): verifica sul posto.</span>}
      {traffic && traffic.incidents.length > 0 && (
        <ul className="traffic-incidents" data-testid="traffic-incidents">
          {traffic.incidents.slice(0, 4).map((incident, index) => (
            <li key={`${incident.category}-${index}`}>
              {CATEGORY_LABEL[incident.category] ?? "Segnalazione"}
              {incident.delaySeconds ? ` · +${minutesText(incident.delaySeconds / 60)}` : ""}
              {incident.description ? ` · ${incident.description}` : ""}
            </li>
          ))}
        </ul>
      )}
      {traffic && traffic.coveragePercent === 0 && <span>Nessun dato di traffico su questo percorso: il tempo è quello senza traffico.</span>}
    </div>
  );
}
