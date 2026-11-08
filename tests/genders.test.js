import test from 'node:test';
import assert from 'node:assert/strict';
import { genderFromText, guessGenders } from '../src/integration/genders.js';

test('pronouns decide only with a clear lead', () => {
  assert.equal(genderFromText('Она родилась в Токио. Её брат — Ран. Ей девятнадцать, она курит.'), 'female');
  assert.equal(genderFromText('Он старший. Его боятся, ему всё равно. He is calm.'), 'male');
  assert.equal(genderFromText('Он и она. Его и её.'), '');
  assert.equal(genderFromText('Короткая запись'), '');
});

test('only empty genders are guessed, from the entries keyed to that character', () => {
  const state = {
    entities: { ran: { id: 'ran', name: 'Ран', aliases: [] }, suzu: { id: 'suzu', name: 'Судзу', aliases: [] }, mikey: { id: 'mikey', name: 'Майки', aliases: [] } },
    ui: { genders: { mikey: 'female' } },
  };
  const books = [{ entries: {
    1: { key: ['Ран'], content: 'Он старший из братьев. Его боятся. Ему нравится власть.' },
    2: { key: ['Майки'], content: 'Он лидер. Его все любят. Ему скучно.' },
  } }];
  const guesses = guessGenders(state, books, { suzu: 'Она тихая. Её не слышно. Ей так спокойнее.' });
  assert.deepEqual(guesses, { ran: 'male', suzu: 'female' }, 'Майки set by hand stays as it is');
});
