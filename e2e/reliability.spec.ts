import { test, expect } from "@playwright/test";
test("NFR04 100 saved refreshes, 20 aborted submissions and 10 backup roundtrips", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  const ids = await page.evaluate(async () => {
    const { Client } = await import("/src/client.ts" as string);
    const c = new Client();
    await c.call("health.inspect");
    const profile = await c.call("profile.create", {
      epoch: c.epoch,
      nickname: "可靠性测试",
      grade: 1,
    });
    const p = await c.call("practice.create", {
      epoch: c.epoch,
      profileId: profile.id,
      expectedProfileRevision: 0,
      grade: 1,
      operators: ["+", "-"],
      count: 30,
      replaceDraftId: null,
      replaceDraftRevision: null,
    });
    return { profile: profile.id, practice: p.id };
  });
  for (let i = 0; i < 100; i++) {
    await page.evaluate(
      async ({ id, value }) => {
        const { Client } = await import("/src/client.ts" as string);
        const c = new Client();
        const p = await c.call("practice.get", { id });
        await c.call("practice.save", {
          epoch: c.epoch,
          id,
          expectedRevision: p.revision,
          answers: p.questions.map((q: any, j: number) => ({
            questionId: q.id,
            value: j === 0 ? value : null,
          })),
        });
      },
      { id: ids.practice, value: i },
    );
    await page.reload();
    const value = await page.evaluate(async (id) => {
      const { Client } = await import("/src/client.ts" as string);
      const c = new Client();
      return (await c.call("practice.get", { id })).questions[0].answer;
    }, ids.practice);
    expect(value).toBe(i);
  }
  const counts = await page.evaluate(async (ids) => {
    const { Service } = await import("/src/service.ts" as string);
    const s = await Service.create();
    let aborted = 0,
      roundtrips = 0;
    const h = await s.execute("health.inspect", {});
    let epoch = h.epoch;
    for (const at of [
      1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 61, 62, 63, 1,
    ]) {
      const p = (await s.execute("practice.get", { id: ids.practice })).data;
      const original = IDBObjectStore.prototype.put;
      let count = 0;
      IDBObjectStore.prototype.put = function (...args: any[]) {
        const r = original.apply(this, args as any);
        if (++count === at) this.transaction.abort();
        return r;
      };
      try {
        await s.execute("practice.submit", {
          epoch,
          id: p.id,
          expectedRevision: p.revision,
          answers: p.questions.map((q: any) => ({
            questionId: q.id,
            value: 9999,
          })),
          confirmBlank: true,
        });
        throw Error("Expected abort");
      } catch (e) {
        if ((e as Error).message === "Expected abort") throw e;
      } finally {
        IDBObjectStore.prototype.put = original;
      }
      const after = (await s.execute("practice.get", { id: p.id })).data;
      if (
        after.status !== "draft" ||
        after.revision !== p.revision ||
        after.questions[0].answer !== 99
      )
        throw Error("Partial submission observed");
      aborted++;
    }
    for (let i = 0; i < 10; i++) {
      const before = (await s.execute("backup.export", {})).data;
      const snapshot = await s.execute("profile.list", {});
      const cleared = await s.execute("data.delete", {
        epoch,
        target: "all",
        id: null,
        basisChangeSeq: snapshot.changeSeq,
        confirm: true,
      });
      epoch = cleared.epoch;
      const preview = await s.execute("backup.preview", {
        bytes: before.bytes,
      });
      const restored = await s.execute("backup.replace", {
        epoch,
        token: preview.data.token,
        confirmReplace: true,
      });
      epoch = restored.epoch;
      const after = (await s.execute("backup.export", {})).data;
      const a = JSON.parse(new TextDecoder().decode(before.bytes)),
        b = JSON.parse(new TextDecoder().decode(after.bytes));
      delete a.exportedAt;
      delete b.exportedAt;
      if (JSON.stringify(a) !== JSON.stringify(b))
        throw Error("Backup mismatch");
      roundtrips++;
    }
    s.db.close();
    return { aborted, roundtrips };
  }, ids);
  expect(counts).toEqual({ aborted: 20, roundtrips: 10 });
});
