import * as assert from "node:assert/strict";
import { test } from "node:test";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
}

test("does not broadcast a user storage scope change on first same-scope auth restore", async () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  (globalThis as unknown as { window?: unknown }).window = {
    localStorage,
    sessionStorage,
  };

  const storage = await import("./browser-storage.ts");
  const scopes: string[] = [];
  const unsubscribe = storage.onUserStorageScopeChange((scope) => scopes.push(scope));

  storage.notifyUserStorageScopeChanged();
  assert.deepEqual(scopes, []);

  storage.writeJsonStorage("auth_user", { id: "user-1" });
  storage.notifyUserStorageScopeChanged();
  assert.deepEqual(scopes, ["user-1"]);

  storage.notifyUserStorageScopeChanged();
  assert.deepEqual(scopes, ["user-1"]);

  storage.removeStorage("auth_user");
  storage.notifyUserStorageScopeChanged();
  assert.deepEqual(scopes, ["user-1", "local"]);

  unsubscribe();
});
