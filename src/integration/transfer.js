export const EXPORT_KIND = 'sillytavern-kulisy';
// Exports made by Relationship Engine carry the same state shape, so they import as-is.
const LEGACY_EXPORT_KINDS = new Set(['sillytavern-relationship-engine']);

export function downloadState(state, filename = 'kulisy-state.json') {
  try {
    const payload = {
      kind: EXPORT_KIND,
      exportedAt: new Date().toISOString(),
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    console.error('[Kulisy] Export failed.', error);
    throw error;
  }
}

export async function readStateFile(file, validateState) {
  if (!(file instanceof File)) throw new TypeError('Выберите JSON-файл для импорта.');
  if (file.size > 5_000_000) throw new Error('Файл импорта больше 5 МБ.');
  try {
    const parsed = JSON.parse(await file.text());
    const wrapped = parsed?.kind === EXPORT_KIND || LEGACY_EXPORT_KINDS.has(parsed?.kind);
    const state = wrapped ? parsed.state : parsed;
    return validateState(structuredClone(state));
  } catch (error) {
    console.error('[Kulisy] Import failed.', error);
    throw new Error(`Не удалось импортировать состояние отношений: ${error?.message ?? error}`);
  }
}
