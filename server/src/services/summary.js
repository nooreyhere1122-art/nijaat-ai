import { config } from '../config.js';

export const SECTION_KEYS = [
  'demographics', 'primaryDiagnoses', 'secondaryConditions', 'medications',
  'allergies', 'testResults', 'surgicalHistory', 'recommendations',
];

const PROMPT = `You are a clinical documentation assistant. Read the attached medical report and extract its content.
Return ONLY a JSON object with exactly these keys, each an array (use an empty array when the report has nothing for it):
${SECTION_KEYS.join(', ')}.
Each array item is an object: {"text": string, "urgency": "red" | "amber" | "green", "confidence": number between 0 and 1}.
Rules:
- "text" is one short factual statement copied or summarised from the report. Do not add advice of your own.
- urgency "red": critical allergies, severe or life-threatening conditions, critically abnormal results.
- urgency "amber": ongoing treatment, chronic conditions being managed, mildly abnormal results.
- urgency "green": normal findings and routine information.
- "confidence" is how certain you are that the text is legible and correctly extracted.
- testResults: include the value, unit and reference range when present; list abnormal values first.
- Never invent information that is not in the report.`;

let override = null;
export const setSummaryOverride = (fn) => { override = fn; };

export class SummaryUnavailable extends Error {}

function normalise(raw) {
  const sections = {};
  for (const key of SECTION_KEYS) {
    const list = Array.isArray(raw?.[key]) ? raw[key] : [];
    sections[key] = list
      .filter((item) => item && typeof item.text === 'string' && item.text.trim())
      .slice(0, 60)
      .map((item) => ({
        text: item.text.trim().slice(0, 600),
        urgency: ['red', 'amber', 'green'].includes(item.urgency) ? item.urgency : 'green',
        confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
        note: '',
      }));
  }
  return sections;
}

/** FR-21, FR-22, FR-25: structured, colour coded summary with a confidence score per item. */
export async function summariseReport({ buffer, mime }) {
  if (override) return normalise(await override({ buffer, mime }));
  if (!config.gemini.key) throw new SummaryUnavailable('The summarisation service is not configured (GEMINI_API_KEY is missing).');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: buffer.toString('base64') } }, { text: PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new SummaryUnavailable('The summarisation service could not be reached.');
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new SummaryUnavailable(`The summarisation service returned an error (${res.status}${detail?.error?.status ? ` ${detail.error.status}` : ''}).`);
  }
  const json = await res.json();
  const textOut = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let parsed;
  try { parsed = JSON.parse(textOut.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch {
    throw new SummaryUnavailable('The summarisation service returned an unreadable answer.');
  }
  const sections = normalise(parsed);
  if (!SECTION_KEYS.some((k) => sections[k].length)) throw new SummaryUnavailable('No medical content could be read from this file.');
  return sections;
}
