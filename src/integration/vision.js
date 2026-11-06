/**
 * Describing a picture: a wardrobe card, a place or a thing of the library — one model
 * for all three (settings.wardrobeVision). Not every model sees
 * pictures, so the model is chosen separately (settings.wardrobeVision):
 *   - 'main':    the chat model SillyTavern uses now (Chat Completion APIs only),
 *                through SillyTavern's own request service — its key stays in its secrets;
 *   - 'profile': a Connection Manager profile;
 *   - 'custom':  an OpenAI-compatible endpoint (URL + key + model), sent through the
 *                SillyTavern server like the auxiliary API.
 * The picture travels as an OpenAI-style `image_url` part; SillyTavern's server
 * converts it for Claude, Gemini and the rest.
 */
import { auxGenerate } from './llm.js';
import { WARDROBE_CATEGORIES } from '../core/index.js';

/** A 16×16 red square: enough to check that a model sees pictures at all. */
export const TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGO4oKBAEmIY1TCqQWHYagAAS38QED44ZPAAAAAASUVORK5CYII=';
export const TEST_PROMPT = 'What colour is this picture? Answer with one English word.';

export const VISION_MODES = Object.freeze({ main: 'Как у таверны', profile: 'Профиль подключения', custom: 'Свой API' });

export const VISION_DEFAULTS = Object.freeze({ mode: 'main', profileId: '', url: '', key: '', model: '', maxTokens: 700 });

const CATEGORY_LIST = WARDROBE_CATEGORIES.map(([id, label]) => `${id} (${label})`).join(', ');

/**
 * What each section covers, and what it must leave out. A card describes ONE thing:
 * a hairstyle card keeps the clips in the hair but not the necklace; a top card never
 * mentions hair or skin. Pictures show whole people, so the boundary is spelled out.
 */
export const SECTION_SCOPE = Object.freeze({
  hair: 'the HAIRSTYLE only: length, colour, texture, cut, how it is styled; anything worn IN the hair (clips, pins, ribbons, hair ties, flowers, hair chains) is part of it. Leave out the face, eyes, skin, make-up, earrings, neck jewellery and all clothing.',
  top: 'the TOP garment only (shirt, T-shirt, blouse, sweater, hoodie, tank top, crop top, corset worn as a top). Leave out jackets and coats worn over it, trousers, skirts, hair, skin, body, jewellery.',
  pants: 'the TROUSERS only (trousers, jeans, shorts, leggings) including a belt sewn into them. Leave out the top, shoes, a separate belt, hair, skin, body.',
  skirts: 'the SKIRT only. Leave out the top, tights, shoes, hair, skin, body.',
  dresses: 'the DRESS only (a dress, a sundress, a jumpsuit or overalls as one piece). Leave out a jacket over it, tights, shoes, jewellery, hair, skin, body.',
  outerwear: 'the OUTER LAYER only (coat, jacket, blazer, cardigan, kimono, cape, uniform coat, vest worn over clothes). Leave out what is worn under it, trousers, shoes, hair, skin, body.',
  underwear: 'the UNDERWEAR, lingerie, nightwear, socks, tights or stockings only. Leave out other clothing, hair, skin and the body itself; describe the garment, never the body.',
  shoes: 'the SHOES only (shoes, boots, sneakers, sandals, heels). Leave out socks, tights, trousers, the legs.',
  headwear: 'the HEADWEAR only (hat, cap, beanie, beret, helmet, bandana or scarf worn on the head, a hood that is a separate piece). Leave out the hair, the face and clothing.',
  bags: 'the BAG only (handbag, backpack, shoulder bag, clutch, sports bag), with its charms and straps. Leave out clothing, hands, the body.',
  jewelry: 'the JEWELLERY only (earrings, piercings, necklaces, chains, pendants, rings, bracelets, anklets, brooches). Leave out hair accessories (they belong to the hairstyle), the nails, clothing, skin, the body.',
  accessories: 'the ACCESSORY only (belt, gloves, scarf, tie, glasses, watch, mask, armband, choker made of fabric, suspenders). Leave out clothing it is worn with, hair, skin, the body.',
  makeup: 'the MAKE-UP only: eyes (shadow, liner, lashes), brows if styled, lips, blush, highlight, contour — products, colours, finish, placement. Leave out the nails (they have their own section), natural skin tone, face shape, eye colour, tattoos, hair, jewellery and clothing.',
  nails: 'the MANICURE only: nail length and shape (almond, square, stiletto…), colour, finish (glossy, matte, chrome), design and nail art, extensions or press-ons, decorations on the nails. Leave out rings, bracelets, the hands themselves, skin tone, tattoos and clothing.',
  tattoos: 'the TATTOOS only: what each design shows, its style (fine line, blackwork, colour, Japanese irezumi, lettering…), colours, size and where it sits (the placement is part of the tattoo, e.g. "on the left forearm"). Leave out the body itself, skin tone, scars, piercings, jewellery, make-up, hair and clothing.',
  sets: 'the WHOLE OUTFIT shown together, as one card: every garment, the shoes and the accessories that are part of it, listed from top to bottom with colours and materials. Leave out the hair, make-up, skin, body, face, pose and background.',
});

