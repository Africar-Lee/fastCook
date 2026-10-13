import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runHowToCookImport } from './howtocook-import.mjs';
import { parseOperationSteps, upstreamRepository } from './howtocook-format.mjs';
import { loadCatalog } from './load-catalog.mjs';
import { validateCatalog } from './validate-catalog.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const markdown = '# 番茄炒蛋\n\n## 操作\n\n1. **番茄**切块。\n    - 鸡蛋打散。\n2. 倒入 `食用油`，翻炒后加盐。![照片](https://example.com/photo.jpg)\n\n## 附加内容\n不导入该段。\n';

async function fixture(context) {
  const temporary = await mkdtemp(join(tmpdir(), 'fastcook-import-'));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataRoot = join(temporary, 'data');
  const upstreamRoot = join(temporary, 'upstream');
  await cp(new URL('../../data/', import.meta.url), dataRoot, { recursive: true });
  await mkdir(join(upstreamRoot, 'snapshot/dishes/test'), { recursive: true });
  await mkdir(join(upstreamRoot, 'profiles'), { recursive: true });
  const recipe = JSON.parse(await readFile(join(dataRoot, 'recipes/tomato_egg.json'), 'utf8'));
  for (const key of ['steps', 'source_ids', 'review_state']) delete recipe[key];
  recipe.recipe_id = 'howtocook_test_recipe';
  recipe.dish_id = 'howtocook_test_dish';
  recipe.requirements = recipe.requirements.filter((requirement) => requirement.importance === 'required');
  const profile = { recipe, steps: [
    { source_step: 1, requirement_ids: ['req_tomato', 'req_egg'] },
    { source_step: 2, requirement_ids: recipe.requirements.map((requirement) => requirement.requirement_id) },
  ], annotation_notes: ['测试用结构化标注。'] };
  const manifest = { format_version: 1, repository: upstreamRepository, commit: 'a'.repeat(40),
    license_sha256: hash('Unlicense fixture'), recipes: [{ path: 'dishes/test/recipe.md', sha256: hash(markdown), profile: 'test_recipe' }] };
  await writeFile(join(upstreamRoot, 'snapshot/LICENSE'), 'Unlicense fixture');
  await writeFile(join(upstreamRoot, 'snapshot/dishes/test/recipe.md'), markdown);
  const saveManifest = () => writeFile(join(upstreamRoot, 'manifest.json'), json(manifest));
  const saveProfile = () => writeFile(join(upstreamRoot, 'profiles/test_recipe.json'), json(profile));
  await saveManifest();
  await saveProfile();
  return { temporary, dataRoot, upstreamRoot, manifest, profile, saveManifest, saveProfile };
}

async function unchangedSources(context, mutate, code) {
  const input = await fixture(context);
  const original = await readFile(join(input.dataRoot, 'sources.json'), 'utf8');
  await mutate(input);
  const result = await runHowToCookImport(input);
  assert.equal(result.error?.code, code);
  assert.equal(await readFile(join(input.dataRoot, 'sources.json'), 'utf8'), original);
  const missing = await readFile(join(input.dataRoot, 'recipes/howtocook_test_recipe.json')).then(() => false, (error) => error.code === 'ENOENT');
  assert.equal(missing, true);
}

test('imports original steps with pinned provenance while retaining the publication gate', async (context) => {
  const input = await fixture(context);
  const before = await loadCatalog(input.dataRoot);
  const result = await runHowToCookImport(input);
  assert.equal(result.error, null, JSON.stringify(result.errors));
  assert.equal(result.data.recipes, 1);
  assert.equal(result.data.changedPaths.length, 3);
  const loaded = await loadCatalog(input.dataRoot);
  assert.equal(loaded.data.recipes.length, before.data.recipes.length + 1);
  const recipe = loaded.data.recipes.find((item) => item.recipe_id === 'howtocook_test_recipe');
  assert.equal(recipe.steps[0].text['zh-CN'], '番茄切块。\n- 鸡蛋打散。');
  assert.equal(recipe.steps[1].text['zh-CN'], '倒入 食用油，翻炒后加盐。');
  assert.equal(recipe.review_state, 'pending_review');
  assert.equal('annotation_notes' in recipe, false);
  const source = loaded.data.sources.find((item) => item.source_id === 'howtocook_test_recipe');
  assert.equal(source.license.state, 'pending');
  assert.equal(source.license.identifier, 'Unlicense');
  assert.equal(source.revision.snapshot_sha256, hash(markdown));
  assert.equal(source.license.evidence_sha256, input.manifest.license_sha256);
  assert.equal(source.provenance.locator, `${upstreamRepository}/blob/${'a'.repeat(40)}/dishes/test/recipe.md`);
  assert.equal(validateCatalog(loaded.data).valid, true);
  assert.equal(validateCatalog(loaded.data, { release: true }).valid, false);
});

