import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { indexEntities } from './catalog-fingerprints.mjs';
import { validateIds, validateLocales, validateAliases, validateReferences,
  validateRules, validateRecipes } from './catalog-semantics.mjs';
import { validateRelease } from './catalog-release.mjs';

export { fingerprint, reviewFingerprint } from './catalog-fingerprints.mjs';

const schema = JSON.parse(readFileSync(new URL('../../data/schemas/catalog.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);
const validateStructure = ajv.compile(schema);

export function validateCatalog(catalog, { release = false } = {}) {
  if (!validateStructure(catalog)) {
    return { valid: false, errors: validateStructure.errors.map(issue => ({
      code: `schema.${issue.keyword}`, path: issue.instancePath || '/',
      message: `数据结构不符合约束 ${issue.keyword}（${JSON.stringify(issue.params)}）。`,
    })) };
  }
  const errors = [];
  const index = indexEntities(catalog);
  const error = (code, path, message) => errors.push({ code, path, message });
  const reference = (type, id, path) => {
    const record = index.get(`${type}/${id}`);
    if (!record) error('reference.missing_entity', path, `引用的 ${type}/${id} 不存在。`);
    return record?.entity;
  };
  const context = { catalog, index, error, reference };
  validateIds(context);
  validateLocales(context);
  validateAliases(context);
  validateReferences(context);
  validateRules(context);
  validateRecipes(context);
  if (errors.length === 0 && (release || catalog.release_state !== 'draft')) validateRelease(context);
  return { valid: errors.length === 0, errors };
}
