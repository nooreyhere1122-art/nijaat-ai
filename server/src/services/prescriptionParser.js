// FR-39 and FR-41: turns OCR text lines into structured medication entries and
// corrects obvious misreadings of drug names against a dictionary.

export const DRUG_DICTIONARY = [
  // Common generics
  'Paracetamol', 'Ibuprofen', 'Aspirin', 'Diclofenac', 'Naproxen', 'Mefenamic Acid', 'Tramadol', 'Amoxicillin',
  'Co-Amoxiclav', 'Azithromycin', 'Clarithromycin', 'Ciprofloxacin', 'Levofloxacin', 'Moxifloxacin', 'Cefixime',
  'Ceftriaxone', 'Cephalexin', 'Doxycycline', 'Metronidazole', 'Fluconazole', 'Omeprazole', 'Esomeprazole',
  'Pantoprazole', 'Ranitidine', 'Famotidine', 'Domperidone', 'Metoclopramide', 'Ondansetron', 'Loperamide',
  'Metformin', 'Glimepiride', 'Gliclazide', 'Sitagliptin', 'Insulin', 'Amlodipine', 'Losartan', 'Valsartan',
  'Telmisartan', 'Lisinopril', 'Enalapril', 'Ramipril', 'Atenolol', 'Bisoprolol', 'Metoprolol', 'Carvedilol',
  'Furosemide', 'Spironolactone', 'Hydrochlorothiazide', 'Atorvastatin', 'Rosuvastatin', 'Simvastatin',
  'Clopidogrel', 'Warfarin', 'Rivaroxaban', 'Salbutamol', 'Montelukast', 'Prednisolone', 'Dexamethasone',
  'Hydrocortisone', 'Cetirizine', 'Loratadine', 'Fexofenadine', 'Chlorpheniramine', 'Levothyroxine',
  'Carbimazole', 'Alprazolam', 'Diazepam', 'Bromazepam', 'Sertraline', 'Escitalopram', 'Fluoxetine',
  'Amitriptyline', 'Gabapentin', 'Pregabalin', 'Carbamazepine', 'Sodium Valproate', 'Levetiracetam',
  'Folic Acid', 'Ferrous Sulfate', 'Calcium Carbonate', 'Vitamin D3', 'Vitamin B12', 'Multivitamin',
  'Hyoscine', 'Drotaverine', 'Dimenhydrinate', 'Betahistine', 'Tamsulosin', 'Allopurinol', 'Colchicine',
  // Brands widely dispensed in Pakistan
  'Panadol', 'Calpol', 'Brufen', 'Disprin', 'Ponstan', 'Voltral', 'Voren', 'Synflex', 'Nuberol', 'Tramal',
  'Augmentin', 'Amoxil', 'Zithromax', 'Azomax', 'Klaricid', 'Ciproxin', 'Novidat', 'Leflox', 'Cefspan',
  'Rocephin', 'Vibramycin', 'Flagyl', 'Septran', 'Risek', 'Nexum', 'Zantac', 'Motilium', 'Maxolon',
  'Gravinate', 'Imodium', 'Glucophage', 'Getryl', 'Amaryl', 'Diamicron', 'Januvia', 'Norvasc', 'Cozaar',
  'Diovan', 'Zestril', 'Tenormin', 'Concor', 'Lasix', 'Aldactone', 'Lipiget', 'Lipitor', 'Rovista',
  'Ascard', 'Loprin', 'Lowplat', 'Plavix', 'Ventolin', 'Montiget', 'Singulair', 'Deltacortril', 'Decadron',
  'Zyrtec', 'Rigix', 'Softin', 'Telfast', 'Avil', 'Arinac', 'Thyroxine', 'Neo-Mercazole', 'Xanax',
  'Valium', 'Lexotanil', 'Zoloft', 'Cipralex', 'Neurontin', 'Gabica', 'Lyrica', 'Tegral', 'Epival',
  'Neurobion', 'Sangobion', 'Cac-1000', 'Surbex Z', 'Buscopan', 'No-Spa', 'Serc', 'Zyloric',
];

const FORM = /^(tab(?:let)?s?|cap(?:sule)?s?|syp|syr(?:up)?|inj(?:ection)?|susp(?:ension)?|drops?|cream|oint(?:ment)?|gel|inhaler|sachet|supp(?:ository)?)\b\.?\s*/i;
const DOSAGE = /(\d+(?:\.\d+)?)\s?(mg|mcg|µg|g|gm|ml|iu|units?|%)(?:\s?\/\s?\d+(?:\.\d+)?\s?(?:mg|ml))?/i;
const DURATION = /(?:for|x|×)?\s*(\d+)\s*(days?|weeks?|wks?|months?|d|\/7|\/52|\/12)\b/i;
const HEADER = /\b(dr\.?|doctor|clinic|hospital|medical cent(?:re|er)|mbbs|fcps|mrcp|frcs|consultant|physician|surgeon|reg(?:istration)?\.?\s*no|pmdc|pmc|ph(?:one)?[:.]|tel[:.]|cell[:.]|mob(?:ile)?[:.]|address|road|street|patient|name[:.]|age[:.]|sex[:.]|gender|date[:.]|rx|signature|timing|weight|bp[:.]|diagnosis)\b/i;
const DATE_ONLY = /^\W*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\W*$/;

