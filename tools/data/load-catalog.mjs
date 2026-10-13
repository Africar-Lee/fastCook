import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultDataRoot = resolve(projectRoot, 'data');
const maximumFileBytes = 1024 * 1024;
const maximumCatalogBytes = 16 * maximumFileBytes;
const collections = ['ingredients', 'recipes', 'rules', 'templates'];

function failure(code, path, message) {
  return { data: null, error: { code, path, message } };
}

async function inspectFile(root, path) {
  const fullPath = resolve(root, path);
  const actual = await realpath(fullPath).then(
    (data) => ({ data }),
    () => failure('file.unreadable', path, '无法读取文件，请检查文件是否存在及访问权限。'),
  );
  if (actual.error) return actual;
  const distance = relative(root, actual.data);
  if (distance.startsWith('..') || isAbsolute(distance)) {
    return failure('file.outside_root', path, '数据文件必须位于 data 目录内。');
  }
  const result = await lstat(fullPath).then(
    (data) => ({ data }),
    () => failure('file.unreadable', path, '无法检查数据文件，请检查文件及权限。'),
  );
  if (result.error) return result;
  if (!result.data.isFile() || result.data.isSymbolicLink()) {
    return failure('file.unsupported', path, '数据来源须为普通 JSON 文件，不能使用符号链接。');
  }
  if (result.data.size > maximumFileBytes) {
    return failure('file.too_large', path, '单个数据文件超过 1 MiB，请拆分后再校验。');
  }
  return { data: { path, fullPath, size: result.data.size } };
}

async function listCollection(root, collection) {
  const result = await readdir(resolve(root, collection), { withFileTypes: true }).then(
    (data) => ({ data }),
    () => failure('directory.unreadable', collection, '无法读取数据目录，请检查目录是否存在。'),
  );
  if (result.error) return result;
  const entries = result.data.filter((entry) => entry.name.endsWith('.json'));
  if (entries.length > 10000) {
    return failure('directory.too_large', collection, '数据目录超过文件数量上限，请检查输入。');
  }
  return { data: entries.map((entry) => `${collection}/${entry.name}`).sort() };
}

async function parseFile(file) {
  const result = await readFile(file.fullPath, 'utf8').then(
    (data) => ({ data }),
    () => failure('file.unreadable', file.path, '数据文件读取失败，请检查文件及权限。'),
  );
  if (result.error) return result;
  if (Buffer.byteLength(result.data, 'utf8') > maximumFileBytes) {
    return failure('file.too_large', file.path, '读取的文件超过 1 MiB，请拆分后再校验。');
  }
  let parsed;
  try {
    parsed = JSON.parse(result.data);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure('file.invalid_json', file.path, 'JSON 语法无效，请修正该文件。');
  }
  return { data: parsed };
}

function aggregate(metadata, documents, paths) {
  const allowed = new Set(['schema_version', 'dataset_version', 'release_state', 'default_locale', 'notes']);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return failure('metadata.invalid', 'catalog.meta.json', '目录元数据必须为 JSON 对象。');
  }
  if (Object.keys(metadata).some((key) => !allowed.has(key))) {
    return failure('metadata.unknown_field', 'catalog.meta.json', '元数据包含未知字段，实体数据请存入对应目录。');
  }
  const catalog = { ...metadata };
  const mapping = { ingredients: 'ingredients', recipes: 'recipes', rules: 'substitution_rules', templates: 'pantry_templates' };
  for (const [folder, key] of Object.entries(mapping)) {
    const entries = paths.filter((path) => path.startsWith(`${folder}/`));
    const invalid = entries.find((path) => folder === 'recipes' ? Array.isArray(documents.get(path)) : !Array.isArray(documents.get(path)));
    if (invalid) return failure('collection.invalid_shape', invalid, '菜谱文件须为单个对象，其余分类文件须为数组。');
    catalog[key] = entries.flatMap((path) => documents.get(path));
  }
  for (const key of ['dishes', 'sources', 'reviews']) catalog[key] = documents.get(`${key}.json`);
  return { data: catalog, error: null };
}

export async function loadCatalog(dataRoot = defaultDataRoot) {
  const rootResult = await realpath(dataRoot).then(
    (data) => ({ data }),
    () => failure('directory.unreadable', 'data', '找不到数据根目录，请检查项目结构。'),
  );
  if (rootResult.error) return rootResult;
  const root = rootResult.data;
  const listed = await Promise.all(collections.map((collection) => listCollection(root, collection)));
  const listError = listed.find((result) => result.error);
  if (listError) return listError;
  const paths = ['catalog.meta.json', 'dishes.json', 'sources.json', 'reviews.json', ...listed.flatMap((result) => result.data)];
  const inspected = await Promise.all(paths.map((path) => inspectFile(root, path)));
  const inspectError = inspected.find((result) => result.error);
  if (inspectError) return inspectError;
  if (inspected.reduce((total, result) => total + result.data.size, 0) > maximumCatalogBytes) {
    return failure('catalog.too_large', 'data', '数据集超过 16 MiB，请检查是否误放入图片或原始资料。');
  }
  const parsed = await Promise.all(inspected.map((result) => parseFile(result.data)));
  const parseError = parsed.find((result) => result.error);
  if (parseError) return parseError;
  const documents = new Map(paths.map((path, index) => [path, parsed[index].data]));
  return aggregate(documents.get('catalog.meta.json'), documents, paths);
}
