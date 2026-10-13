import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './load-catalog.mjs';
import { validateCatalog } from './validate-catalog.mjs';
import { buildImportedRecipe, buildImportedSource, failure, maximumFileBytes,
  parseOperationSteps, validateImportDocument, validateManifestEntries } from './howtocook-format.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function inspectPath(root, path, allowMissing = false) {
  const segments = path.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    const fullPath = resolve(root, ...segments.slice(0, index + 1));
    const inspected = await lstat(fullPath).then((data) => ({ data }), (error) => ({ error }));
    const final = index === segments.length - 1;
    if (inspected.error?.code === 'ENOENT' && final && allowMissing) return { data: null, error: null };
    if (inspected.error) return failure('import.file_unreadable', path, '无法检查导入文件，请检查文件是否存在及访问权限。');
    const stat = inspected.data;
    if (stat.isSymbolicLink() || (final ? !stat.isFile() : !stat.isDirectory())) {
      return failure('import.unsafe_file', path, '导入路径须使用普通文件和目录，不能包含符号链接。');
    }
    if (final && stat.size > maximumFileBytes) return failure('import.file_too_large', path, '导入文件超过 256 KiB，请检查输入。');
  }
  return { data: true, error: null };
}

async function readBounded(root, path, allowMissing = false) {
  const inspected = await inspectPath(root, path, allowMissing);
  if (inspected.error || inspected.data === null) return inspected;
  const read = await readFile(resolve(root, path)).then((data) => ({ data, error: null }),
    () => failure('import.file_unreadable', path, '读取导入文件失败，请检查文件及访问权限。'));
  if (read.error) return read;
  if (read.data.byteLength > maximumFileBytes) return failure('import.file_too_large', path, '读取的文件超过 256 KiB，请检查输入。');
  return read;
}

