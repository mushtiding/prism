import { config } from "../config.js";
import { logEvent } from "../logger.js";
import {
  exportDailyEvaluationReport,
  listEvaluationDates,
} from "./reports.js";
import { flushQualityEvaluations } from "./judge.js";

function calendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousCalendarDate(now = new Date()): string {
  const previous = new Date(now);
  previous.setDate(previous.getDate() - 1);
  return calendarDate(previous);
}

function nextReportAt(now = new Date()): Date {
  const next = new Date(now);
  next.setHours(
    config.evaluationReportHour,
    config.evaluationReportMinute,
    0,
    0,
  );
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

async function exportPreviousDay(): Promise<void> {
  const date = previousCalendarDate();
  try {
    await flushQualityEvaluations();
    const result = await exportDailyEvaluationReport(date);
    logEvent(`evaluation report ready · ${date} · ${result.metricsPath}`);
  } catch (err) {
    logEvent(`evaluation report failed · ${date} · ${String(err)}`);
  }
}

async function catchUpReports(): Promise<void> {
  const today = calendarDate(new Date());
  await flushQualityEvaluations();
  for (const date of listEvaluationDates().filter((value) => value < today)) {
    try {
      await exportDailyEvaluationReport(date);
      logEvent(`evaluation report refreshed · ${date}`);
    } catch (err) {
      logEvent(`evaluation report catch-up failed · ${date} · ${String(err)}`);
    }
  }
}

export function startEvaluationReportScheduler(): void {
  void catchUpReports().catch((err) => {
    logEvent(`evaluation report catch-up unavailable · ${String(err)}`);
  });

  const schedule = () => {
    const next = nextReportAt();
    const waitMs = next.getTime() - Date.now();
    logEvent(`evaluation report scheduled · ${next.toLocaleString()}`);
    const timer = setTimeout(async () => {
      await exportPreviousDay();
      schedule();
    }, waitMs);
    timer.unref();
  };
  schedule();
}