const NEVER = 'Never describe the person: no body, skin colour, face, age, figure, pose, mood, setting or background, and nothing outside the section (a tattoo may say where on the body it is, nothing more). If the thing of the section is not visible, say so in the description.';

/**
 * The prompt for describing a picture for a card of `category` (null: the model picks the section first).
 * `placement`: where a tattoo is, as the user wrote it — the model uses it instead of guessing.
 */
export function describePrompt(category = null, { placement = '' } = {}) {
  const scope = category && SECTION_SCOPE[category];
  const where = category === 'tattoos' && String(placement ?? '').trim()
    ? `\nThe user says this tattoo is on: "${String(placement).trim().slice(0, 120)}". Use exactly this placement in the description (in Russian); do not guess another one, even if the picture shows a different body part.`
    : '';
  if (scope) {
    return `You fill a card of a roleplay wardrobe from this picture. Section: ${category}. Describe ${scope}${where}
${NEVER}
Return JSON only: {"name":"short Russian name of this piece, 2-6 words","gender":"female, unisex or male (unisex: worn by anyone the same way)","description":"Russian, 2-5 sentences: what it is, colour, material, cut or shape, notable details, how it is worn"}.`;
  }
  return `You fill a card of a roleplay wardrobe from this picture. First decide which ONE section the picture is about: ${CATEGORY_LIST}. A picture of a complete outfit the user wants as one card is "sets".
Then describe only what that section covers:
${Object.entries(SECTION_SCOPE).map(([id, text]) => `- ${id}: ${text}`).join('\n')}
${NEVER}
Return JSON only: {"name":"short Russian name, 2-6 words","category":"the section ID","gender":"female, unisex or male (unisex: worn by anyone the same way)","description":"Russian, 2-5 sentences: what it is, colour, material, cut or shape, notable details, how it is worn"}.`;
}

/** A picture of a place for the location library: the place itself, never the people in it. */
export const PLACE_PROMPT = `You fill a card of a roleplay location library from this picture. Describe the PLACE only: what kind of place it is, its layout and size, light and time of day if clear, colours and materials, the notable objects and furniture, the condition (new, worn, messy), the mood it gives. Leave out people, characters, their clothes, bodies and poses; do not invent a story.
Return JSON only: {"name":"short Russian name of the place, 1-5 words","traits":["3-6 short Russian details a narrator can reuse, 2-6 words each"],"description":"Russian, 3-6 sentences"}.`;

/** A picture of an object for the things library: the object only. */
export const THING_PROMPT = `You fill a card of a roleplay things library from this picture. Describe the OBJECT only: what it is, its size, shape, colour, material, condition, marks, inscriptions and anything that makes it recognisable. Leave out hands, people, clothing that is not the object, and the background.
Return JSON only: {"name":"short Russian name of the object, 1-5 words","description":"Russian, 2-4 sentences"}.`;

/** The prompt when nothing is known about the picture. */
export const DESCRIBE_PROMPT = describePrompt(null);

