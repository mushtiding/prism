import type {
  DayContent,
  HealthStatus,
  PersonaDef,
  TimeMachineEvent,
} from "@prism/shared";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  health: () => get<HealthStatus>("/api/health"),
  latestDay: () => get<DayContent>("/api/day/latest"),
  personas: () => get<PersonaDef[]>("/api/personas"),
  timeMachineCatalog: () => get<TimeMachineEvent[]>("/api/timemachine"),
  timeMachineDay: (id: string) => get<DayContent>(`/api/timemachine/${id}`),
};
