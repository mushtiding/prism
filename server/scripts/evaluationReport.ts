import { exportDailyEvaluationReport } from "../src/evaluation/reports.js";

function calendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return calendarDate(date);
}

const dateFlag = process.argv.indexOf("--date");
const date = dateFlag >= 0 ? process.argv[dateFlag + 1] : defaultDate();

if (!date) throw new Error("--date requires YYYY-MM-DD");

const result = await exportDailyEvaluationReport(date);
console.log(`Metrics: ${result.metricsPath}`);
console.log(`Persona details: ${result.personasPath}`);
console.log(`Attempt details: ${result.attemptsPath}`);
