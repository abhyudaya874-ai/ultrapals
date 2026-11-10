const ESC: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f" };

/**
 * Pure. The decoded value of the `"text"` key of a JSON object that is still being written, as far as it has arrived. It only ever grows
 * (an unfinished escape waits for its last character), so the UI can show an answer word by word instead of all at once at the end.
 * Returns "" while there is no "text" key yet (a delegate action has none).
 */
export function answerTextSoFar(accum: string): string {
  const m = /"text"\s*:\s*"/.exec(accum);
  if (!m) return "";
  let out = "";
  for (let i = m.index + m[0].length; i < accum.length; i++) {
    const c = accum[i];
    if (c === '"') break;
    if (c !== "\\") { out += c; continue; }
    const n = accum[i + 1];
    if (n === undefined) break;
    if (n === "u") {
      const hex = accum.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ESC[n] ?? n;
    i++;
  }
  return out;
}
