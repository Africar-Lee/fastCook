import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createKitchenSession } from '../storage/session.ts';
import { initialKitchen, validateKitchen } from '../storage/state.ts';
import { failure, success } from '../storage/types.ts';
import { markUnavailable } from './inventory-actions.ts';
import { completePantrySetup, excludeUnavailableSelections, initialPantrySelection, isNewKitchen, pantrySetupChoices } from './pantry-setup.ts';

const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const templateIds = catalog.pantry_templates.find(item => item.template_id === 'cn_basic').ingredient_ids;
const timestamp = '2026-10-14T10:00:00.000Z';

function memoryStorage() {
  let stored = null;
  const writes = [];
  return {
    writes,
    read: async () => success(stored),
    write: async (value) => { writes.push(value); stored = value; return success(undefined); },
    reset: async (value) => { stored = value; return success(undefined); },
  };
}

test('keeps new kitchen defaults unpersisted until confirmed and restores the completed setup', async () => {
  const storage = memoryStorage();
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  const initial = session.getSnapshot().state;
  assert.equal(isNewKitchen(initial), true);
  assert.deepEqual(initialPantrySelection(catalog, initial), templateIds);
  assert.deepEqual(initial.pantryIds, []);
  assert.equal(storage.writes.length, 0);
  session.update(state => completePantrySetup(state, catalog, initialPantrySelection(catalog, state), ['wok', 'pot']));
  await session.settled();
  assert.equal(session.getSnapshot().error, null);
  const reopened = createKitchenSession(catalog, storage);
  reopened.load();
  await reopened.settled();
  assert.deepEqual(reopened.getSnapshot().state.pantryIds, templateIds);
  assert.deepEqual(reopened.getSnapshot().state.equipment, ['wok', 'pot']);
  assert.equal(reopened.getSnapshot().state.pantryConfigured, true);
  assert.equal(reopened.getSnapshot().state.equipmentConfigured, true);
  assert.equal(reopened.getSnapshot().state.updatedAt, timestamp);
  assert.equal(isNewKitchen(reopened.getSnapshot().state), false);
});

test('skipping setup remembers the visit without confirming pantry defaults or equipment', async () => {
  const storage = memoryStorage();
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  assert.equal(isNewKitchen(session.getSnapshot().state), true);
  session.update(previous => previous);
  await session.settled();
  assert.equal(session.getSnapshot().error, null);
  const reopened = createKitchenSession(catalog, storage);
  reopened.load();
  await reopened.settled();
  const restored = reopened.getSnapshot().state;
  assert.deepEqual(restored, { ...initialKitchen(catalog), updatedAt: timestamp });
  assert.equal(isNewKitchen(restored), false);
  assert.equal(restored.pantryConfigured, false);
  assert.equal(restored.equipmentConfigured, false);
});

test('leaves ginger and garlic selected for today when confirming pantry defaults', () => {
  const state = { ...initialKitchen(catalog), currentIds: ['tomato', 'ginger', 'garlic'] };
  const choices = pantrySetupChoices(catalog, state);
  assert.equal(choices.includes('ginger'), false);
  assert.equal(choices.includes('garlic'), false);
  const result = completePantrySetup(state, catalog, initialPantrySelection(catalog, state), ['wok']);
  assert.deepEqual(result.currentIds, state.currentIds);
  assert.equal(result.pantryIds.includes('ginger'), false);
  assert.equal(result.pantryIds.includes('garlic'), false);
  assert.equal(validateKitchen(result, catalog).error, null);
});

test('keeps existing pantry ingredients outside the template visible and selected without duplication', () => {
  const state = { ...initialKitchen(catalog), pantryIds: ['garlic', 'sesame_oil', 'white_pepper'] };
  const choices = pantrySetupChoices(catalog, state);
  assert.deepEqual(choices, [...templateIds, 'sesame_oil', 'white_pepper']);
  assert.deepEqual(initialPantrySelection(catalog, state), choices);
  const result = completePantrySetup(state, catalog, choices, ['wok']);
  assert.deepEqual(result.pantryIds, choices);
  assert.deepEqual(state.pantryIds, ['garlic', 'sesame_oil', 'white_pepper']);
});

test('shows absent defaults without selecting them or overriding parent ingredient absences', () => {
  const state = { ...initialKitchen(catalog), unavailableIds: ['garlic', 'soy_sauce', 'vinegar', 'egg'] };
  const excluded = ['garlic', 'light_soy_sauce', 'dark_soy_sauce', 'aromatic_vinegar'];
  const selected = initialPantrySelection(catalog, state);
  assert.deepEqual(pantrySetupChoices(catalog, state), templateIds);
  assert.deepEqual(selected, templateIds.filter(id => !excluded.includes(id)));
  const result = completePantrySetup(state, catalog, selected, ['wok']);
  assert.deepEqual(result.unavailableIds, state.unavailableIds);
  assert.equal(validateKitchen(result, catalog).error, null);
});

