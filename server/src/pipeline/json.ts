/**
 * Extract a JSON value from an LLM response that may wrap it in prose, markdown
 * fences, or <think> blocks. Providers vary in how strictly they honor
 * structured-output mode, so we parse defensively.
 */
export function extractJson<T = unknown>(raw: string): T {
  let text = raw.trim();

  // Strip reasoning/think blocks some models emit.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Strip ```json ... ``` or ``` ... ``` fences.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  // Try a direct parse first.
  try {
    return JSON.parse(text) as T;
  } catch {
    // Fall through to bracket extraction.
  }

  // Grab the outermost {...} or [...] span.
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  const start =
    objStart === -1
      ? arrStart
      : arrStart === -1
        ? objStart
        : Math.min(objStart, arrStart);
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);

  if (start !== -1 && end > start) {
    const candidate = text.slice(start, end + 1);
    return JSON.parse(candidate) as T;
  }

  throw new Error("No JSON object found in LLM response");
}
