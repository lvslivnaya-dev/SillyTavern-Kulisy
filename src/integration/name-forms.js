/**
 * «Заполнить склонения»: the model proposes the case forms of names (Japanese and other
 * foreign ones too), the person checks them in the library. Nothing is saved here:
 * `fillNameForms` returns forms for the words that are still empty, the caller applies them.
 */
import { NAME_CASES, NAME_LIMITS, wordsToFill } from '../core/name-library.js';
import { parseModelObject, requestStructured } from './analyzer.js';

const BATCH = 12;

const SYSTEM = `You decline names for Russian roleplay text. You get a list of names (id, full name, aliases, gender: m / f / unknown) and for each the words that need forms. Output ONLY valid JSON:
{"entries":[{"id":"…","words":[{"word":"Рён","same":false,"gen":"Рёна","dat":"Рёну","acc":"Рёна","ins":"Рёном","pre":"Рёне"}]}]}
- word: exactly as given. Give each requested word once.
- Cases: gen (кого? родительный), dat (кому? дательный), acc (кого? винительный), ins (кем? творительный), pre (о ком? предложный).
- Forms are Russian forms of the word as written. Keep the writing system: a Cyrillic word gets Cyrillic forms.
- same: true when the word does not decline (a surname ending in -о, -их, -ых, -ко or in a vowel like «Сано», «Хайтани», «Мацуно»; a feminine surname ending in a consonant; a name that Russian leaves unchanged). Then leave all five forms empty.
- Use the gender when it is given; when it is unknown, decide from the name. Japanese masculine given names ending in a consonant («Рён», «Кэн») decline; those ending in -о, -э, -и, -у («Манджиро», «Кейске», «Сано») stay as they are.
- A form must be what a native speaker writes. If you are not sure the word declines, prefer same: true to a wrong form.
Return JSON only.`;

/** { id → { word → { same, gen… } } }, tolerant: only known ids and requested words, clean strings. */
export function parseNameForms(raw, requested) {
  const data = typeof raw === 'object' && raw !== null && !('text' in raw) ? raw : parseModelObject(raw);
  const answer = {};
  for (const item of Array.isArray(data.entries) ? data.entries : []) {
    const wanted = requested.get(String(item?.id));
    if (!wanted) continue;
    const words = {};
    for (const form of Array.isArray(item.words) ? item.words : []) {
      const key = String(form?.word ?? '').trim();
      if (!wanted.has(key)) continue;
      const same = form.same === true;
      const clean = { same };
      for (const [caseKey] of NAME_CASES) clean[caseKey] = same ? '' : String(form?.[caseKey] ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_LIMITS.form);
      // A «declines» answer with no forms at all says nothing: leave the word for the person.
      if (!same && !NAME_CASES.some(([caseKey]) => clean[caseKey])) continue;
      words[key] = clean;
    }
    if (Object.keys(words).length) answer[item.id] = words;
  }
  return answer;
}

/**
 * entries: library entries. → { patches: [{ id, words: [{ word, same, gen… }] }], asked, failed }.
 * Entries with nothing to fill are skipped. Never throws on a bad batch: that batch is `failed`.
 */
export async function fillNameForms(context, entries) {
  const todo = entries.map(entry => ({ entry, words: wordsToFill(entry) })).filter(item => item.words.length);
  const patches = [];
  let failed = 0;
  for (let start = 0; start < todo.length; start += BATCH) {
    const batch = todo.slice(start, start + BATCH);
    const requested = new Map(batch.map(item => [item.entry.id, new Set(item.words.map(word => word.word))]));
    const prompt = batch.map(item => JSON.stringify({
      id: item.entry.id,
      name: item.entry.name,
      aliases: item.entry.aliases,
      gender: item.entry.gender || 'unknown',
      words: item.words.map(word => word.word),
    })).join('\n');
    try {
      const answer = await requestStructured(context, {
        prompt: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Names:\n${prompt}\n\nReturn JSON only.` }],
        trimNames: false,
        busyLabel: 'имена: подбираю склонения…',
      }, raw => parseNameForms(raw, requested));
      for (const [id, words] of Object.entries(answer)) patches.push({ id, words: Object.entries(words).map(([word, forms]) => ({ word, ...forms })) });
    } catch (error) {
      failed += batch.length;
      console.warn('[Kulisy] Name forms failed.', error);
    }
  }
  return { patches, asked: todo.length, failed };
}
