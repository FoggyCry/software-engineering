import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
test("NFR02 50000-question fixture and 100 measured replacements/history queries", async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // Test-only fixture/oracle modules; requests under measurement go through the real Worker.
    const { Client } = await import("/src/client.ts" as string),
      d = await import("/src/domain.ts" as string),
      b = await import("/src/backup.ts" as string);
    const c = new Client();
    await c.call("health.inspect");
    const pr = await c.call("profile.create", {
      epoch: c.epoch,
      nickname: "性能测试",
      grade: 1,
    });
    const template = d.generate(1, ["+", "-"], 30),
      practices: any[] = [];
    for (let i = 0; i < 1667; i++) {
      const n = i === 1666 ? 20 : 30,
        stamp = new Date(Date.UTC(2026, 9, 12, 0, 0, i)).toISOString();
      const qs = (n === 20 ? d.generate(1, ["+", "-"], 20) : template).map(
        (q: any) => ({ ...q, id: crypto.randomUUID(), answer: 0 }),
      );
      practices.push({
        id: crypto.randomUUID(),
        profileId: pr.id,
        gradeSnapshot: 1,
        ruleVersion: 1,
        kind: "normal",
        status: i === 0 ? "draft" : "submitted",
        revision: 0,
        createdAt: stamp,
        updatedAt: stamp,
        submittedAt: i === 0 ? null : stamp,
        submittedDate: i === 0 ? null : d.shanghaiDate(stamp),
        questions: qs,
        result: i === 0 ? null : d.grade(qs),
      });
    }
    const fixture = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      profiles: [b.exportProfile(pr)],
      practices,
      wrongItems: b.projections(practices).wrongs.map(b.exportWrong),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(fixture)).buffer,
      prep = performance.now();
    const preview = await c.call("backup.preview", { bytes });
    await c.call("backup.replace", {
      epoch: c.epoch,
      token: preview.token,
      confirmReplace: true,
    });
    const importMs = performance.now() - prep;
    const gen: number[] = [],
      history: number[] = [],
      submissions: number[] = [];
    let p = practices[0];
    for (let i = 0; i < 105; i++) {
      let t = performance.now();
      p = await c.call("practice.create", {
        epoch: c.epoch,
        profileId: pr.id,
        expectedProfileRevision: 0,
        grade: 1,
        operators: ["+", "-"],
        count: 30,
        replaceDraftId: p.id,
        replaceDraftRevision: p.revision,
      });
      if (i >= 5) gen.push(performance.now() - t);
      t = performance.now();
      await c.call("history.query", {
        profileId: pr.id,
        from: "2026-10-12",
        to: "2026-10-12",
        cursor: null,
        limit: 20,
      });
      if (i >= 5) history.push(performance.now() - t);
    }
    // Rebuild only the test draft and affected projections between samples; not part of measured submit.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("children-arithmetic", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const baselineDerived = b.projections(practices.slice(1));
    for (let i = 0; i < 105; i++) {
      const t = performance.now();
      await c.call("practice.submit", {
        epoch: c.epoch,
        id: p.id,
        expectedRevision: 0,
        answers: p.questions.map((q: any) => ({
          questionId: q.id,
          value: q.expected,
        })),
        confirmBlank: true,
      });
      if (i >= 5) submissions.push(performance.now() - t);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ["practices", "attempts", "wrongItems", "dailyStats"],
          "readwrite",
        );
        tx.objectStore("practices").put({
          ...p,
          status: "draft",
          result: null,
          submittedAt: null,
          submittedDate: null,
          revision: 0,
          draftSlot: p.profileId + ":normal",
        });
        p.questions.forEach((q: any) =>
          tx.objectStore("attempts").delete([p.id, q.id]),
        );
        tx.objectStore("wrongItems").clear();
        baselineDerived.wrongs.forEach((w: any) =>
          tx.objectStore("wrongItems").put(w),
        );
        tx.objectStore("dailyStats").clear();
        baselineDerived.daily.forEach((v: any) =>
          tx.objectStore("dailyStats").put(v),
        );
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    }
    db.close();
    const p95 = (a: number[]) => [...a].sort((a, b) => a - b)[94];
    return {
      browser: navigator.userAgent,
      questionCount: 50000,
      backupBytes: bytes.byteLength,
      importMs,
      generate: { p95: p95(gen), samples: gen },
      history: { p95: p95(history), samples: history },
      submit: { p95: p95(submissions), samples: submissions },
    };
  });
  mkdirSync("work/qa", { recursive: true });
  writeFileSync("work/qa/performance.json", JSON.stringify(result, null, 2));
  expect(result.backupBytes).toBeLessThanOrEqual(50 * 1024 * 1024);
  expect(result.generate.p95).toBeLessThanOrEqual(500);
  expect(result.history.p95).toBeLessThanOrEqual(1000);
  expect(result.submit.p95).toBeLessThanOrEqual(500);
});
