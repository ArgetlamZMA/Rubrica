/* ============================================================
   07b · Códigos QR y de barras (Code 128) como objetos vectoriales
   Se dibujan con rectángulos (nítidos al imprimir) y su contenido se
   puede editar después en el panel de propiedades.
   ============================================================ */
if (typeof qrcode !== 'undefined' && qrcode.stringToBytesFuncs) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

/* ---------- Code 128 (ISO/IEC 15417): juegos B y C ---------- */
const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
/** Valores de símbolo (con inicio, control y parada) para un texto ASCII imprimible. */
function code128Values(text) {
  const s = String(text);
  if (!s.length) throw new Error('Escriba el contenido del código.');
  for (const ch of s) { const c = ch.charCodeAt(0); if (c < 32 || c > 126) throw new Error(`El código de barras solo admite letras sin tilde, números y símbolos básicos (no «${ch}»).`); }
  const digitsAt = i => { let n = 0; while (i + n < s.length && s[i + n] >= '0' && s[i + n] <= '9') n++; return n; };
  const vals = []; let i = 0, set;
  if (digitsAt(0) >= 4 || (digitsAt(0) === s.length && s.length % 2 === 0)) { set = 'C'; vals.push(105); } else { set = 'B'; vals.push(104); }
  while (i < s.length) {
    if (set === 'C') {
      if (digitsAt(i) >= 2) { vals.push(+s.substr(i, 2)); i += 2; continue; }
      vals.push(100); set = 'B'; continue;
    }
    const run = digitsAt(i);
    if (run >= 4 && (run % 2 === 0 || run >= 5)) {
      if (run % 2) { vals.push(s.charCodeAt(i) - 32); i++; }
      vals.push(99); set = 'C'; continue;
    }
    vals.push(s.charCodeAt(i) - 32); i++;
  }
  vals.push(vals.reduce((a, v, k) => a + v * (k || 1), 0) % 103, 106);
  return vals;
}
/** Anchos de barras y espacios (módulos), empezando por barra. */
const code128Widths = text => code128Values(text).flatMap(v => [...C128[v]].map(Number));

/** Geometría del código: { cols, rows, dark: [[x, y, w, h], …] } en módulos, con zona de silencio. */
function codeGeometry(o) {
  if (o.kind === 'qr') {
    const q = qrcode(0, o.ecc || 'M'); q.addData(String(o.data || ''), 'Byte'); q.make();
    const n = q.getModuleCount(), qz = 4, dark = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n;) { if (!q.isDark(r, c)) { c++; continue; } let e = c; while (e < n && q.isDark(r, e)) e++; dark.push([c + qz, r + qz, e - c, 1]); c = e; }
    return { cols: n + 2 * qz, rows: n + 2 * qz, dark };
  }
  const ws = code128Widths(o.data), qz = 10, dark = []; let x = qz;
  ws.forEach((w, k) => { if (k % 2 === 0) dark.push([x, 0, w, 1]); x += w; });
  return { cols: x + qz, rows: 1, dark };
}
const CODE_CAPTION = 0.2; // fracción de la altura para el texto legible bajo el código de barras
function codeLayout(o) {
  const g = codeGeometry(o), cap = o.kind !== 'qr' && o.caption !== false;
  const barH = cap ? o.h * (1 - CODE_CAPTION) : o.h;
  if (o.kind === 'qr') { const m = Math.min(o.w, o.h) / g.cols; return { g, mw: m, mh: m, ox: (o.w - m * g.cols) / 2, oy: (o.h - m * g.rows) / 2, cap: false }; }
  return { g, mw: o.w / g.cols, mh: barH, ox: 0, oy: 0, cap, capSize: o.h * CODE_CAPTION * 0.8 };
}
/** SVG para la vista en pantalla. */
function codeSvg(o) {
  let L; try { L = codeLayout(o); } catch (e) { return `<div class="code-err">${escapeHtml(e.message)}</div>`; }
  const col = o.color || '#000', rects = L.g.dark.map(([x, y, w, h]) => `<rect x="${(L.ox + x * L.mw).toFixed(3)}" y="${(L.oy + y * L.mh).toFixed(3)}" width="${(w * L.mw).toFixed(3)}" height="${(h * L.mh).toFixed(3)}"/>`).join('');
  const cap = L.cap ? `<text x="${o.w / 2}" y="${o.h - L.capSize * 0.25}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${L.capSize}" fill="${col}">${escapeHtml(o.data)}</text>` : '';
  return `<svg viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" shape-rendering="crispEdges" style="position:absolute;inset:0;width:100%;height:100%"><rect width="100%" height="100%" fill="#fff"/><g fill="${col}">${rects}</g>${cap}</svg>`;
}
/** Dibujo en el PDF exportado (Y convierte la coordenada superior de la página a la de PDF). */
async function drawCodePdf(pg, o, Y, pdf, ctx) {
  const L = codeLayout(o), col = plRgb(o.color || '#000');
  pg.drawRectangle({ x: o.x, y: Y(o.y, o.h), width: o.w, height: o.h, color: PL.rgb(1, 1, 1) });
  for (const [x, y, w, h] of L.g.dark) pg.drawRectangle({ x: o.x + L.ox + x * L.mw, y: Y(o.y + L.oy + y * L.mh, h * L.mh), width: w * L.mw, height: h * L.mh, color: col });
  if (L.cap) {
    const font = await getFont(pdf, ctx, 'Helvetica', false, false), t = safeText(font, String(o.data));
    pg.drawText(t, { x: o.x + (o.w - font.widthOfTextAtSize(t, L.capSize)) / 2, y: Y(o.y + o.h - L.capSize * 0.25), size: L.capSize, font, color: col });
  }
}
/** Inserta un código en el centro de la página actual. */
async function insertCodeDialog() {
  const d = D(); if (!d) return;
  const v = await formDialog('Código QR o de barras', [
    { key: 'kind', label: 'Tipo', type: 'select', value: S.toolOpts.code?.kind || 'qr', options: [['qr', 'Código QR'], ['c128', 'Código de barras (Code 128)']] },
    { key: 'data', label: 'Contenido', value: '', placeholder: 'Enlace, número de contenedor, guía, DUCA…' },
    { key: 'caption', label: 'Mostrar el texto bajo el código de barras', type: 'checkbox', value: true },
    { type: 'hint', label: 'El QR admite cualquier texto o enlace. El código de barras admite letras sin tilde, números y símbolos básicos (por ejemplo MSCU7781234 o HN-2026-000123).' }
  ], { ok: 'Insertar', validate: v => { if (!v.data.trim()) return 'Escriba el contenido del código.'; try { codeGeometry({ kind: v.kind, data: v.data.trim() }); } catch (e) { return e.message; } return null; } });
  if (!v) return;
  S.toolOpts.code = { ...(S.toolOpts.code || {}), kind: v.kind }; saveToolOpts();
  const p = d.pages[d.cur], [pw, ph] = dims(p);
  const w = v.kind === 'qr' ? 96 : 220, h = v.kind === 'qr' ? 96 : 64;
  const o = { id: uid(), type: 'code', kind: v.kind, data: v.data.trim(), caption: v.caption, color: '#000000', x: (pw - w) / 2, y: (ph - h) / 2, w, h };
  d.checkpoint(); p.ov.push(o); renderOverlays(p); selectObj(p.id, o.id);
  toast('Código insertado: muévalo o cambie su tamaño en la página.', 'ok');
}
