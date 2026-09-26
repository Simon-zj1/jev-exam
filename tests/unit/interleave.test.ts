import { describe, expect, it } from "vitest";
import { interleaveByTopic } from "@/lib/interleave";

type Card = { id: string; topic: string };

describe("交错练习排序", () => {
  it("相邻卡片尽量来自不同知识点（同一知识点过多时只能少到最少）", () => {
    const cards: Card[] = [
      { id: "1", topic: "A" },
      { id: "2", topic: "A" },
      { id: "3", topic: "A" },
      { id: "4", topic: "B" },
    ];
    const ordered = interleaveByTopic(cards, (card) => card.topic);
    // 3A + 1B 最少只能剩 1 对相邻同主题（原始顺序是 2 对）
    const adjacentSame = countAdjacentSame(ordered);
    expect(adjacentSame).toBe(1);
    expect(countAdjacentSame(cards)).toBe(2);
    // 不能丢卡
    expect(ordered.map((card) => card.id).sort()).toEqual(["1", "2", "3", "4"]);
  });

  it("只有一个知识点时原样返回，不死循环", () => {
    const cards: Card[] = [
      { id: "1", topic: "A" },
      { id: "2", topic: "A" },
      { id: "3", topic: "A" },
    ];
    const ordered = interleaveByTopic(cards, (card) => card.topic);
    expect(ordered.map((card) => card.id)).toEqual(["1", "2", "3"]);
  });

  it("多个知识点交替出现", () => {
    const cards: Card[] = [
      { id: "1", topic: "A" },
      { id: "2", topic: "A" },
      { id: "3", topic: "B" },
      { id: "4", topic: "B" },
      { id: "5", topic: "C" },
    ];
    const ordered = interleaveByTopic(cards, (card) => card.topic);
    expect(ordered.map((card) => card.topic)).toEqual(["A", "B", "A", "B", "C"]);
  });
});

function countAdjacentSame(cards: Card[]): number {
  let count = 0;
  for (let index = 1; index < cards.length; index += 1) {
    if (cards[index].topic === cards[index - 1].topic) count += 1;
  }
  return count;
}
