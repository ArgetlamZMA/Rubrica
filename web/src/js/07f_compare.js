/* ============================================================
   07f · Comparar dos versiones de un documento
   Texto: diferencia palabra por palabra (Myers) entre el original y
   el revisado. Apariencia: diferencia de píxeles página por página
   (sellos, firmas, imágenes, tachados). El resultado es una copia
   del documento revisado con resaltados, notas con el texto anterior
   y recuadros donde cambió la apariencia.
   ============================================================ */
const CMP_COLORS = { ins: '#2da44e', mod: '#f08c00', del: '#d1242f', vis: '#d1242f' };

/** Palabras de un documento en orden de lectura: [{ t, page, x, y, w, h }] (coordenadas de la página visible). */
async function docWords(d) {
  const out = [];
  for (let pi = 0; pi < d.pages.length; pi++) out.push(...await pageWords(d, d.pages[pi], pi));
  return out;
}
/** Palabras de una página en orden de lectura, con su rectángulo en la página visible. */
async function pageWords(d, p, pi = 0) {
  const out = [];
  const items = (await textItems(d, p)).slice().sort((a, b) => (Math.abs(a.base - b.base) < Math.min(a.size, b.size) * 0.4 ? a.x - b.x : a.base - b.base));
  for (const it of items) {
    const s = it.str.normalize('NFC'), total = metricWidth(s, 'Helvetica', false, false, 10) || 1;
    for (const m of s.matchAll(/\S+/g)) {
      const x0 = metricWidth(s.slice(0, m.index), 'Helvetica', false, false, 10) / total, x1 = metricWidth(s.slice(0, m.index + m[0].length), 'Helvetica', false, false, 10) / total;
      out.push({ t: m[0], page: pi, x: it.x + it.w * x0, y: it.y, w: Math.max(1, it.w * (x1 - x0)), h: it.h });
    }
  }
  return out;
}

