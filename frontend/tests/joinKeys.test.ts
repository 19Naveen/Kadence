// Run: node --experimental-strip-types tests/joinKeys.test.ts  (plain asserts, no framework)
import assert from "node:assert/strict";
import { suggestJoinKeys } from "../src/lib/transforms/joinKeys.ts";

assert.deepEqual(suggestJoinKeys(["order_id", "customer_id", "amount"], ["customer_id", "segment"]), { left_on: "customer_id", right_on: "customer_id" });
assert.deepEqual(suggestJoinKeys(["CustomerId", "Surname"], ["customerid", "City"]), { left_on: "CustomerId", right_on: "customerid" });
assert.deepEqual(suggestJoinKeys(["region", "store_id"], ["store_id", "region"]), { left_on: "store_id", right_on: "store_id" }, "prefers id-like names");
// No shared names: never pair unrelated columns (the RowNumber = Rooms bug)
assert.equal(suggestJoinKeys(["RowNumber", "CustomerId", "Surname"], ["Suburb", "Rooms", "Price"]), null);
assert.equal(suggestJoinKeys([], ["a"]), null);
console.log("joinKeys: ok");