async function readJson(root, path, kind) {
  const loaded = await readBounded(root, path);
  if (loaded.error) return loaded;
  let document;
  try {
    document = JSON.parse(loaded.data.toString('utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure('import.invalid_json', path, '导入配置包含无效 JSON，请修正文件。');
  }
  return validateImportDocument(document, kind, path);
}

async function canonicalRoot(path) {
  const inspected = await lstat(path).then((data) => ({ data }), () => ({ data: null }));
  if (!inspected.data?.isDirectory() || inspected.data.isSymbolicLink()) {
    return failure('import.unsafe_root', path, '导入根路径须为已存在的普通目录，不能使用符号链接。');
  }
  return realpath(path).then((data) => ({ data, error: null }),
    () => failure('import.file_unreadable', path, '无法读取导入根目录，请检查访问权限。'));
}

async function readSnapshot(root, path, expectedHash) {
  const loaded = await readBounded(root, `snapshot/${path}`);
  if (loaded.error) return loaded;
  if (sha256(loaded.data) !== expectedHash) return failure('import.hash_mismatch', path, '原文快照与清单 SHA-256 不一致，请确认固定提交的快照，不能直接跳过校验。');
  return { data: loaded.data.toString('utf8'), error: null };
}

async function prepareEntry(root, manifest, entry) {
  const profilePath = `profiles/${entry.profile}.json`;
  const profile = await readJson(root, profilePath, 'profile');
  if (profile.error) return profile;
  const snapshot = await readSnapshot(root, entry.path, entry.sha256);
  if (snapshot.error) return snapshot;
  const parsed = parseOperationSteps(snapshot.data, entry.path);
  if (parsed.error) return parsed;
  const source = buildImportedSource(manifest, entry);
  const recipe = buildImportedRecipe(profile.data, parsed.data, source.source_id, profilePath);
  if (recipe.error) return recipe;
  return { data: { source, recipe: recipe.data, dish: { dish_id: recipe.data.dish_id, names: recipe.data.name } }, error: null };
}

function sameSourceIdentity(previous, source) {
  const withoutCommit = (locator) => locator.replace(/\/blob\/[a-f0-9]{40}\//u, '/blob/');
  return previous.provenance.kind === 'upstream' && previous.provenance.origin === source.provenance.origin
    && withoutCommit(previous.provenance.locator) === withoutCommit(source.provenance.locator);
}

function mergeEntries(catalog, entries) {
  const recipes = new Map(catalog.recipes.map((recipe) => [recipe.recipe_id, recipe]));
  const sources = new Map(catalog.sources.map((source) => [source.source_id, source]));
  const dishes = new Map(catalog.dishes.map((dish) => [dish.dish_id, dish]));
  const importedIds = new Set();
  const batchSources = new Set(entries.map((entry) => entry.source.source_id));
  for (const { source, recipe, dish } of entries) {
    const previous = recipes.get(recipe.recipe_id);
    if (importedIds.has(recipe.recipe_id)) return failure('import.recipe_collision', recipe.recipe_id, '本批标注包含重复菜谱 ID。');
    if (previous && (previous.source_ids.length !== 1 || previous.source_ids[0] !== source.source_id)) {
      return failure('import.recipe_collision', recipe.recipe_id, '菜谱 ID 已被其他来源使用，请为导入菜谱选择独立 ID。');
    }
    const previousSource = sources.get(source.source_id);
    if (previousSource && !sameSourceIdentity(previousSource, source)) return failure('import.source_collision', source.source_id, '来源 ID 已被其他原文使用，不能覆盖。');
    const previousDish = dishes.get(dish.dish_id);
    const otherRecipes = catalog.recipes.some((item) => item.dish_id === dish.dish_id && item.source_ids.some((id) => !batchSources.has(id)));
    if (previousDish && encode(previousDish) !== encode(dish) && otherRecipes) return failure('import.dish_collision', dish.dish_id, '菜名变更会影响其他来源的菜谱，请保留现有菜名或使用独立菜品 ID。');
    importedIds.add(recipe.recipe_id);
    recipes.set(recipe.recipe_id, recipe);
    sources.set(source.source_id, source);
    dishes.set(dish.dish_id, dish);
  }
  return { data: { ...catalog, recipes: [...recipes.values()], sources: [...sources.values()], dishes: [...dishes.values()] }, error: null };
}

async function prepareOutputs(dataRoot, catalog, entries) {
  const outputs = [
    { path: 'sources.json', content: encode(catalog.sources) },
    { path: 'dishes.json', content: encode(catalog.dishes) },
    ...entries.map(({ recipe }) => ({ path: `recipes/${recipe.recipe_id}.json`, content: encode(recipe), recipe })),
  ];
  for (const output of outputs) {
    if (Buffer.byteLength(output.content, 'utf8') > maximumFileBytes) return failure('import.file_too_large', output.path, '生成文件超过导入写入上限，请拆分数据。');
    const previous = await readBounded(dataRoot, output.path, true);
    if (previous.error) return previous;
    if (output.recipe && previous.data !== null) {
      const identity = checkExistingRecipe(previous.data, output.recipe, output.path);
      if (identity.error) return identity;
    }
    output.previous = previous.data;
    output.changed = previous.data?.toString('utf8') !== output.content;
  }
  return { data: outputs, error: null };
}

function checkExistingRecipe(contents, recipe, path) {
  let existing;
  try {
    existing = JSON.parse(contents.toString('utf8'));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure('import.invalid_json', path, '已有菜谱文件包含无效 JSON，请修正后重试。');
  }
  if (existing?.recipe_id !== recipe.recipe_id || !Array.isArray(existing.source_ids)
    || existing.source_ids.length !== 1 || existing.source_ids[0] !== recipe.source_ids[0]) {
    return failure('import.recipe_file_collision', path, '目标文件已保存其他菜谱或来源，不能覆盖，请选择独立的文件名与菜谱 ID。');
  }
  return { data: true, error: null };
}

async function commitOutputs(dataRoot, outputs) {
  const changed = outputs.filter((output) => output.changed);
  const transactionId = randomUUID();
  const staged = [];
  for (const output of changed) {
    const temporary = resolve(dataRoot, `${output.path}.${transactionId}.tmp`);
    const error = await writeFile(temporary, output.content, { flag: 'wx' }).then(() => null, (issue) => issue);
    if (error) {
      await Promise.all(staged.map((item) => rm(item.temporary, { force: true })));
      return failure('import.write_failed', output.path, '准备导入文件失败，数据尚未变更，请检查磁盘空间及目录权限。');
    }
    staged.push({ ...output, temporary });
  }
  const committed = [];
  for (const output of staged) {
    const error = await rename(output.temporary, resolve(dataRoot, output.path)).then(() => null, (issue) => issue);
    if (error) return rollbackOutputs(dataRoot, staged, committed, output.path);
    committed.push(output);
  }
  return { data: changed.map((output) => output.path), error: null };
}

async function rollbackOutputs(dataRoot, staged, committed, path) {
  const restored = await Promise.allSettled(committed.map((output) => output.previous === null
    ? rm(resolve(dataRoot, output.path), { force: true }) : writeFile(resolve(dataRoot, output.path), output.previous)));
  await Promise.allSettled(staged.map((output) => rm(output.temporary, { force: true })));
  const failed = restored.some((result) => result.status === 'rejected');
  return failure(failed ? 'import.rollback_failed' : 'import.write_failed', path, failed
    ? '写入失败且部分文件恢复失败，请恢复 data 备份后重试导入。' : '写入失败，已恢复原有文件，请检查磁盘空间及目录权限。');
}

export async function runHowToCookImport({ upstreamRoot = resolve(projectRoot, 'upstream/howtocook'), dataRoot = resolve(projectRoot, 'data'), check = false } = {}) {
  const roots = await Promise.all([canonicalRoot(upstreamRoot), canonicalRoot(dataRoot)]);
  const rootError = roots.find((root) => root.error);
  if (rootError) return rootError;
  const upstream = roots[0].data;
  const data = roots[1].data;
  const manifest = await readJson(upstream, 'manifest.json', 'manifest');
  if (manifest.error) return manifest;
  const entriesCheck = validateManifestEntries(manifest.data);
  if (entriesCheck.error) return entriesCheck;
  const license = await readSnapshot(upstream, 'LICENSE', manifest.data.license_sha256);
  if (license.error) return license;
  const loaded = await loadCatalog(data);
  if (loaded.error) return loaded;
  const prepared = [];
  for (const entry of manifest.data.recipes) {
    const result = await prepareEntry(upstream, manifest.data, entry);
    if (result.error) return result;
    prepared.push(result.data);
  }
  const merged = mergeEntries(loaded.data, prepared);
  if (merged.error) return merged;
  const validated = validateCatalog(merged.data);
  if (!validated.valid) return { ...failure('import.catalog_invalid', 'data', '合并后的目录校验失败，所有文件均未写入。'), errors: validated.errors };
  const outputs = await prepareOutputs(data, merged.data, prepared);
  if (outputs.error) return outputs;
  const missingExisting = outputs.data.find((output) => output.path.startsWith('recipes/') && output.previous === null
    && loaded.data.recipes.some((recipe) => `recipes/${recipe.recipe_id}.json` === output.path));
  if (missingExisting) return failure('import.recipe_filename', missingExisting.path, '已有菜谱文件名与 ID 不一致，请先修正后再导入。');
  const changedPaths = outputs.data.filter((output) => output.changed).map((output) => output.path);
  if (check && changedPaths.length > 0) return { ...failure('import.output_drift', changedPaths[0], '导入产出与当前数据不一致，请运行导入命令更新后重新校验。'), changedPaths };
  if (!check) {
    const committed = await commitOutputs(data, outputs.data);
    if (committed.error) return committed;
  }
  return { data: { recipes: prepared.length, changedPaths, commit: manifest.data.commit, checked: check }, error: null };
}
