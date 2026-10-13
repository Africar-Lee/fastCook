import { reviewFingerprint } from './catalog-fingerprints.mjs';

function requiredChecks(type) {
  if (type === 'source') return ['structural', 'license'];
  if (type === 'recipe' || type === 'substitution_rule') return ['structural', 'semantic', 'cooking'];
  return ['structural', 'semantic'];
}

function validateSource(source, path, error) {
  if (source.license.state !== 'verified') error('release.license_unverified', `${path}/license/state`, '发布来源必须完成许可核验。');
  if (source.provenance.kind === 'editorial_draft') error('release.editorial_draft', `${path}/provenance/kind`, '编辑草稿来源需要完成权利及内容审核后再发布。');
  if (source.provenance.kind === 'upstream' && !source.revision.snapshot_sha256) {
    error('release.snapshot_missing', `${path}/revision/snapshot_sha256`, '上游来源发布前必须保存固定版本的快照摘要。');
  }
  if (source.license.state === 'verified') {
    error('release.evidence_unverified', `${path}/license/evidence_locator`,
      '许可证据及上游快照尚未接入受控证据包实体验证；仅声明位置和摘要不足以发布。');
  }
}

function validateReviews(record, context, reviews) {
  const { catalog, index, error } = context;
  const hashes = reviewFingerprint(catalog, record.subject_type, record.subject_id, index);
  const current = reviews.filter(review => review.subject_sha256 === hashes.subject_sha256
    && review.dependency_sha256 === hashes.dependency_sha256);
  for (const check of requiredChecks(record.subject_type)) {
    const applicable = current.filter(review => review.check === check);
    const latestTime = applicable.reduce((latest, review) => Math.max(latest, Date.parse(review.reviewed_at)), -Infinity);
    const latest = applicable.filter(review => Date.parse(review.reviewed_at) === latestTime);
    if (latest.length > 0 && latest.every(review => review.outcome === 'approved')) continue;
    const stale = reviews.some(review => review.check === check) && applicable.length === 0;
    const code = stale ? 'release.review_stale' : 'release.review_missing_or_rejected';
    error(code, record.path, `${record.subject_type}/${record.subject_id} 缺少针对当前内容及依赖的有效 ${check} 通过记录。`);
  }
}

export function validateRelease(context) {
  const bySubject = new Map();
  for (const review of context.catalog.reviews) {
    const key = `${review.subject_type}/${review.subject_id}`;
    const reviews = bySubject.get(key) ?? [];
    reviews.push(review);
    bySubject.set(key, reviews);
  }
  for (const [key, record] of context.index) {
    if ('review_state' in record.entity && record.entity.review_state !== 'reviewed') {
      context.error('release.entity_unreviewed', `${record.path}/review_state`, '发布实体必须处于 reviewed 状态。');
    }
    if (record.subject_type === 'source') validateSource(record.entity, record.path, context.error);
    validateReviews(record, context, bySubject.get(key) ?? []);
  }
}
