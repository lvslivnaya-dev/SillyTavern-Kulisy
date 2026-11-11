/**
 * «Сгенерировать климат»: twelve months of temperatures and odds of each kind of weather from
 * one line («Санкт-Петербург», «тропический остров», «вымышленный город у холодного моря»).
 * The person looks at it, then saves it as a climate shared by all chats. Nothing is saved here.
 */
import { WEATHER_KIND_IDS, normalizeClimate } from '../core/index.js';
import { parseModelObject, requestStructured } from './analyzer.js';

const SYSTEM = `You describe the typical climate of a place for a roleplay weather forecast. Output ONLY valid JSON:
{"name":"short Russian name","months":[{"min":2,"max":10,"kinds":{"clear":6,"cloudy":3,"rain":1}}]}
- Exactly 12 items in "months", January first. min/max: typical daily low and high in °C for that month (whole numbers, min < max).
- kinds: relative odds of each kind of day (any numbers, only the kinds that really happen in that month). Allowed kinds: ${WEATHER_KIND_IDS.join(', ')}.
- clear = sunny or clear sky, cloudy = overcast, rain = rain or drizzle, storm = thunderstorm, snow = snowfall, fog = fog, wind = strong wind, heat = oppressive heat (only for a hot month).
- Follow the real climate of a real place (rainy season, typhoons, monsoon, polar night); for an invented place infer it from the description. snow only when the daily high is near or below 2°C.
Return JSON only.`;

/** The model's answer → a climate { id, name, months }, or an error. */
export function parseClimate(raw, id) {
  const data = typeof raw === 'object' && raw !== null && !('text' in raw) ? raw : parseModelObject(raw);
  const clean = normalizeClimate({ id, name: data.name || 'Климат', months: data.months });
  if (!clean) throw new SyntaxError('Модель вернула не двенадцать месяцев с температурами и видами погоды.');
  return clean;
}

export async function generateClimate(context, { description, id }) {
  const wish = String(description ?? '').trim();
  if (!wish) throw new Error('Опишите место: например «Санкт-Петербург» или «вымышленный город у холодного моря».');
  try {
    return await requestStructured(context, {
      prompt: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Place: ${wish}\n\nReturn JSON only.` }],
      trimNames: false,
      busyLabel: 'погода: подбираю климат…',
    }, raw => parseClimate(raw, id));
  } catch (error) {
    throw new Error(`Не удалось подобрать климат: ${error?.message ?? error}`);
  }
}