test('explicit selection moves a current ingredient and clears only its matching absence', () => {
  const state = {
    ...initialKitchen(catalog), currentIds: ['tomato', 'garlic'],
    unavailableIds: ['soy_sauce', 'aromatic_vinegar', 'egg'],
  };
  const selected = [...initialPantrySelection(catalog, state), 'garlic', 'light_soy_sauce', 'aromatic_vinegar'];
  const result = completePantrySetup(state, catalog, selected, ['wok']);
  assert.deepEqual(result.currentIds, ['tomato']);
  assert.equal(result.pantryIds.includes('garlic'), true);
  assert.equal(result.pantryIds.includes('light_soy_sauce'), true);
  assert.equal(result.pantryIds.includes('aromatic_vinegar'), true);
  assert.deepEqual(result.unavailableIds, ['egg']);
  assert.deepEqual(state.currentIds, ['tomato', 'garlic']);
  assert.deepEqual(state.unavailableIds, ['soy_sauce', 'aromatic_vinegar', 'egg']);
  assert.equal(result.updatedAt, null);
  assert.equal(validateKitchen(result, catalog).error, null);
});

test('marking salt absent removes it from the setup draft without discarding other selections', () => {
  const draft = ['salt', 'garlic', 'light_soy_sauce'];
  const state = markUnavailable(initialKitchen(catalog), catalog, 'salt');
  const selected = excludeUnavailableSelections(catalog, draft, state.unavailableIds);
  const result = completePantrySetup(state, catalog, selected, ['wok']);
  assert.deepEqual(selected, ['garlic', 'light_soy_sauce']);
  assert.deepEqual(result.pantryIds, ['garlic', 'light_soy_sauce']);
  assert.deepEqual(result.unavailableIds, ['salt']);
  assert.deepEqual(draft, ['salt', 'garlic', 'light_soy_sauce']);
  assert.equal(validateKitchen(result, catalog).error, null);
});

test('marking a parent ingredient absent removes matching children from the setup draft', () => {
  const draft = ['light_soy_sauce', 'dark_soy_sauce', 'rice_vinegar', 'garlic'];
  const state = markUnavailable(initialKitchen(catalog), catalog, 'soy_sauce');
  const selected = excludeUnavailableSelections(catalog, draft, state.unavailableIds);
  const result = completePantrySetup(state, catalog, selected, ['wok']);
  assert.deepEqual(selected, ['rice_vinegar', 'garlic']);
  assert.deepEqual(result.pantryIds, ['rice_vinegar', 'garlic']);
  assert.deepEqual(result.unavailableIds, ['soy_sauce']);
  assert.equal(validateKitchen(result, catalog).error, null);
});

test('retains previously confirmed equipment including an intentionally empty selection', () => {
  for (const equipment of [['steamer'], []]) {
    const state = { ...initialKitchen(catalog), equipmentConfigured: true, equipment, updatedAt: timestamp };
    const result = completePantrySetup(state, catalog, ['garlic'], ['wok', 'pot']);
    assert.deepEqual(result.equipment, equipment);
    assert.equal(result.equipmentConfigured, true);
    assert.equal(result.updatedAt, timestamp);
    assert.equal(validateKitchen(result, catalog).error, null);
  }
});

test('accepts empty pantry and equipment while preserving current stock and absences', () => {
  const state = { ...initialKitchen(catalog), pantryIds: ['garlic'], currentIds: ['egg'], unavailableIds: ['ginger'] };
  const result = completePantrySetup(state, catalog, [], []);
  assert.deepEqual(result.pantryIds, []);
  assert.deepEqual(result.equipment, []);
  assert.deepEqual(result.currentIds, ['egg']);
  assert.deepEqual(result.unavailableIds, ['ginger']);
  assert.equal(result.pantryConfigured, true);
  assert.equal(result.equipmentConfigured, true);
  assert.equal(validateKitchen(result, catalog).error, null);
});

test('recognizes only an untouched kitchen as new', () => {
  assert.equal(isNewKitchen(initialKitchen(catalog)), true);
  for (const change of [
    { updatedAt: timestamp }, { pantryConfigured: true }, { equipmentConfigured: true },
    { currentIds: ['egg'] }, { pantryIds: ['garlic'] }, { unavailableIds: ['salt'] }, { equipment: ['wok'] },
  ]) {
    assert.equal(isNewKitchen({ ...initialKitchen(catalog), ...change }), false, JSON.stringify(change));
  }
});

test('preserves confirmed setup after a failed save and persists it when retried', async () => {
  const storage = memoryStorage();
  const originalWrite = storage.write;
  let attempts = 0;
  storage.write = async value => ++attempts === 1 ? failure('厨房设置未保存') : originalWrite(value);
  const session = createKitchenSession(catalog, storage, () => timestamp);
  session.load();
  await session.settled();
  session.update(state => completePantrySetup(state, catalog, ['garlic', 'sugar'], ['wok']));
  await session.settled();
  const failed = session.getSnapshot();
  assert.equal(failed.error, '厨房设置未保存');
  assert.equal(failed.saving, false);
  assert.deepEqual(failed.state.pantryIds, ['garlic', 'sugar']);
  assert.equal(failed.state.pantryConfigured, true);
  assert.equal(failed.state.equipmentConfigured, true);
  assert.equal(isNewKitchen(failed.state), false);
  session.retry();
  await session.settled();
  assert.equal(session.getSnapshot().error, null);
  const reopened = createKitchenSession(catalog, storage);
  reopened.load();
  await reopened.settled();
  assert.deepEqual(reopened.getSnapshot().state, failed.state);
});
