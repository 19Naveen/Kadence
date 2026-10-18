// Run: node --experimental-strip-types tests/graphLayout.test.ts  (plain asserts, no framework)
import assert from "node:assert/strict";
import { layoutGraph, relatedNodes } from "../src/features/models/layout.ts";

// orders + customers -> orders_enriched -> region_summary ; products is unrelated
const edges = [
  { source: "orders", target: "orders_enriched" },
  { source: "customers", target: "orders_enriched" },
  { source: "orders_enriched", target: "region_summary" },
];
const { positions } = layoutGraph(["region_summary", "orders_enriched", "orders", "customers", "products"], edges);
const x = (id: string) => positions.get(id)!.x;
assert.equal(x("orders"), x("customers"), "sources share the first column");
assert.equal(x("products"), x("orders"), "unconnected datasets sit with the sources");
assert.ok(x("orders_enriched") > x("orders"), "a model sits right of its inputs");
assert.ok(x("region_summary") > x("orders_enriched"), "models of models go further right");

// A cycle must not hang or throw
const cyc = layoutGraph(["a", "b"], [{ source: "a", target: "b" }, { source: "b", target: "a" }]);
assert.equal(cyc.positions.size, 2);

assert.deepEqual([...relatedNodes("orders_enriched", edges)].sort(), ["customers", "orders", "orders_enriched", "region_summary"]);
assert.deepEqual([...relatedNodes("products", edges)], ["products"]);
console.log("graphLayout: ok");
