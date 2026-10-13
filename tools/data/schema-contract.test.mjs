import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadCatalog } from './load-catalog.mjs';

test('the four public entity schemas validate the corresponding draft collections', async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemaUrl = new URL('../../data/schemas/catalog.schema.json', import.meta.url);
  ajv.addSchema(JSON.parse(await readFile(schemaUrl, 'utf8')));
  const loaded = await loadCatalog();
  assert.equal(loaded.error, null);
  for (const [name, collection] of [
    ['ingredient', 'ingredients'],
    ['recipe', 'recipes'],
    ['substitution-rule', 'substitution_rules'],
    ['pantry-template', 'pantry_templates'],
  ]) {
    const url = new URL(`../../data/schemas/${name}.schema.json`, import.meta.url);
    const validate = ajv.compile(JSON.parse(await readFile(url, 'utf8')));
    for (const entity of loaded.data[collection]) {
      assert.equal(validate(entity), true, JSON.stringify(validate.errors));
    }
  }
});
