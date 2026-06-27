import type {
  DayContent,
  HealthStatus,
  PersonaDef,
  PersonaId,
  TimeMachineEvent,
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
  timeMachineCatalog: () => request<TimeMachineEvent[]>("/api/timemachine"),
  timeMachineDay: (id: string) => request<DayContent>(`/api/timemachine/${id}`),
};