/** Diferencia de Myers sobre dos listas de cadenas. Devuelve [{ op: 'eq'|'del'|'ins', a0, a1, b0, b1 }]. */
function diffTokens(A, B, maxD = 3000) {
  let pre = 0; while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0; while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a = A.slice(pre, A.length - suf), b = B.slice(pre, B.length - suf), N = a.length, M = b.length;
  const ops = [];
  const push = (op, a0, a1, b0, b1) => { if (a1 - a0 + b1 - b0 <= 0) return; const l = ops.at(-1); if (l && l.op === op && l.a1 === a0 && l.b1 === b0) { l.a1 = a1; l.b1 = b1; } else ops.push({ op, a0, a1, b0, b1 }); };
  push('eq', 0, pre, 0, pre);
  if (N || M) {
    const off = N + M + 1, V = new Int32Array(2 * off + 1), trace = [];
    let found = false, D = 0;
    for (; D <= N + M && D <= maxD; D++) {
      trace.push(V.slice(off - D - 1, off + D + 2)); // V del paso anterior, k de -D-1 a D+1
      for (let k = -D; k <= D; k += 2) {
        let x = (k === -D || (k !== D && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1, y = x - k;
        while (x < N && y < M && a[x] === b[y]) { x++; y++; }
        V[off + k] = x;
        if (x >= N && y >= M) { found = true; break; }
      }
      if (found) break;
    }
    if (!found) { push('del', pre, pre + N, pre, pre); push('ins', pre + N, pre + N, pre, pre + M); }
    else {
      const steps = []; let x = N, y = M;
      for (let d = D; d >= 0; d--) {
        const v = trace[d], at = k => v[k + d + 1], k = x - y;
        const prevK = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
        const prevX = at(prevK), prevY = prevX - prevK;
        while (x > prevX && y > prevY) { steps.push(['eq', x - 1, y - 1]); x--; y--; }
        if (d > 0) steps.push(x === prevX ? ['ins', x, y - 1] : ['del', x - 1, y]);
        x = prevX; y = prevY;
      }
      steps.reverse();
      for (const [op, i, j] of steps) {
        if (op === 'eq') push('eq', pre + i, pre + i + 1, pre + j, pre + j + 1);
        else if (op === 'del') push('del', pre + i, pre + i + 1, pre + j, pre + j);
        else push('ins', pre + i, pre + i, pre + j, pre + j + 1);
      }
    }
  }
  push('eq', A.length - suf, A.length, B.length - suf, B.length);
  return ops;
}

/** Regiones (en puntos) donde dos páginas se ven distintas. */
async function visualDiff(dA, pA, dB, pB) {
  const [WA, HA] = dims(pA), [WB, HB] = dims(pB);
  if (Math.abs(WA - WB) > 2 || Math.abs(HA - HB) > 2) return { sizeChanged: true, rects: [{ x: 0, y: 0, w: WB, h: HB }] };
  const scale = Math.min(1.4, 900 / Math.max(WB, HB)), ca = el('canvas'), cb = el('canvas');
  await drawPage(dA, pA, scale, ca, 1); await drawPage(dB, pB, scale, cb, 1);
  const w = Math.min(ca.width, cb.width), h = Math.min(ca.height, cb.height);
  const ia = ca.getContext('2d').getImageData(0, 0, w, h).data, ib = cb.getContext('2d').getImageData(0, 0, w, h).data;
  ca.width = cb.width = 0;
  const C = 10, gw = Math.ceil(w / C), gh = Math.ceil(h / C), cnt = new Uint16Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, la = ia[i] * 0.3 + ia[i + 1] * 0.59 + ia[i + 2] * 0.11, lb = ib[i] * 0.3 + ib[i + 1] * 0.59 + ib[i + 2] * 0.11;
    if (Math.abs(la - lb) > 60) cnt[((y / C) | 0) * gw + ((x / C) | 0)]++;
  }
  const on = new Uint8Array(gw * gh); for (let i = 0; i < on.length; i++) on[i] = cnt[i] >= 4 ? 1 : 0;
  // componentes conectados (con un margen de una celda) → recuadros
  const seen = new Uint8Array(gw * gh), rects = [];
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || seen[s]) continue;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, n = 0; const st = [s]; seen[s] = 1;
    while (st.length) {
      const c = st.pop(), cx = c % gw, cy = (c / gw) | 0; n++;
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const q = ny * gw + nx; if (on[q] && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    if (n < 2) continue;
    const pad = 3;
    rects.push({ x: x0 * C / scale - pad, y: y0 * C / scale - pad, w: (x1 - x0 + 1) * C / scale + 2 * pad, h: (y1 - y0 + 1) * C / scale + 2 * pad });
  }
  return { sizeChanged: false, rects };
}

/** Une las palabras consecutivas de una misma línea en rectángulos. */
function wordRects(words) {
  const out = [];
  for (const w of words) {
    const l = out.at(-1);
    if (l && l.page === w.page && Math.abs(l.y - w.y) < w.h * 0.5 && w.x - (l.x + l.w) < w.h * 1.2 && w.x >= l.x) { const r = Math.max(l.x + l.w, w.x + w.w); l.w = r - l.x; l.h = Math.max(l.h, w.h); }
    else out.push({ page: w.page, x: w.x, y: w.y, w: w.w, h: w.h });
  }
  return out;
}
const clip = (s, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Compara dos documentos. Devuelve { doc (copia de B con marcas), changes:[{ kind, page, before, after }], stats, visualPages }.
 */
async function compareDocs(A, B, { text = true, visual = true, progress = () => { } } = {}) {
  progress('Preparando los documentos…', 2);
  const dA = await docFromBytes(A.name, await buildPdf(A, { noEncrypt: true }));
  const dB = await docFromBytes(tr(`Comparación - ${baseName(B.name)}`) + '.pdf', await buildPdf(B, { noEncrypt: true }));
  const changes = [], stats = { ins: 0, del: 0, mod: 0, visual: 0 }, add = (pi, o) => dB.pages[pi]?.ov.push({ id: uid(), ...o });
  // notas en el margen izquierdo, a la altura del cambio, una al lado de otra si coinciden
  const noteSpots = new Map();
  const note = (pi, x, y, textN, color) => {
    const used = noteSpots.get(pi) || noteSpots.set(pi, []).get(pi), ny = Math.max(0, y - 4); let nx = 6;
    while (used.some(u => Math.abs(u.x - nx) < 22 && Math.abs(u.y - ny) < 22)) nx += 24;
    used.push({ x: nx, y: ny });
    add(pi, { type: 'note', x: nx, y: ny, w: 22, h: 22, color, text: textN, author: tr('Comparación') });
  };
  // líneas con cambios de texto: el resto de la línea se desplaza, así que no se repite como cambio visual
  const textBoxes = new Map(), explain = (pi, r) => (textBoxes.get(pi) || textBoxes.set(pi, []).get(pi)).push({ x: -1e4, y: r.y, w: 2e4, h: r.h });
  if (text) {
    progress('Leyendo el texto…', 10);
    const wa = await docWords(dA), wb = await docWords(dB);
    progress('Comparando el texto…', 30);
    const norm = s => s.normalize('NFC');
    const ops = diffTokens(wa.map(w => norm(w.t)), wb.map(w => norm(w.t)));
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i]; if (o.op === 'eq') continue;
      // un borrado seguido de una inserción (o al revés) es una modificación
      let del = o.op === 'del' ? o : null, ins = o.op === 'ins' ? o : null;
      const nx = ops[i + 1];
      if (nx && nx.op !== 'eq' && nx.op !== o.op) { if (nx.op === 'ins') ins = nx; else del = nx; i++; }
      const before = del ? wa.slice(del.a0, del.a1).map(w => w.t).join(' ') : '', after = ins ? wb.slice(ins.b0, ins.b1).map(w => w.t).join(' ') : '';
      if (ins) {
        const kind = del ? 'mod' : 'ins', ws = wb.slice(ins.b0, ins.b1);
        for (const r of wordRects(ws)) { add(r.page, { type: 'highlight', x: r.x - 1, y: r.y, w: r.w + 2, h: r.h, color: CMP_COLORS[kind], opacity: 0.35 }); explain(r.page, r); }
        if (del) note(ws[0].page, ws[0].x, ws[0].y, tr(`Antes: «${clip(before)}»`) + '\n' + tr(`Ahora: «${clip(after)}»`), CMP_COLORS.mod);
        stats[kind] += ws.length; changes.push({ kind, page: ws[0].page, before, after });
      } else {
        // texto eliminado: nota donde estaba (antes de la palabra siguiente que sí está en B)
        const nb = wb[del.b0] || wb[del.b0 - 1], gone = wa.slice(del.a0, del.a1);
        const page = nb ? nb.page : Math.min(gone[0].page, dB.pages.length - 1);
        const at = nb || { x: gone[0].x, y: gone[0].y };
        note(page, at.x, at.y, tr(`Eliminado: «${clip(before)}»`), CMP_COLORS.del);
        if (nb) explain(page, nb);
        stats.del += gone.length; changes.push({ kind: 'del', page, before, after: '' });
      }
    }
  }
  const visualPages = [];
  if (visual) {
    const n = Math.min(dA.pages.length, dB.pages.length);
    for (let i = 0; i < n; i++) {
      progress(`Comparando la apariencia de la página ${i + 1} de ${n}…`, 50 + (i / n) * 45);
      const r = await visualDiff(dA, dA.pages[i], dB, dB.pages[i]);
      const tb = textBoxes.get(i) || [];
      // las diferencias que ya explica un cambio de texto no se repiten
      const inter = (a, b) => !(a.x + a.w < b.x - 4 || b.x + b.w < a.x - 4 || a.y + a.h < b.y - 4 || b.y + b.h < a.y - 4);
      const rest = r.sizeChanged ? r.rects : r.rects.filter(q => !tb.some(t => inter(q, t)));
      if (!rest.length) continue;
      visualPages.push(i); stats.visual += rest.length;
      for (const q of rest) add(i, { type: 'rect', x: q.x, y: q.y, w: q.w, h: q.h, color: CMP_COLORS.vis, sw: 1.5, opacity: 0.9 });
      changes.push({ kind: 'vis', page: i, before: '', after: r.sizeChanged ? tr('Cambió el tamaño de la página') : tr(`${rest.length} zona(s) con cambios de apariencia`) });
    }
  }
  if (dB.pages.length > dA.pages.length) for (let i = dA.pages.length; i < dB.pages.length; i++) { note(i, 30, 30, tr('Página nueva: no está en el documento original.'), CMP_COLORS.ins); changes.push({ kind: 'ins', page: i, before: '', after: tr('Página nueva') }); }
  if (dA.pages.length > dB.pages.length) { const last = dB.pages.length - 1; note(last, 30, 30, tr(`El original tiene ${dA.pages.length - dB.pages.length} página(s) más al final.`), CMP_COLORS.del); changes.push({ kind: 'del', page: last, before: tr(`${dA.pages.length - dB.pages.length} página(s)`), after: '' }); }
  changes.sort((a, b) => a.page - b.page);
  dB.dirty = true;
  return { doc: dB, changes, stats, pagesA: dA.pages.length, pagesB: dB.pages.length };
}