const FREQUENCIES = [
  [/\b(?:1\s*[+\-]\s*0\s*[+\-]\s*1|b\.?d\.?|b\.?i\.?d\.?|twice\s+(?:a\s+)?da(?:il)?y|2\s*times?\s+(?:a\s+)?day)\b/i, 'Twice daily'],
  [/\b(?:1\s*[+\-]\s*1\s*[+\-]\s*1|t\.?d\.?s\.?|t\.?i\.?d\.?|thrice\s+(?:a\s+)?da(?:il)?y|three\s+times\s+(?:a\s+)?day|3\s*times?\s+(?:a\s+)?day)\b/i, 'Three times daily'],
  [/\b(?:q\.?i\.?d\.?|q\.?d\.?s\.?|four\s+times\s+(?:a\s+)?day|4\s*times?\s+(?:a\s+)?day)\b/i, 'Four times daily'],
  [/\b(?:0\s*[+\-]\s*0\s*[+\-]\s*1|h\.?s\.?|at\s+night|at\s+bed\s?time|nocte)\b/i, 'At night'],
  [/\b(?:1\s*[+\-]\s*0\s*[+\-]\s*0|mane|in\s+the\s+morning|every\s+morning)\b/i, 'In the morning'],
  [/\b(?:o\.?d\.?|q\.?d\.?|once\s+(?:a\s+)?da(?:il)?y|1\s*time\s+(?:a\s+)?day|daily)\b/i, 'Once daily'],
  [/\b(?:s\.?o\.?s\.?|p\.?r\.?n\.?|when\s+(?:required|needed)|as\s+needed)\b/i, 'When needed'],
  [/\bevery\s+(\d+)\s*(?:hours?|hrs?|h)\b/i, (m) => `Every ${m[1]} hours`],
  [/\b(?:weekly|once\s+(?:a\s+)?week)\b/i, 'Once a week'],
];

const DURATION_UNITS = { d: 'day', day: 'day', days: 'day', '/7': 'day', week: 'week', weeks: 'week', wk: 'week', wks: 'week', '/52': 'week', month: 'month', months: 'month', '/12': 'month' };

function levenshtein(a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Nearest dictionary entry, accepted only when the difference is small relative to the name length. */
export function autocorrect(name) {
  const key = canon(name);
  if (key.length < 3) return { name, matched: false, corrected: false };
  let best = null; let bestDist = Infinity;
  for (const entry of DRUG_DICTIONARY) {
    const dist = levenshtein(key, canon(entry));
    if (dist < bestDist) { best = entry; bestDist = dist; }
    if (dist === 0) break;
  }
  const allowed = key.length <= 5 ? 1 : key.length <= 9 ? 2 : 3;
  if (bestDist === 0) return { name: best, matched: true, corrected: false };
  if (bestDist <= allowed) return { name: best, matched: true, corrected: true };
  return { name, matched: false, corrected: false };
}

function parseLine(raw) {
  let line = raw.replace(/[|_~`]+/g, ' ').replace(/\s+/g, ' ').trim();
  line = line.replace(/^\W*\d{1,2}\s*[.)\-:]\s*/, ''); // list numbering
  if (line.length < 3 || DATE_ONLY.test(line)) return null;

  const formMatch = line.match(FORM);
  const dosageMatch = line.match(DOSAGE);
  let frequency = '';
  let freqMatch = null;
  for (const [re, label] of FREQUENCIES) {
    const m = line.match(re);
    if (m) { frequency = typeof label === 'function' ? label(m) : label; freqMatch = m; break; }
  }
  const durationMatch = line.match(DURATION);

  // Name: text after the form word, up to the first dosage, frequency or duration token.
  let rest = formMatch ? line.slice(formMatch[0].length) : line;
  const cut = [dosageMatch, freqMatch, durationMatch]
    .filter(Boolean).map((m) => rest.indexOf(m[0])).filter((i) => i > 0);
  let nameRaw = (cut.length ? rest.slice(0, Math.min(...cut)) : rest).replace(/[^A-Za-z0-9\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  nameRaw = nameRaw.split(' ').slice(0, 3).join(' ');
  if (!/[A-Za-z]{3,}/.test(nameRaw)) return null;

  // Try the full phrase first, then the first word (handles trailing noise).
  let fix = autocorrect(nameRaw);
  if (!fix.matched) {
    const first = autocorrect(nameRaw.split(' ')[0]);
    if (first.matched) fix = first;
  }

  const looksLikeMedication = !!formMatch || !!dosageMatch || fix.matched;
  if (!looksLikeMedication) return null;
  if (HEADER.test(line) && !formMatch && !fix.matched) return null; // FR-39: clinic headers and dates are dropped

  let duration = '';
  if (durationMatch) {
    const unit = DURATION_UNITS[durationMatch[2].toLowerCase()] || durationMatch[2];
    const count = Number(durationMatch[1]);
    duration = `${count} ${unit}${count === 1 ? '' : 's'}`;
  }

  return {
    name: fix.matched ? fix.name : nameRaw.replace(/\b[a-z]/g, (c) => c.toUpperCase()),
    originalName: nameRaw,
    autocorrected: fix.corrected,
    inDictionary: fix.matched,
    form: formMatch ? formMatch[1].toLowerCase() : '',
    dosage: dosageMatch ? dosageMatch[0].replace(/\s+/g, ' ') : '',
    frequency,
    duration,
    sourceLine: raw.trim(),
  };
}

export function parseMedications(lines) {
  const medications = [];
  for (const raw of lines) {
    const parsed = parseLine(String(raw || ''));
    if (parsed) medications.push(parsed);
  }
  return medications;
}