test('repeated imports produce no changes and check mode accepts the generated files', async (context) => {
  const input = await fixture(context);
  assert.equal((await runHowToCookImport(input)).error, null);
  assert.deepEqual((await runHowToCookImport(input)).data.changedPaths, []);
  assert.equal((await runHowToCookImport({ ...input, check: true })).error, null);
});

test('check mode reports missing output without writing any files', async (context) => {
  const input = await fixture(context);
  const before = await readFile(join(input.dataRoot, 'sources.json'), 'utf8');
  const result = await runHowToCookImport({ ...input, check: true });
  assert.equal(result.error.code, 'import.output_drift');
  assert.equal(result.changedPaths.length, 3);
  assert.equal(await readFile(join(input.dataRoot, 'sources.json'), 'utf8'), before);
});

test('check mode detects an edited generated step', async (context) => {
  const input = await fixture(context);
  await runHowToCookImport(input);
  const path = join(input.dataRoot, 'recipes/howtocook_test_recipe.json');
  const recipe = JSON.parse(await readFile(path, 'utf8'));
  recipe.steps[0].text['zh-CN'] = '被手工改动的步骤';
  await writeFile(path, json(recipe));
  assert.equal((await runHowToCookImport({ ...input, check: true })).error.code, 'import.output_drift');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).steps[0].text['zh-CN'], '被手工改动的步骤');
});

test('rejects a changed snapshot before mutating the catalog', async (context) => {
  await unchangedSources(context, (input) => writeFile(join(input.upstreamRoot, 'snapshot/dishes/test/recipe.md'), `${markdown}漂移`), 'import.hash_mismatch');
});

test('rejects changed license evidence before mutating the catalog', async (context) => {
  await unchangedSources(context, (input) => writeFile(join(input.upstreamRoot, 'snapshot/LICENSE'), 'Changed license'), 'import.hash_mismatch');
});

test('rejects unknown format versions and unpinned branches', async (context) => {
  const input = await fixture(context);
  input.manifest.format_version = 2;
  await input.saveManifest();
  assert.equal((await runHowToCookImport(input)).error.code, 'import.manifest_invalid');
  input.manifest.format_version = 1;
  input.manifest.commit = 'master';
  await input.saveManifest();
  assert.equal((await runHowToCookImport(input)).error.code, 'import.manifest_invalid');
});

test('rejects path traversal, absolute paths and backslash variants', async (context) => {
  const input = await fixture(context);
  for (const path of ['dishes/../outside.md', '/tmp/dishes/recipe.md', 'dishes\\test\\recipe.md', 'dishes/test/../../outside.md']) {
    input.manifest.recipes[0].path = path;
    await input.saveManifest();
    assert.equal((await runHowToCookImport(input)).error.code, 'import.unsafe_path');
  }
});

test('rejects symlinks in snapshot files and their ancestor directories', async (context) => {
  const input = await fixture(context);
  const source = join(input.upstreamRoot, 'snapshot/dishes/test/recipe.md');
  const outside = join(input.temporary, 'outside.md');
  await writeFile(outside, markdown);
  await rm(source);
  await symlink(outside, source);
  assert.equal((await runHowToCookImport(input)).error.code, 'import.unsafe_file');
  await rm(join(input.upstreamRoot, 'snapshot/dishes/test'), { recursive: true });
  await mkdir(join(input.temporary, 'outside'));
  await symlink(join(input.temporary, 'outside'), join(input.upstreamRoot, 'snapshot/dishes/test'));
  assert.equal((await runHowToCookImport(input)).error.code, 'import.unsafe_file');
});

test('rejects oversized snapshots before parsing or hashing', async (context) => {
  await unchangedSources(context, (input) => writeFile(join(input.upstreamRoot, 'snapshot/dishes/test/recipe.md'), 'x'.repeat(256 * 1024 + 1)), 'import.file_too_large');
});

test('rejects invalid quantities in structured annotations', async (context) => {
  await unchangedSources(context, async (input) => {
    input.profile.recipe.requirements[0].quantity.value = -10;
    await input.saveProfile();
  }, 'import.profile_invalid');
});

test('rejects unknown ingredient references before writing any outputs', async (context) => {
  await unchangedSources(context, async (input) => {
    input.profile.recipe.requirements[0].ingredient_id = 'unknown_ingredient';
    await input.saveProfile();
  }, 'import.catalog_invalid');
});

test('rejects silent text overrides and accepts changes carrying an explanation', async (context) => {
  const input = await fixture(context);
  input.profile.steps[0].text_override = '番茄切块，鸡蛋打散。';
  await input.saveProfile();
  assert.equal((await runHowToCookImport(input)).error.code, 'import.profile_invalid');
  input.profile.steps[0].adjustment_reason = '按原文将嵌套说明合并成一句。';
  await input.saveProfile();
  assert.equal((await runHowToCookImport(input)).error, null);
  const recipe = JSON.parse(await readFile(join(input.dataRoot, 'recipes/howtocook_test_recipe.json'), 'utf8'));
  assert.equal(recipe.steps[0].text['zh-CN'], input.profile.steps[0].text_override);
});

