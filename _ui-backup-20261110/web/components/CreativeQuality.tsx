import type { JobDto } from '../../contracts/jobs';
import '../styles/creative-quality.css';

export function CreativeQuality({ review }: { review: JobDto['creativeReview'] }) {
  if (!review) return null;
  const failures = review.artifacts.flatMap((a) =>
    a.result.checks.filter((c) => c.status === 'fail').map((c) => ({ ...c, assetName: a.name })),
  );
  const passed = review.artifacts.flatMap((a) =>
    a.result.checks.filter((c) => c.status === 'pass').map((c) => ({ ...c, assetName: a.name })),
  );
  const missingMetadata = review.artifacts.flatMap((a) =>
    a.result.checks
      .filter((c) => c.status === 'unknown' && c.method === 'metadata')
      .map((c) => ({ ...c, assetName: a.name })),
  );
  const unknownRules = [...new Set(review.artifacts.flatMap((a) => a.result.unknowns))];
  const incomplete =
    review.artifacts.some((a) => a.result.status === 'incomplete') ||
    !!missingMetadata.length ||
    !!unknownRules.length;
  const checked =
    !!review.artifacts.length && review.artifacts.every((a) => a.result.status === 'checked');
  const manual = [
    ...new Set([
      ...review.visualChecks,
      ...review.artifacts.flatMap((a) =>
        a.result.checks.filter((c) => c.method === 'manual').map((c) => c.message),
      ),
    ]),
  ];
  return (
    <details className="creative-quality">
      <summary>
        {failures.length
          ? `有 ${failures.length} 项规格需要调整`
          : incomplete
            ? '成品规格尚未完整核对'
            : checked
              ? '已核对所列成品规格'
              : '创作依据与成品核对'}
      </summary>
      <p>{review.summary}</p>
      {!!review.assumptions.length && <p>采用的建议：{review.assumptions.join('；')}</p>}
      {!!passed.length && (
        <ul>
          {passed.map((item, index) => (
            <li key={`${item.id}-${index}`}>
              已核对 {item.assetName}：{item.message}
            </li>
          ))}
        </ul>
      )}
      {!!failures.length && (
        <ul role="alert">
          {failures.map((item, index) => (
            <li key={`${item.id}-${index}`}>
              需要调整 {item.assetName}：{item.message}
            </li>
          ))}
        </ul>
      )}
      {!!missingMetadata.length && (
        <>
          <p>尚未取得有效成品信息：</p>
          <ul>
            {missingMetadata.map((item, index) => (
              <li key={`${item.id}-${index}`}>
                {item.assetName}：{item.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {!!unknownRules.length && (
        <>
          <p>适用规则尚未核实：</p>
          <ul>
            {unknownRules.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
      {!!manual.length && (
        <>
          <p>画面内容尚需核对：</p>
          <ul>
            {manual.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
      <small>规格检查不代表商品外观、文案或平台审核已通过。</small>
    </details>
  );
}
