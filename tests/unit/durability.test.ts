import { describe, expect, test } from "bun:test";
import { requestPersistentStorage } from "../../src/save/durability";

describe("requestPersistentStorage", () => {
  test("reports already-persisted storage without asking again", async () => {
    let persistCalls = 0;
    const status = await requestPersistentStorage({
      persisted: async () => true,
      persist: async () => {
        persistCalls++;
        return true;
      },
    });
    expect(status).toEqual({ supported: true, persisted: true });
    expect(persistCalls).toBe(0);
  });

  test("requests persistence and reports a granted result", async () => {
    const status = await requestPersistentStorage({
      persisted: async () => false,
      persist: async () => true,
    });
    expect(status).toEqual({ supported: true, persisted: true });
  });

  test("a denied request is a normal result, not an error", async () => {
    const status = await requestPersistentStorage({
      persisted: async () => false,
      persist: async () => false,
    });
    expect(status).toEqual({ supported: true, persisted: false });
  });

  test("an unavailable API reports unsupported", async () => {
    // Passing `undefined` explicitly would fall back to the ambient
    // navigator.storage, which varies by runtime — a stubbed object with the
    // methods missing is the deterministic way to test an unavailable API.
    expect(
      await requestPersistentStorage({} as Parameters<typeof requestPersistentStorage>[0]),
    ).toEqual({ supported: false, persisted: false });
  });

  test("a rejecting API never throws", async () => {
    const rejecting = async (): Promise<boolean> => {
      throw new Error("denied");
    };
    expect(await requestPersistentStorage({ persisted: rejecting, persist: rejecting })).toEqual({
      supported: true,
      persisted: false,
    });
    expect(
      await requestPersistentStorage({ persisted: async () => false, persist: rejecting }),
    ).toEqual({ supported: true, persisted: false });
  });

  test("a rejected status query still attempts the persistence request", async () => {
    const status = await requestPersistentStorage({
      persisted: async () => {
        throw new Error("denied");
      },
      persist: async () => true,
    });
    expect(status).toEqual({ supported: true, persisted: true });
  });
});
