// No private/encoded/unknown URL may even open a cache.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
(async () => {
  const listeners = {},
    opened = [];
  vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), {
    URL,
    Response,
    self: {
      location: { origin: "https://sillage.test" },
      addEventListener: (name, fn) => (listeners[name] = fn),
    },
    fetch: async () =>
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
    caches: {
      open: async (name) => {
        opened.push(name);
        return { put: async () => {} };
      },
    },
  });
  for (const path of [
    "/api/export",
    "/api%2Fexport",
    "/api/receipt/id/pdf",
    "/private-report",
    "/index.html?private=true",
  ]) {
    let promise;
    listeners.fetch({
      request: { method: "GET", url: "https://sillage.test" + path },
      respondWith: (p) => (promise = p),
    });
    assert.equal((await promise).status, 200);
    assert.equal(opened.length, 0, path + " must remain network-only");
  }
  let promise;
  listeners.fetch({
    request: { method: "GET", url: "https://sillage.test/css/family.css" },
    respondWith: (p) => (promise = p),
  });
  await promise;
  assert.equal(opened.length, 1, "explicit static shell remains cacheable");
  console.log(
    "OK — le service worker ne met en cache que les ressources publiques explicitement autorisées.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