/** Settings for describing, with defaults filled in. */
export function visionSettings(raw) {
  const value = { ...VISION_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!Object.hasOwn(VISION_MODES, value.mode)) value.mode = 'main';
  value.maxTokens = Math.max(200, Math.min(4000, Number(value.maxTokens) || VISION_DEFAULTS.maxTokens));
  return value;
}

function messagesFor(dataUrl, prompt) {
  return [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }];
}

function contentOf(result) {
  const content = typeof result === 'string' ? result : result?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Модель вернула пустой ответ. Видит ли она картинки?');
  return content;
}

/** Ask the chosen model about a picture (a data: URL). Returns its raw text. */
export async function askAboutImage(context, rawSettings, dataUrl, prompt = DESCRIBE_PROMPT) {
  if (!/^data:image\//.test(String(dataUrl ?? ''))) throw new TypeError('Нужна картинка.');
  const settings = visionSettings(rawSettings);
  const messages = messagesFor(dataUrl, prompt);
  if (settings.mode === 'profile') {
    const service = context.ConnectionManagerRequestService;
    if (!service) throw new Error('В этой версии SillyTavern нет профилей подключений.');
    if (!settings.profileId) throw new Error('Выберите профиль подключения для описания картинок.');
    return contentOf(await service.sendRequest(settings.profileId, messages, settings.maxTokens));
  }
  if (settings.mode === 'custom') {
    return auxGenerate(context, { mode: 'custom', url: settings.url, key: settings.key, model: settings.model, maxTokens: settings.maxTokens }, messages);
  }
  // 'main': the chat model of SillyTavern, as it is set up right now.
  if (context.mainApi !== 'openai') throw new Error('«Как у таверны» работает только с Chat Completion API. Выберите профиль или свой API в «Настройки → Модели и API → Картинки».');
  const service = context.ChatCompletionService;
  const oai = context.chatCompletionSettings;
  if (!service || !oai) throw new Error('Эта версия SillyTavern не даёт расширениям запросы к модели чата.');
  const result = await service.processRequest({
    stream: false,
    messages,
    max_tokens: settings.maxTokens,
    model: context.getChatCompletionModel?.(),
    chat_completion_source: oai.chat_completion_source,
    custom_url: oai.custom_url || undefined,
    reverse_proxy: oai.reverse_proxy || undefined,
    proxy_password: oai.proxy_password || undefined,
  }, {}, true);
  return contentOf(result);
}

/** The model's answer as card fields: { name, category, gender, description } (missing parts are ''). */
export function parseDescription(text) {
  const raw = String(text ?? '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  let data = null;
  if (match) { try { data = JSON.parse(match[0]); } catch { data = null; } }
  // A model that ignored the format still gave a description: keep it as is.
  if (!data || typeof data !== 'object') return { name: '', category: '', gender: '', description: raw.replace(/^```\w*|```$/g, '').trim().slice(0, 3000) };
  const categories = new Set(WARDROBE_CATEGORIES.map(([id]) => id));
  return {
    name: String(data.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    category: categories.has(data.category) ? data.category : '',
    gender: ['female', 'unisex', 'male'].includes(data.gender) ? data.gender : '',
    description: String(data.description ?? '').trim().slice(0, 3000),
    ...(Array.isArray(data.traits) ? { traits: data.traits.map(trait => String(trait ?? '').trim()).filter(Boolean).slice(0, 8) } : {}),
  };
}

/** What the settings page offers: the profiles, and whether «Как у таверны» can see pictures at all. */
export function listVisionChoices(context, rawSettings) {
  let profiles = [];
  try {
    profiles = (context.ConnectionManagerRequestService?.getSupportedProfiles?.() ?? [])
      .map(profile => ({ id: profile.id, name: profile.name || profile.id }));
  } catch { profiles = []; }
  let mainModel = '';
  try { mainModel = context.mainApi === 'openai' ? String(context.getChatCompletionModel?.() ?? '') : ''; } catch { mainModel = ''; }
  return { settings: visionSettings(rawSettings), profiles, mainChatCompletion: context.mainApi === 'openai', mainModel };
}
