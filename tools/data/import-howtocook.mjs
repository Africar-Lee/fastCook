import { runHowToCookImport } from './howtocook-import.mjs';

const argumentsList = process.argv.slice(2);
if (argumentsList.some((argument) => argument !== '--check') || argumentsList.length > 1) {
  console.error('参数无效。使用 node tools/data/import-howtocook.mjs [--check]，从本地 upstream/howtocook 导入固定版本快照。');
  process.exitCode = 2;
} else {
  const result = await runHowToCookImport({ check: argumentsList.includes('--check') });
  if (result.error) {
    console.error(`${result.error.path} [${result.error.code}] ${result.error.message}`);
    for (const error of result.errors?.slice(0, 12) ?? []) console.error(`${error.path} [${error.code}] ${error.message}`);
    process.exitCode = 1;
  } else {
    const { recipes, changedPaths, commit, checked } = result.data;
    console.log(`${checked ? '产出核对通过' : '离线导入完成'}，${recipes} 道 HowToCook 菜谱，${changedPaths.length} 个文件变更。`);
    console.log(`固定提交 ${commit}。菜谱及许可证保持待复核状态，导入不代表实际试做通过。`);
  }
}
