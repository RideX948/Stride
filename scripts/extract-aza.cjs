const fs = require("fs");
const TMP = process.env.TMP || "/tmp";
const src = fs.readFileSync(`${TMP}/chunk_40ga0dd58ygll.js`, "utf8");
// Extract all double-quoted string literals of decent length
const strings = src.match(/"(?:[^"\\]|\\.){10,}"/g) || [];
const text = strings
  .map((s) => {
    try {
      return JSON.parse(s);
    } catch {
      return "";
    }
  })
  .filter(
    (s) =>
      /[a-z]{3}/i.test(s) &&
      !/^\/_next|module__|woff2|chunk|^\$|^function|^use |className/.test(s)
  );
fs.writeFileSync(`${TMP}/aza_strings.txt`, text.join("\n"));
console.log("lines:", text.length);
