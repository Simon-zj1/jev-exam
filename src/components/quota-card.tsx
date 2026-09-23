import { quotaResetInfo, quotaRows } from "@/lib/quota";
import type { UsageSnapshot } from "@/lib/db/types";

/**
 * 额度卡：把「还剩多少、什么时候重置」直接显示出来。
 * 借用的是 Agent 产品里常见的限额卡思路——用量不该藏在设置页的表格里。
 */
export function QuotaCard({
  usage,
  byokActive = false,
  compact = false,
}: {
  usage: UsageSnapshot;
  byokActive?: boolean;
  compact?: boolean;
}) {
  const reset = quotaResetInfo();
  const rows = quotaRows(usage);

  return (
    <div>
      <div className="row row--between" style={{ marginBottom: 10 }}>
        <strong>今日额度</strong>
        <span className="small muted">{reset.label}</span>
      </div>

      <div className="stack">
        {rows.map((row) => (
          <div key={row.kind}>
            <div className="row row--between small">
              <span>
                {row.label}
                {byokActive && row.kind !== "material" ? (
                  <span className="tag tag--model">BYOK 不占额度</span>
                ) : null}
              </span>
              <span className="muted">
                {row.used} / {row.limit}
              </span>
            </div>
            <div className="meter">
              <div
                className={`meter__fill${
                  row.ratio >= 1 ? " meter__fill--err" : row.ratio >= 0.8 ? " meter__fill--warn" : ""
                }`}
                style={{ width: `${Math.round(row.ratio * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {!compact ? (
        <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
          额度按 Asia/Shanghai 自然日重置；配置自带密钥（BYOK）后，出题与判定都不占平台额度。
        </p>
      ) : null}
    </div>
  );
}
