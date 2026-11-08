import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createDefaultState, createEntity, createOperation } from '../src/core/index.js';
import { generateGrowthFactors } from '../src/integration/growth.js';
import { pairTropeFactors, pairTropes } from '../src/integration/tropes.js';

const ran = createEntity('Ран');
const suzu = createEntity('Судзу');
const state = applyOperations(createDefaultState(), [createOperation('entity.upsert', ran), createOperation('entity.upsert', suzu)]);
const scales = state.config.scales.map(scale => scale.id);

test('a trope is analysed, not rewritten: cards, persona and lore go in; factors come back as 3–5 actions with the analysis', async () => {
  const calls = [];
  const answer = {
    analysis: { subject: 'Ран ценит силу и холодную голову, презирает истерики.', object: 'Судзу тихая, двигается как кошка, курит у окна.', dynamic: 'Он старше и привык командовать.' },
    factors: [{
      scaleId: 'attraction', direction: 'up', title: 'Тихая уверенность', basis: 'Рана цепляет спокойствие под давлением',
      actions: ['Судзу не отводит взгляд, когда он нависает над ней', 'Судзу курит у окна, выгнув спину, и не замечает его', 'Судзу отвечает ему вполголоса, с хрипотцой', 'Судзу поправляет ему воротник, не спрашивая'],
    }],
  };
  const context = { chat: [], async generateRaw(options) { calls.push(options); return JSON.stringify(answer); } };
  const meta = pairTropes().find(item => item.id === 'body-first');
  const trope = { ...meta, factors: pairTropeFactors('body-first', scales, { subj: 'Ран', obj: 'Судзу' }) };
  const { factors, analysis } = await generateGrowthFactors(context, state, ran.id, suzu.id, {
    loreContext: '## Судзу\nТихая, двигается как кошка.', cardText: '### Персона пользователя «Судзу»\nКурит у окна.', trope,
  });
  const [system, user] = calls[0].prompt.map(item => item.content);
  assert.match(system, /STEP 1 — ANALYSIS/);
  assert.match(system, /3 to 5 concrete things B does toward A/);
  assert.match(user, /TROPE chosen by the user: «Сначала тело, потом сердце»/);
  assert.match(user, /not a text to rewrite/);
  assert.doesNotMatch(user, /оказывается рядом — случайная/, 'the template wording is not handed over');
  assert.match(user, /Курит у окна/, 'the persona card');
  assert.match(user, /двигается как кошка/, 'the lore');
  assert.equal(factors[0].text.split('\n')[0], 'Тихая уверенность:');
  assert.equal(factors[0].text.split('\n').filter(line => line.startsWith('• ')).length, 4);
  assert.equal(analysis.subject, answer.analysis.subject);
});

test('the persona\'s hidden character reaches only the factor generator, marked as unknown to others', async () => {
  const calls = [];
  const context = { chat: [], async generateRaw(options) { calls.push(options); return JSON.stringify({ analysis: {}, factors: [{ scaleId: 'trust', direction: 'up', title: 'т', actions: ['а', 'б', 'в'] }] }); } };
  await generateGrowthFactors(context, state, ran.id, suzu.id, { personaPrivate: { name: 'Судзу', text: 'Теряется от прямой нежности.' } });
  const user = calls[0].prompt[1].content;
  assert.match(user, /PERSONA'S HIDDEN CHARACTER — what Судзу is really like inside/);
  assert.match(user, /The other characters do NOT know it/);
  assert.match(user, /Теряется от прямой нежности/);
});
