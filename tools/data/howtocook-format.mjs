import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const upstreamRepository = 'https://github.com/Anduin2017/HowToCook';
export const maximumFileBytes = 256 * 1024;
export const maximumRecipes = 300;

const catalogSchema = JSON.parse(readFileSync(new URL('../../data/schemas/catalog.schema.json', import.meta.url), 'utf8'));
const recipeSchema = structuredClone(catalogSchema.$defs.Recipe);
const generatedFields = ['steps', 'source_ids', 'review_state'];
recipeSchema.required = recipeSchema.required.filter((key) => !generatedFields.includes(key));
for (const key of generatedFields) delete recipeSchema.properties[key];
recipeSchema.properties.original_locale = { const: 'zh-CN' };
const profileId = { type: 'string', pattern: '^[a-z][a-z0-9_]{0,79}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const manifestSchema = {
  type: 'object', additionalProperties: false,
  required: ['format_version', 'repository', 'commit', 'license_sha256', 'recipes'],
  properties: {
    format_version: { const: 1 }, repository: { const: upstreamRepository },
    commit: { type: 'string', pattern: '^[a-f0-9]{40}$' }, license_sha256: hash,
    recipes: {
      type: 'array', minItems: 1, maxItems: maximumRecipes,
      items: {
        type: 'object', additionalProperties: false, required: ['path', 'sha256', 'profile'],
        properties: {
          path: { type: 'string', minLength: 11, maxLength: 1024 },
          sha256: hash, profile: profileId,
        },
      },
    },
  },
};
const profileSchema = {
  $defs: catalogSchema.$defs,
  type: 'object', additionalProperties: false, required: ['recipe', 'steps'],
  properties: {
    recipe: recipeSchema,
    annotation_notes: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1000 } },
    steps: {
      type: 'array', minItems: 1, maxItems: 60,
      items: {
        type: 'object', additionalProperties: false, required: ['source_step', 'requirement_ids'],
        properties: {
          source_step: { type: 'integer', minimum: 1, maximum: 60 },
          requirement_ids: catalogSchema.$defs.Step.properties.requirement_ids,
          text_override: { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' },
          adjustment_reason: { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' },
        },
        dependentRequired: { text_override: ['adjustment_reason'], adjustment_reason: ['text_override'] },
      },
    },
  },
};
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);
const checkManifest = ajv.compile(manifestSchema);
const checkProfile = ajv.compile(profileSchema);

export function failure(code, path, message) {
  return { data: null, error: { code, path, message } };
}

export function validateImportDocument(document, kind, path) {
  const validate = kind === 'manifest' ? checkManifest : checkProfile;
  if (validate(document)) return { data: document, error: null };
  const issue = validate.errors[0];
  return failure(`import.${kind}_invalid`, `${path}${issue.instancePath}`, `导入配置不符合 ${issue.keyword} 约束，请检查字段和格式版本。`);
}

export function validateManifestEntries(manifest) {
  const profiles = new Set();
  const paths = new Set();
  for (const entry of manifest.recipes) {
    const segments = entry.path.split('/');
    if (segments[0] !== 'dishes' || !entry.path.endsWith('.md') || /[\\\x00-\x1f\x7f]/u.test(entry.path)
      || segments.some((segment) => !segment || segment.startsWith('.'))) {
      return failure('import.unsafe_path', entry.path, '原文路径须为 dishes 目录下的 Markdown 文件，不能包含路径跳转或反斜线。');
    }
    if (profiles.has(entry.profile) || paths.has(entry.path)) {
      return failure('import.duplicate_entry', entry.path, '同一批导入不能重复 profile 或原文路径。');
    }
    profiles.add(entry.profile);
    paths.add(entry.path);
  }
  return { data: manifest, error: null };
}

function plainText(markdown) {
  return markdown.replace(/!\[[^\]]*\]\([^\n)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/gu, '$1')
    .replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/gu, '$1')
    .replace(/(?<![\d*])\*(?![\d*\s])(\S(?:[^*\n]*\S)?)\*(?![\d*])/gu, '$1')
    .replace(/`([^`\n]+)`/gu, '$1')
    .split('\n').map((line) => line.trim()).filter(Boolean).join('\n').trim();
}

export function parseOperationSteps(markdown, path) {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const headings = lines.flatMap((line, index) => /^##\s+操作\s*#*\s*$/u.test(line) ? [index] : []);
  if (headings.length !== 1) return failure('import.operation_heading', path, '原文须包含一个明确的二级“操作”标题，请人工检查来源格式。');
  const steps = [];
  for (const line of lines.slice(headings[0] + 1)) {
    if (/^#{1,2}\s/u.test(line)) break;
    const match = /^(?:\d+[.)]|[-*+])\s+(.+)$/u.exec(line);
    if (match) steps.push(match[1]);
    else if (line.trim() && steps.length > 0 && /^\s+/u.test(line)) steps[steps.length - 1] += `\n${line.trim()}`;
    else if (line.trim() && !/^!\[/u.test(line)) return failure('import.operation_format', path, '操作段落包含未识别的正文，请明确整理步骤后再导入。');
  }
  const cleaned = steps.map(plainText);
  if (cleaned.length === 0 || cleaned.length > 60 || cleaned.some((step) => !step || step.length > 2000)) {
    return failure('import.operation_steps', path, '操作步骤为空、过长或超过数量上限，请检查原文。');
  }
  return { data: cleaned, error: null };
}

export function buildImportedRecipe(profile, sourceSteps, sourceId, path) {
  if (profile.steps.length !== sourceSteps.length || profile.steps.some((step, index) => step.source_step !== index + 1)) {
    return failure('import.step_mapping', path, '标注必须按顺序覆盖原文的全部操作步骤，不能重复或隐式省略。');
  }
  const steps = profile.steps.map((step, index) => ({
    step_id: `step_${index + 1}`,
    text: { 'zh-CN': step.text_override ?? sourceSteps[index] },
    requirement_ids: step.requirement_ids,
  }));
  return { data: { ...profile.recipe, steps, source_ids: [sourceId], review_state: 'pending_review' }, error: null };
}

export function buildImportedSource(manifest, entry) {
  const blobRoot = `${upstreamRepository}/blob/${manifest.commit}`;
  return {
    source_id: `howtocook_${entry.profile}`,
    provenance: { kind: 'upstream', origin: 'Anduin2017/HowToCook', locator: `${blobRoot}/${entry.path.split('/').map(encodeURIComponent).join('/')}`, generation: 'unknown' },
    revision: { identifier: manifest.commit, snapshot_sha256: entry.sha256 },
    license: {
      state: 'pending', identifier: 'Unlicense', evidence_locator: `${blobRoot}/LICENSE`, evidence_sha256: manifest.license_sha256,
      attribution: { 'zh-CN': '菜谱文字来源于 Anduin2017/HowToCook，仓库声明采用 Unlicense；结构化标注为 FastCook 离线整理，尚待复核。' },
    },
  };
}
