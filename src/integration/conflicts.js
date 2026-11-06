export function detectConflicts(context, globals = globalThis) {
  const conflicts = [];
  try {
    const disabled = new Set(context.extensionSettings?.disabledExtensions ?? []);
    const loveScore = context.getExtensionManifest?.('love-score');
    if (loveScore && !['love-score', 'third-party/love-score'].some(name => disabled.has(name))) {
      conflicts.push({
        id: 'love-score',
        title: 'Возможно, Love Score всё ещё включён',
        message: 'Два движка отношений могут давать модели противоречивые инструкции. Отключите Love Score, пока используются Кулисы.',
      });
    }
    // An active Relationship Engine registers this interceptor whatever its folder is called.
    // Kulisy loads after it (loading_order), so the check sees it on activation.
    if (typeof globals.relationshipEngineInterceptor === 'function') {
      conflicts.push({
        id: 'relationship-engine',
        title: 'Включён Движок отношений',
        message: 'Кулисы уже содержат всё, что умеет Движок отношений. Если оставить оба, модель получит отношения дважды. Отключите Движок отношений в меню расширений; его данные можно перенести в Кулисы.',
      });
    }
  } catch (error) {
    console.error('[Kulisy] Conflict check failed.', error);
  }
  return conflicts;
}