test('rejects missing and reordered source steps', async (context) => {
  const input = await fixture(context);
  input.profile.steps.reverse();
  await input.saveProfile();
  assert.equal((await runHowToCookImport(input)).error.code, 'import.step_mapping');
  input.profile.steps.pop();
  await input.saveProfile();
  assert.equal((await runHowToCookImport(input)).error.code, 'import.step_mapping');
});

test('rejects collisions with recipes owned by another source', async (context) => {
  await unchangedSources(context, async (input) => {
    input.profile.recipe.recipe_id = 'tomato_egg';
    await input.saveProfile();
  }, 'import.recipe_collision');
});

test('preserves an unrelated recipe stored under the incoming output filename', async (context) => {
  const input = await fixture(context);
  const path = join(input.dataRoot, 'recipes/howtocook_test_recipe.json');
  await rename(join(input.dataRoot, 'recipes/tomato_egg.json'), path);
  const original = await readFile(path, 'utf8');
  assert.equal((await runHowToCookImport(input)).error.code, 'import.recipe_file_collision');
  assert.equal(await readFile(path, 'utf8'), original);
});

test('rejects collisions with unrelated provenance under the same source ID', async (context) => {
  const input = await fixture(context);
  const path = join(input.dataRoot, 'sources.json');
  const sources = JSON.parse(await readFile(path, 'utf8'));
  sources.push({ ...sources[0], source_id: 'howtocook_test_recipe' });
  await writeFile(path, json(sources));
  assert.equal((await runHowToCookImport(input)).error.code, 'import.source_collision');
  assert.equal(await readFile(path, 'utf8'), json(sources));
});

test('rejects duplicate entries and unsafe profile identifiers', async (context) => {
  const input = await fixture(context);
  input.manifest.recipes.push(input.manifest.recipes[0]);
  await input.saveManifest();
  assert.equal((await runHowToCookImport(input)).error.code, 'import.duplicate_entry');
  input.manifest.recipes.pop();
  input.manifest.recipes[0].profile = '../outside';
  await input.saveManifest();
  assert.equal((await runHowToCookImport(input)).error.code, 'import.manifest_invalid');
});

test('preserves unrelated catalog sources, dishes and recipes during import', async (context) => {
  const input = await fixture(context);
  const before = (await loadCatalog(input.dataRoot)).data;
  assert.equal((await runHowToCookImport(input)).error, null);
  const after = (await loadCatalog(input.dataRoot)).data;
  for (const collection of ['sources', 'dishes', 'recipes']) {
    const id = { sources: 'source_id', dishes: 'dish_id', recipes: 'recipe_id' }[collection];
    for (const record of before[collection]) assert.deepEqual(after[collection].find((item) => item[id] === record[id]), record);
  }
});

test('retains previously imported recipes when they are removed from the manifest', async (context) => {
  const input = await fixture(context);
  const second = structuredClone(input.profile);
  second.recipe.recipe_id = 'howtocook_second_recipe';
  second.recipe.dish_id = 'howtocook_second_dish';
  await writeFile(join(input.upstreamRoot, 'profiles/second_recipe.json'), json(second));
  await writeFile(join(input.upstreamRoot, 'snapshot/dishes/test/second.md'), markdown);
  input.manifest.recipes.push({ path: 'dishes/test/second.md', sha256: hash(markdown), profile: 'second_recipe' });
  await input.saveManifest();
  assert.equal((await runHowToCookImport(input)).error, null);
  input.manifest.recipes.pop();
  await input.saveManifest();
  const result = await runHowToCookImport(input);
  assert.equal(result.error, null);
  assert.deepEqual(result.data.changedPaths, []);
  const loaded = (await loadCatalog(input.dataRoot)).data;
  assert.ok(loaded.recipes.some((recipe) => recipe.recipe_id === second.recipe.recipe_id));
  assert.ok(loaded.sources.some((source) => source.source_id === 'howtocook_second_recipe'));
  assert.ok(loaded.dishes.some((dish) => dish.dish_id === second.recipe.dish_id));
});

test('parses unordered operation items and rejects unsupported free text', () => {
  assert.deepEqual(parseOperationSteps('## 操作\n- 洗菜。\n  沥干水分。\n* 炒菜。', 'test.md').data, ['洗菜。\n沥干水分。', '炒菜。']);
  assert.equal(parseOperationSteps('## 操作\n先洗菜再炒菜。', 'test.md').error.code, 'import.operation_format');
  assert.equal(parseOperationSteps('## 步骤\n1. 洗菜。', 'test.md').error.code, 'import.operation_heading');
});

test('removes paired Markdown emphasis while preserving multiplication symbols', () => {
  const result = parseOperationSteps('## 操作\n1. **食用油**用量为份数 * 13 毫升，鸡蛋为 2*3 个，用量乘积为 2*3*4，以 *大火* 翻炒。', 'test.md');
  assert.equal(result.error, null);
  assert.equal(result.data[0], '食用油用量为份数 * 13 毫升，鸡蛋为 2*3 个，用量乘积为 2*3*4，以 大火 翻炒。');
});
