// Hiển thị các đoạn khác nhau giữa hai file HTML (tách theo thẻ). Dùng: node htmldiff.js a.html b.html
const fs = require("fs");
const [a, b] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8").split(/(?=<)/));
let i = 0, j = 0, shown = 0;
while (i < a.length && j < b.length && shown < 20) {
  if (a[i] === b[j]) { i++; j++; continue; }
  // resync: look ahead for the next common token
  let found = false;
  for (let k = 1; k < 60 && !found; k++) {
    if (a[i + k] === b[j]) { console.log("A+", a.slice(i, i + k).join("").slice(0, 300)); i += k; found = true; }
    else if (a[i] === b[j + k]) { console.log("B+", b.slice(j, j + k).join("").slice(0, 300)); j += k; found = true; }
  }
  if (!found) { console.log("A:", a[i].slice(0, 200), "\nB:", b[j].slice(0, 200)); i++; j++; }
  shown++;
}