/* ---------- Interfaz ---------- */
async function compareDialog() {
  const docSel = label => el('select', { 'aria-label': label });
  const selA = docSel('Original'), selB = docSel('Versión revisada');
  const fill = () => {
    for (const [s, def] of [[selA, S.docs.length > 1 ? S.docs.length - 2 : 0], [selB, S.docs.length - 1]]) {
      const v = s.value; s.innerHTML = '';
      S.docs.forEach((d, i) => s.append(el('option', { value: d.id, text: d.name })));
      s.value = v && S.docs.some(d => d.id === v) ? v : S.docs[Math.max(0, def)]?.id || '';
    }
    if (D() && S.docs.length > 1 && selB.value === selA.value) selA.value = S.docs.find(d => d.id !== selB.value).id;
  };
  const addFile = async (sel) => { try { for (const f of await pickFiles('local', false)) { const d = await openBytes(f.name, f.bytes, { mime: f.mime }); fill(); sel.value = d.id; } } catch (e) { toast(e.message, 'err'); } };
  const cText = el('input', { type: 'checkbox' }), cVis = el('input', { type: 'checkbox' }); cText.checked = cVis.checked = true;
  const row = (label, sel) => el('div', { class: 'row' }, el('label', { text: label }), el('div', { style: { display: 'flex', gap: '6px' } }, sel, el('button', { class: 'btn sm', type: 'button', html: ic('folder-open') + escapeHtml(tr('Abrir…')), onclick: () => addFile(sel) })));
  fill();
  const body = el('div', { class: 'fm' },
    row('Original (versión anterior)', selA), row('Versión revisada', selB),
    el('label', { class: 'chk' }, cText, el('span', { text: 'Comparar el texto (palabras agregadas, eliminadas y modificadas)' })),
    el('label', { class: 'chk' }, cVis, el('span', { text: 'Comparar la apariencia (sellos, firmas, imágenes, tachados; útil en escaneos)' })),
    el('div', { class: 'hint', text: 'El resultado se abre como una copia de la versión revisada con los cambios marcados: verde = agregado, naranja = modificado (la nota muestra el texto anterior), rojo = eliminado o cambio de apariencia.' }));
  const v = await openModal({ title: 'Comparar documentos', body, buttons: [{ label: 'Cancelar', value: null }, {
    label: 'Comparar', primary: true, onClick: () => {
      if (!selA.value || !selB.value) return (toast('Abra los dos documentos que quiere comparar.', 'err'), false);
      if (selA.value === selB.value) return (toast('Elija dos documentos distintos.', 'err'), false);
      if (!cText.checked && !cVis.checked) return (toast('Elija qué comparar.', 'err'), false);
      return { a: selA.value, b: selB.value };
    } }] }).result;
  if (!v) return;
  const A = S.docs.find(d => d.id === v.a), B = S.docs.find(d => d.id === v.b);
  let r;
  try { r = await withBusy('Comparando…', upd => compareDocs(A, B, { text: cText.checked, visual: cVis.checked, progress: upd })); }
  catch (e) { toast(e.message, 'err', 9000); return; }
  addDoc(r.doc); S.side = 'comments'; S.sideOpen = true; renderSide();
  showCompareSummary(r, A, B);
}

