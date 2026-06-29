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
  health: () => request<HealthStatus>("/api/health"),
  latestDay: () => request<DayContent>("/api/day/latest"),
  personas: () => request<PersonaDef[]>("/api/personas"),
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
  history: () => request<HistoryDaySummary[]>("/api/history"),
  historyDay: (date: string) => request<DayContent>(`/api/history/${date}`),
};
