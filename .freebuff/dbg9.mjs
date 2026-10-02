// Walk the scan manually for the trailing "Dr. Smith agrees."
const text = "Pi is about 3.14 roughly. Compare with e.g. circles in class. Dr. Smith agrees.";
let start = 0;
for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  if (ch !== "." && ch !== "!" && ch !== "?") continue;
  if (ch === "." && /\d/.test(text[i-1] ?? "") && /\d/.test(text[i+1] ?? "")) continue;
  if (ch === "." && i === text.length - 1) { console.log("break at end", i); break; }
  const before = text.slice(start, i + 1);
  const word = before.match(/([A-Za-z][A-Za-z.]*)\.$/);
  if (word) console.log("word check at", i, JSON.stringify(word[1]));
}
console.log("last char idx:", text.length - 1, "char:", text[text.length-1]);