function showCompareSummary(r, A, B) {
  const { stats, changes } = r;
  if (!changes.length) { alertDialog('Comparar documentos', escapeHtml(tr('No se encontraron diferencias entre los dos documentos.'))); return; }
  const lab = { ins: 'Agregado', del: 'Eliminado', mod: 'Modificado', vis: 'Apariencia' };
  const list = el('div', { class: 'cmp-list' });
  for (const c of changes.slice(0, 300)) {
    list.append(el('button', { type: 'button', class: 'cmp-row cmp-' + c.kind, onclick: () => goToPage(c.page, true) },
      el('span', { class: 'cmp-kind', text: lab[c.kind] }), el('span', { class: 'cmp-pg', text: tr(`p. ${c.page + 1}`) }),
      el('span', { class: 'cmp-tx' }, c.before ? el('del', { text: clip(c.before, 120) }) : null, c.before && c.after ? ' → ' : null, c.after ? el('ins', { text: clip(c.after, 120) }) : null)));
  }
  if (changes.length > 300) list.append(el('div', { class: 'hint', text: tr(`… y ${changes.length - 300} cambios más.`) }));
  const summary = [tr(`${stats.ins} palabra(s) agregada(s)`), tr(`${stats.del} eliminada(s)`), tr(`${stats.mod} modificada(s)`), tr(`${stats.visual} zona(s) con cambios de apariencia`)].join(' · ');
  const txt = changes.map(c => `p. ${c.page + 1}\t${tr(lab[c.kind])}\t${c.before}\t${c.after}`).join('\n');
  openModal({ title: 'Resultado de la comparación', wide: true, body: el('div', {},
    el('p', { class: 'hint', text: `${A.name} → ${B.name}` }), el('p', { html: '<b>' + escapeHtml(summary) + '</b>' }), list),
    buttons: [{ label: 'Descargar lista (.csv)', onClick: () => { download(new Blob(['﻿' + ['Página', 'Tipo', 'Antes', 'Ahora'].map(tr).join('\t') + '\n' + txt], { type: 'text/tab-separated-values' }), baseName(B.name) + '_cambios.tsv'); return false; } }, { label: 'Cerrar', primary: true }] });
}
