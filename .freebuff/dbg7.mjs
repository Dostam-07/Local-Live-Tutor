// Reproduce the private logic manually to find where it goes wrong
const raw = JSON.stringify({ message: "First one. Second one." });
const key = "message";
const needle = `"${key}"`;
const idx = raw.indexOf(needle, 0);
console.log("idx:", idx);
// depth walk
let depth = 0, inString = false, escape = false;
for (let i = 0; i < idx; i++) {
  const ch = raw[i];
  if (inString) {
    if (escape) escape = false;
    else if (ch === "\\") escape = true;
    else if (ch === '"') inString = false;
  } else {
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
}
console.log("depth at match:", depth, "inString:", inString);
