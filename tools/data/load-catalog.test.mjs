import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadCatalog } from './load-catalog.mjs';

async function fixture(context) {
  const temporary = await mkdtemp(join(tmpdir(), 'fastcook-data-'));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataRoot = join(temporary, 'data');
  await cp(new URL('../../data/', import.meta.url), dataRoot, { recursive: true });
  return { temporary, dataRoot };
}

test('loads the bundled draft catalog with deterministic order', async () => {
  const result = await loadCatalog();
  assert.equal(result.error, null);
  assert.equal(result.data.recipes.length, 25);
  assert.equal(result.data.dishes.length, 25);
  assert.equal(result.data.release_state, 'draft');
  const identifiers = result.data.recipes.map((recipe) => recipe.recipe_id);
  assert.deepEqual(identifiers, [...identifiers].sort());
});

test('reports malformed JSON with its data path', async (context) => {
  const { dataRoot } = await fixture(context);
  await writeFile(join(dataRoot, 'recipes/tomato_egg.json'), '{');
  const result = await loadCatalog(dataRoot);
  assert.equal(result.error.code, 'file.invalid_json');
  assert.equal(result.error.path, 'recipes/tomato_egg.json');
});

test('rejects a file exceeding the size limit before parsing', async (context) => {
  const { dataRoot } = await fixture(context);
  await writeFile(join(dataRoot, 'sources.json'), ' '.repeat(1024 * 1024 + 1));
  assert.equal((await loadCatalog(dataRoot)).error.code, 'file.too_large');
});

test('rejects symbolic links outside the data root', async (context) => {
  const { temporary, dataRoot } = await fixture(context);
  const outside = join(temporary, 'outside.json');
  await writeFile(outside, '[]');
  await rm(join(dataRoot, 'sources.json'));
  await symlink(outside, join(dataRoot, 'sources.json'));
  assert.equal((await loadCatalog(dataRoot)).error.code, 'file.outside_root');
});

test('rejects recipe arrays instead of flattening them into valid input', async (context) => {
  const { dataRoot } = await fixture(context);
  const path = join(dataRoot, 'recipes/tomato_egg.json');
  const recipe = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify([recipe]));
  assert.equal((await loadCatalog(dataRoot)).error.code, 'collection.invalid_shape');
});

test('rejects metadata fields that could be silently overwritten by collections', async (context) => {
  const { dataRoot } = await fixture(context);
  const path = join(dataRoot, 'catalog.meta.json');
  const metadata = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...metadata, recipes: [] }));
  assert.equal((await loadCatalog(dataRoot)).error.code, 'metadata.unknown_field');
});

test('reports a missing required collection directory', async (context) => {
  const { temporary } = await fixture(context);
  const emptyRoot = join(temporary, 'empty');
  await mkdir(emptyRoot);
  assert.equal((await loadCatalog(emptyRoot)).error.code, 'directory.unreadable');
});
