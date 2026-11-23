/* ============================================================
   05b · Elimina del flujo de contenido el texto original que quedó
   debajo de un bloque «Editar texto», para que al copiar o buscar
   solo aparezca el texto nuevo. Si algo no se puede interpretar,
   no toca nada (el texto viejo sigue tapado visualmente).
   ============================================================ */
function tokenizeContent(s) {
  const toks = []; let i = 0; const n = s.length;
  const ws = c => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';
  const delim = c => '()<>[]{}/%'.includes(c);
  while (i < n) {
    const c = s[i];
    if (ws(c)) { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    const st = i;
    if (c === '(') {
      let depth = 1, out = ''; i++;
      while (i < n && depth) {
        const ch = s[i];
        if (ch === '\\') { out += s[i + 1] || ''; i += 2; continue; }
        if (ch === '(') depth++; else if (ch === ')') { depth--; if (!depth) { i++; break; } }
        out += ch; i++;
      }
      toks.push({ t: 'str', v: out, s: st, e: i }); continue;
    }
    if (c === '<' && s[i + 1] === '<') { toks.push({ t: 'dict<', s: st, e: i + 2 }); i += 2; continue; }
    if (c === '>' && s[i + 1] === '>') { toks.push({ t: 'dict>', s: st, e: i + 2 }); i += 2; continue; }
    if (c === '<') { const j = s.indexOf('>', i); if (j < 0) throw new Error('hex'); toks.push({ t: 'str', v: s.slice(i + 1, j).replace(/\s/g, ''), hex: true, s: st, e: j + 1 }); i = j + 1; continue; }
    if (c === '[' || c === ']') { toks.push({ t: c, s: st, e: i + 1 }); i++; continue; }
    if (c === '{' || c === '}') { i++; continue; }
    if (c === '/') { i++; while (i < n && !ws(s[i]) && !delim(s[i])) i++; toks.push({ t: 'name', v: s.slice(st + 1, i), s: st, e: i }); continue; }
    while (i < n && !ws(s[i]) && !delim(s[i])) i++;
    if (i === st) { i++; continue; }
    const w = s.slice(st, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) { toks.push({ t: 'num', v: parseFloat(w), s: st, e: i }); continue; }
    toks.push({ t: 'op', v: w, s: st, e: i });
    if (w === 'ID') { // imagen en línea: saltar datos binarios hasta EI
      let j = i + 1;
      while (j < n) { const k = s.indexOf('EI', j); if (k < 0) throw new Error('EI'); if (ws(s[k - 1]) && (k + 2 >= n || ws(s[k + 2]))) { i = k + 2; toks.push({ t: 'op', v: 'EI', s: k, e: i }); break; } j = k + 2; }
      if (j >= n) throw new Error('EI');
    }
  }
  return toks;
}
function removeTextInRects(src, rects) {
  const toks = tokenizeContent(src);
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  let Tm = [1, 0, 0, 1, 0, 0], Tlm = Tm, TL = 0, fs = 10;
  const cuts = []; let ops = [];
  const inside = (x, y) => rects.some(r => x >= r[0] - 2 && x <= r[2] + 2 && y >= r[1] - 2 && y <= r[3] + 2);
  const strLen = t => t.t === 'str' ? (t.hex ? t.v.length / 2 : t.v.length) : 0;
  const show = (opTok, nchars) => {
    const m = matMul(Tm, ctm);
    if (inside(m[4], m[5])) cuts.push([ops.length ? ops[0].s : opTok.s, opTok.e]);
    const adv = nchars * fs * 0.5; Tm = matMul([1, 0, 0, 1, adv, 0], Tm);
  };
  for (const tk of toks) {
    if (tk.t !== 'op') { ops.push(tk); continue; }
    const a = ops.filter(x => x.t === 'num').map(x => x.v);
    switch (tk.v) {
      case 'q': stack.push(ctm); break;
      case 'Q': ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; break;
      case 'cm': if (a.length === 6) ctm = matMul(a, ctm); break;
      case 'BT': Tm = Tlm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': if (a.length) fs = a[a.length - 1]; break;
      case 'TL': TL = a[0] || 0; break;
      case 'Td': Tlm = matMul([1, 0, 0, 1, a[0] || 0, a[1] || 0], Tlm); Tm = Tlm; break;
      case 'TD': TL = -(a[1] || 0); Tlm = matMul([1, 0, 0, 1, a[0] || 0, a[1] || 0], Tlm); Tm = Tlm; break;
      case 'Tm': if (a.length === 6) { Tlm = a; Tm = a; } break;
      case 'T*': Tlm = matMul([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm; break;
      case 'Tj': show(tk, ops.reduce((k, x) => k + strLen(x), 0)); break;
      case 'TJ': show(tk, ops.reduce((k, x) => k + strLen(x), 0)); break;
      case "'": case '"': Tlm = matMul([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm; show(tk, ops.reduce((k, x) => k + strLen(x), 0)); break;
    }
    ops = [];
  }
  if (!cuts.length) return null;
  let out = '', pos = 0;
  for (const [a, b] of cuts) { out += src.slice(pos, a); pos = b; }
  return { text: out + src.slice(pos), removed: cuts.length };
}
function stripEditedText(pdf, pg, p) {
  const edits = p.ov.filter(o => o.type === 'textedit');
  if (!edits.length) return 0;
  try {
    const rects = edits.map(o => dispRectToUser(p, o));
    const C = pg.node.Contents(); if (!C) return 0;
    const refs = C instanceof PL.PDFArray ? C.asArray() : [C];
    let src = '';
    for (const r of refs) {
      const st = r instanceof PL.PDFRef ? pdf.context.lookup(r) : r;
      if (!(st instanceof PL.PDFRawStream)) return 0;
      const bytes = PL.decodePDFRawStream(st).decode();
      let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      src += s + '\n';
    }
    const res = removeTextInRects(src, rects); if (!res) return 0;
    const out = new Uint8Array(res.text.length); for (let i = 0; i < out.length; i++) out[i] = res.text.charCodeAt(i) & 255;
    pg.node.set(PL.PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(out)));
    return res.removed;
  } catch (e) { console.warn('No se pudo depurar el texto original:', e); return 0; }
}
