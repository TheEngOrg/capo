import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const f = path.join(os.homedir(), ".teo", "ledger", "ws-go-05a-devtest.jsonl");
const lines = fs.readFileSync(f, "utf8").trim().split("\n");
let ok = true;
lines.forEach((l, i) => {
  try {
    JSON.parse(l);
  } catch (e) {
    ok = false;
    console.error("Bad line", i + 1, e.message);
  }
});
console.log("JSONL valid:", ok, "lines:", lines.length);
lines.forEach((l, i) => {
  const obj = JSON.parse(l);
  console.log(`  line ${i + 1}: seq=${obj.seq} phase=${obj.phase} verdict=${obj.verdict}`);
});
