import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOCAL_MODEL, LOCAL_MODELS, configKey } from '../src/integration/embeddings.js';

test('every browser model says how it is pooled; e5 models carry their prefixes', () => {
  for (const [id, model] of Object.entries(LOCAL_MODELS)) {
    assert.ok(['mean', 'cls'].includes(model.pooling), id);
    assert.ok(model.size > 0 && model.label.includes(`${model.size} МБ`), id);
    if (id.includes('e5')) assert.deepEqual([model.query, model.passage], ['query: ', 'passage: '], id);
  }
  assert.equal(LOCAL_MODELS['Xenova/bge-m3'].pooling, 'cls');
  assert.ok(LOCAL_MODELS[DEFAULT_LOCAL_MODEL]);
});

test('the vector cache is keyed by the model really used; old q4 settings share q8 vectors', () => {
  assert.equal(configKey({ mode: 'local', localModel: 'Xenova/bge-m3', dtype: 'q4' }), 'local:Xenova/bge-m3:q8');
  assert.equal(configKey({ mode: 'local', localModel: 'нет такой' }), `local:${DEFAULT_LOCAL_MODEL}:q8`);
});
