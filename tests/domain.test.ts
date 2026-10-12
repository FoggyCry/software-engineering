import { describe, it, expect } from "vitest";
import {
  generate,
  decode,
  poolSize,
  validQuestion,
  key,
  grade,
  normalizeAnswer,
  shanghaiDate,
  reduceWrong,
  attempts,
  type Grade,
  type Op,
  type Practice,
} from "../src/domain";
describe("DT02/BR01-03 ranked finite question pools", () => {
  for (const g of [1, 2, 3] as Grade[])
    for (const op of ["+", "-", "*", "/"] as Op[]) {
      if (g === 1 && (op === "*" || op === "/")) continue;
      it(`${g} ${op} every candidate has valid arithmetic and unique key`, () => {
        const keys = new Set<string>();
        for (let i = 0; i < poolSize(g, op); i++) {
          const [a, b] = decode(g, op, i);
          const answer =
            op === "+"
              ? a + b
              : op === "-"
                ? a - b
                : op === "*"
                  ? a * b
                  : a / b;
          const q = {
            id: "test",
            ordinal: 1,
            sourceGrade: g,
            ruleVersion: 1 as const,
            a,
            b,
            op,
            expected: answer,
            answer: null,
          };
          expect(validQuestion(q)).toBe(true);
          keys.add(key(q));
        }
        expect(keys.size).toBe(poolSize(g, op));
      });
    }
  it("all legal subsets/counts preserve allocation and uniqueness", () => {
    for (const g of [1, 2, 3] as Grade[]) {
      const ops: Op[] = g === 1 ? ["+", "-"] : ["+", "-", "*", "/"];
      for (let mask = 1; mask < 1 << ops.length; mask++)
        for (const n of [10, 20, 30]) {
          const selected = ops.filter((_, i) => mask & (1 << i)),
            q = generate(g, selected, n);
          expect(q).toHaveLength(n);
          expect(new Set(q.map(key)).size).toBe(n);
          selected.forEach((op, i) =>
            expect(q.filter((x) => x.op === op)).toHaveLength(
              Math.floor(n / selected.length) +
                (i < n % selected.length ? 1 : 0),
            ),
          );
        }
    }
  });
});
it("DT03 input, rounding and unanswered distinction", () => {
  expect(normalizeAnswer(" ０００９ ")).toBe(9);
  expect(normalizeAnswer(" ")).toBe(null);
  for (const s of ["-1", "1.5", "1e2", "10000", "12a"])
    expect(() => normalizeAnswer(s)).toThrow();
  const qs = generate(1, ["+", "-"], 30).map((q, i) => ({
    ...q,
    answer: i < 18 ? q.expected : i < 28 ? 9999 : null,
  }));
  expect(grade(qs)).toEqual({
    correctCount: 18,
    wrongCount: 10,
    blankCount: 2,
    answeredCount: 28,
    accuracy: 60,
  });
});
it("DT04 Shanghai midnight is not UTC midnight", () => {
  expect(shanghaiDate("2026-10-11T15:59:00Z")).toBe("2026-10-11");
  expect(shanghaiDate("2026-10-11T16:01:00Z")).toBe("2026-10-12");
});
it("DCR02 only correct review clears wrong status", () => {
  const q = generate(1, ["+"], 10)[0];
  const p = {
    id: "a",
    profileId: "p",
    submittedAt: "2026-10-12T00:00:00.000Z",
    kind: "normal",
    questions: [{ ...q, answer: null }],
  } as Practice;
  const events = attempts(p);
  events.push({ ...events[0], practiceId: "b", answer: q.expected });
  expect(reduceWrong(events)?.needsReview).toBe(true);
  events.push({
    ...events[0],
    practiceId: "c",
    kind: "review",
    answer: q.expected,
  });
  expect(reduceWrong(events)?.needsReview).toBe(false);
  events.push({ ...events[0], practiceId: "d" });
  expect(reduceWrong(events)?.wrongCount).toBe(2);
});
