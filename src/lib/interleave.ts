/**
 * 交错练习（interleaving）：让相邻两张卡尽量来自不同知识点。
 *
 * 主动回忆 + 间隔重复 + 交错练习是三条被反复验证的做法。前两条已经由 FSRS 负责，
 * 这一条必须在出示顺序上做——如果同一知识点的卡片挨着出现，用户是在连续重复同一个检索路径，
 * 记得住是因为刚看过，不是因为会了（这正是「块状练习」效果差的原因）。
 *
 * 贪心策略：每次从未使用的卡片里挑第一张主题与上一张不同的；都相同就退而求其次。
 */
export function interleaveByTopic<T>(
  items: T[],
  topicOf: (item: T) => string,
): T[] {
  if (items.length <= 2) return [...items];

  const remaining = [...items];
  const result: T[] = [];
  let lastTopic: string | null = null;

  while (remaining.length > 0) {
    let pickIndex = remaining.findIndex((item) => topicOf(item) !== lastTopic);
    if (pickIndex === -1) pickIndex = 0;
    const [picked] = remaining.splice(pickIndex, 1);
    result.push(picked);
    lastTopic = topicOf(picked);
  }

  return result;
}
