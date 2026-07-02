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
    request<HealthStatus>("/api/health", { signal }),
  latestDay: (signal?: AbortSignal) =>
    request<DayContent>("/api/day/latest", { signal }),
  refreshLatestDay: () =>
    request<DayContent>("/api/day/latest/refresh", { method: "POST" }),
  revealLatestRoomRead: () =>
    request<DayContent>("/api/day/latest/room-read", { method: "POST" }),
  retryLatestRoomReadPersona: (id: PersonaId, signal: AbortSignal) =>
    request<DayContent>(`/api/day/latest/room-read/personas/${id}/retry`, {
      method: "POST",
      signal,
    }),
  personas: (signal?: AbortSignal) =>
    request<PersonaDef[]>("/api/personas", { signal }),
  retryLatestPersona: (id: PersonaId, signal: AbortSignal) =>
    request<DayContent>(`/api/day/latest/personas/${id}/retry`, {
      method: "POST",
      signal,
    }),
  startMyLensAnalysis: (articles: MyLensArticleInput[]) =>
    request<MyLensJobCreated>("/api/my-lens/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articles }),
    }),
  myLensJob: (jobId: string) =>
    request<MyLensJobStatus>(`/api/my-lens/jobs/${jobId}`),
  history: (signal?: AbortSignal) =>
    request<HistoryDaySummary[]>("/api/history", { signal }),
  historyDay: (date: string, generatedAt?: string) =>
    request<DayContent>(
      `/api/history/${date}${generatedAt ? `?generatedAt=${encodeURIComponent(generatedAt)}` : ""}`,
    ),
};
