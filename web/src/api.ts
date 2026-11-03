import type {
  DayContent,
  HealthStatus,
  HistoryDaySummary,
  MyLensArticleInput,
  MyLensJobCreated,
  MyLensJobStatus,
  PersonaDef,
  PersonaId,
} from "@prism/shared";
import sampleDayJson from "../../server/data/sample-day.json";
import { PERSONA_LIST } from "../../server/src/domain/personas";

const staticDemo = import.meta.env.VITE_STATIC_DEMO === "true";
const sampleDay = sampleDayJson as unknown as DayContent;
const sampleHealth: HealthStatus = {
  ok: true,
  mode: "sample",
  hasLlmKey: false,
  hasMarketKey: false,
  model: "static GitHub Pages preview",
};
const sampleHistory: HistoryDaySummary[] = [
  {
    date: sampleDay.date,
    briefings: [
      {
        generatedAt: sampleDay.generatedAt,
        keyPointCount: sampleDay.keyPoints.length,
        personaCount: sampleDay.povs.length,
        leadSummary: sampleDay.keyPoints[0]?.summary ?? "Sample market brief",
      },
    ],
  },
];

function staticPreviewUnavailable(): Promise<never> {
  return Promise.reject(
    new Error("This action requires the local Prism API; the public preview is read-only."),
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `${path} -> HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: (signal?: AbortSignal) =>
    staticDemo
      ? Promise.resolve(sampleHealth)
      : request<HealthStatus>("/api/health", { signal }),
  latestDay: (signal?: AbortSignal) =>
    staticDemo
      ? Promise.resolve(sampleDay)
      : request<DayContent>("/api/day/latest", { signal }),
  refreshLatestDay: () =>
    staticDemo
      ? Promise.resolve(sampleDay)
      : request<DayContent>("/api/day/latest/refresh", { method: "POST" }),
  revealLatestRoomRead: () =>
    staticDemo
      ? staticPreviewUnavailable()
      : request<DayContent>("/api/day/latest/room-read", { method: "POST" }),
  retryLatestRoomReadPersona: (id: PersonaId, signal: AbortSignal) =>
    staticDemo
      ? Promise.resolve(sampleDay)
      : request<DayContent>(`/api/day/latest/room-read/personas/${id}/retry`, {
          method: "POST",
          signal,
        }),
  personas: (signal?: AbortSignal) =>
    staticDemo
      ? Promise.resolve(PERSONA_LIST)
      : request<PersonaDef[]>("/api/personas", { signal }),
  retryLatestPersona: (id: PersonaId, signal: AbortSignal) =>
    staticDemo
      ? Promise.resolve(sampleDay)
      : request<DayContent>(`/api/day/latest/personas/${id}/retry`, {
          method: "POST",
          signal,
        }),
  startMyLensAnalysis: (articles: MyLensArticleInput[]) =>
    staticDemo
      ? staticPreviewUnavailable()
      : request<MyLensJobCreated>("/api/my-lens/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articles }),
        }),
  myLensJob: (jobId: string) =>
    staticDemo
      ? staticPreviewUnavailable()
      : request<MyLensJobStatus>(`/api/my-lens/jobs/${jobId}`),
  history: (signal?: AbortSignal) =>
    staticDemo
      ? Promise.resolve(sampleHistory)
      : request<HistoryDaySummary[]>("/api/history", { signal }),
  historyDay: (date: string, generatedAt?: string) =>
    staticDemo
      ? date === sampleDay.date
        ? Promise.resolve(sampleDay)
        : Promise.reject(new Error("That brief is not part of the static preview."))
      : request<DayContent>(
          `/api/history/${date}${generatedAt ? `?generatedAt=${encodeURIComponent(generatedAt)}` : ""}`,
        ),
};
