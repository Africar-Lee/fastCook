import { loadCatalog } from './load-catalog.mjs';
import { validateCatalog } from './validate-catalog.mjs';

const argumentsList = process.argv.slice(2);
const unsupported = argumentsList.filter((argument) => argument !== '--release');

if (unsupported.length > 0) {
  console.error('参数无效。使用 npm run data:validate 或 npm run data:check-release。');
  process.exitCode = 2;
} else {
  const loaded = await loadCatalog();
  if (loaded.error) {
    console.error(`${loaded.error.path} [${loaded.error.code}] ${loaded.error.message}`);
    process.exitCode = 1;
  } else {
    const result = validateCatalog(loaded.data, { release: argumentsList.includes('--release') });
    for (const error of result.errors.slice(0, 25)) {
      console.error(`${error.path} [${error.code}] ${error.message}`);
    }
    if (!result.valid) {
      console.error(`校验未通过，共 ${result.errors.length} 项问题。`);
      process.exitCode = 1;
    } else {
      const catalog = loaded.data;
      console.log(`校验通过，${catalog.ingredients.length} 个原料，${catalog.dishes.length} 道菜，${catalog.recipes.length} 个做法，${catalog.substitution_rules.length} 条替代规则。`);
      console.log(`数据版本 ${catalog.dataset_version}，状态 ${catalog.release_state}。结构与语义检查不代表人工审核或实际试做通过。`);
    }
  }
}
