/* ============================================================
   07i · Modo estudio: resumen de resaltados y notas
   Reúne los resaltados, subrayados, tachados y notas del documento
   (los hechos en Rúbrica y los que ya traía el PDF de otros
   programas), con el texto marcado y su página, y los exporta a
   Word o Markdown para repasar, citar o entregar.
   ============================================================ */
const STUDY_KINDS = { highlight: 'Resaltado', underline: 'Subrayado', strike: 'Tachado', note: 'Nota' };
const STUDY_PLURAL = { highlight: 'Resaltados', underline: 'Subrayados', strike: 'Tachados', note: 'Notas' };
const PDFJS_ANNOT_KIND = { Highlight: 'highlight', Squiggly: 'underline', Underline: 'underline', StrikeOut: 'strike', Text: 'note', FreeText: 'note' };

/** Texto de las palabras que caen dentro de los rectángulos (más de la mitad de su alto y su centro dentro). */
function wordsInRects(words, rects) {
  const inside = w => rects.some(r => {
    const cx = w.x + w.w / 2, ov = Math.min(w.y + w.h, r.y + r.h) - Math.max(w.y, r.y);
    return cx >= r.x - 2 && cx <= r.x + r.w + 2 && ov >= Math.min(w.h, r.h) * 0.5;
  });
  return words.filter(inside).map(w => w.t).join(' ').replace(/\s+([,.;:!?)])/g, '$1').replace(/-\s+(?=[a-záéíóúñü])/g, '');
}
const rgbHex = c => c && c.length >= 3 ? '#' + Array.from(c.slice(0, 3), v => Math.round(v).toString(16).padStart(2, '0')).join('') : null;

/** Lista de anotaciones de estudio: [{ page, kind, color, text, note, author, y }] en orden de lectura. */
async function collectStudyItems(d, { kinds = Object.keys(STUDY_KINDS), progress = () => { } } = {}) {
  const out = [];
  for (let pi = 0; pi < d.pages.length; pi++) {
    progress(tr(`Leyendo la página ${pi + 1} de ${d.pages.length}…`), (pi / d.pages.length) * 100);
    const p = d.pages[pi]; let words = null;
    const W = async () => words || (words = await pageWords(d, p, pi));
    // 1) marcas hechas en Rúbrica: las de varias líneas son varios rectángulos seguidos del mismo tipo y color
    let group = null;
    const flush = async () => { if (!group) return; out.push({ page: pi, kind: group.kind, color: group.color, text: wordsInRects(await W(), group.rects), note: '', author: '', y: group.rects[0].y, x: group.rects[0].x }); group = null; };
    for (const o of p.ov) {
      if (['highlight', 'underline', 'strike'].includes(o.type) && kinds.includes(o.type)) {
        // subrayado y tachado se guardan como una franja: se amplía a la línea de texto
        const r = o.type === 'highlight' ? o : o.type === 'underline' ? { x: o.x, y: o.y - o.h * 1.65, w: o.w, h: o.h * 2.65 } : { x: o.x, y: o.y - o.h * 0.5, w: o.w, h: o.h * 2 };
        const last = group && group.rects.at(-1);
        if (group && group.kind === o.type && group.color === o.color && r.y >= last.y - 1 && r.y - (last.y + last.h) < Math.max(last.h, 8)) group.rects.push(r);
        else { await flush(); group = { kind: o.type, color: o.color, rects: [r] }; }
        continue;
      }
      await flush();
      if (o.type === 'note' && kinds.includes('note') && String(o.text || '').trim()) out.push({ page: pi, kind: 'note', color: o.color, text: '', note: o.text.trim(), author: o.author || '', y: o.y, x: o.x });
    }
    await flush();
    // 2) anotaciones que ya traía el PDF (Acrobat, Edge, lectores de tabletas…)
    const src = d.sources[p.src];
    if (src && src.kind === 'pdf') {
      let anns = [];
      try { anns = await (await src.pdf.getPage(p.idx + 1)).getAnnotations({ intent: 'display' }); } catch { }
      if (anns.length) {
        const pg = await src.pdf.getPage(p.idx + 1), vp = pg.getViewport({ scale: 1, rotation: rotT(p) }), c = cropDisp(p);
        const toRect = ([x1, y1, x2, y2]) => { const [a, b, e, f] = vp.convertToViewportRectangle([x1, y1, x2, y2]); return { x: Math.min(a, e) - c.x, y: Math.min(b, f) - c.y, w: Math.abs(e - a), h: Math.abs(f - b) }; };
        for (const a of anns) {
          const kind = PDFJS_ANNOT_KIND[a.subtype]; if (!kind || !kinds.includes(kind)) continue;
          const note = (a.contentsObj?.str || a.contents || '').trim(), author = a.titleObj?.str || a.title || '';
          let rects = [];
          if (a.quadPoints && a.quadPoints.length) {
            const q = a.quadPoints; // pdf.js 3: [[{x,y}×4], …] o lista plana
            const quads = Array.isArray(q[0]) ? q.map(qq => qq.map(pt => [pt.x, pt.y]).flat()) : Array.from({ length: q.length / 8 }, (_, i) => Array.from(q.slice(i * 8, i * 8 + 8)));
            rects = quads.map(v => toRect([Math.min(v[0], v[2], v[4], v[6]), Math.min(v[1], v[3], v[5], v[7]), Math.max(v[0], v[2], v[4], v[6]), Math.max(v[1], v[3], v[5], v[7])]));
          } else if (a.rect) rects = [toRect(a.rect)];
          if (kind === 'note' && !note) continue;
          const text = kind === 'note' ? '' : wordsInRects(await W(), rects);
          if (kind !== 'note' && !text && !note) continue;
          out.push({ page: pi, kind, color: rgbHex(a.color) || '#ffd400', text, note, author, y: rects[0]?.y ?? 0, x: rects[0]?.x ?? 0, external: true });
        }
      }
    }
  }
  // orden de lectura dentro de cada página
  out.sort((a, b) => a.page - b.page || (Math.abs(a.y - b.y) < 6 ? a.x - b.x : a.y - b.y));
  return out;
}

/* ---------- Exportar ---------- */
function studyMarkdown(d, items, groupBy) {
  const lines = [`# ${tr('Resumen de')} «${baseName(d.name)}»`, '', `_${tr(`${items.length} anotaciones · ${new Date().toLocaleDateString(LOC(), { day: '2-digit', month: 'long', year: 'numeric' })}`)}_`, ''];
  const md = s => String(s).replace(/([\\`*_[\]#|])/g, '\\$1');
  const line = it => {
    const tag = `**${tr(STUDY_KINDS[it.kind])}**`, pg = groupBy === 'page' ? '' : ` _(${tr('p.')} ${it.page + 1})_`;
    if (it.kind === 'note') return `- ${tag}${it.author ? ' (' + md(it.author) + ')' : ''}: ${md(it.note)}${pg}`;
    const t = it.kind === 'highlight' ? `==${md(it.text)}==` : it.kind === 'strike' ? `~~${md(it.text)}~~` : md(it.text);
    return `- ${tag}: ${t}${pg}${it.note ? `\n  - ${tr('Nota')}: ${md(it.note)}` : ''}`;
  };
  const groups = groupBy === 'kind' ? Object.keys(STUDY_KINDS).map(k => [tr(STUDY_PLURAL[k]), items.filter(i => i.kind === k)]) : [...new Set(items.map(i => i.page))].map(pg => [tr(`Página ${pg + 1}`), items.filter(i => i.page === pg)]);
  for (const [h, list] of groups) { if (!list.length) continue; lines.push(`## ${h}`, '', ...list.map(line), ''); }
  return lines.join('\n');
}
async function studyDocx(d, items, groupBy) {
  const z = new JSZip(), W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const run = (t, { b, i, u, s, sz, shade, color } = {}) => `<w:r><w:rPr>${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}${u ? '<w:u w:val="single"/>' : ''}${s ? '<w:strike/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : ''}${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
  const par = (runs, { after = 120, indent = 0, keep = false } = {}) => `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:spacing w:after="${after}"/>${indent ? `<w:ind w:left="${indent}"/>` : ''}</w:pPr>${runs}</w:p>`;
  const light = hex => { const c = hexToRgb01(hex || '#ffd400'); return [c.r, c.g, c.b].map(v => Math.round((v * 0.45 + 0.55) * 255).toString(16).padStart(2, '0')).join('').toUpperCase(); };
  let body = par(run(tr('Resumen de') + ' «' + baseName(d.name) + '»', { b: true, sz: 36 }), { after: 80 })
    + par(run(tr(`${items.length} anotaciones · ${new Date().toLocaleDateString(LOC(), { day: '2-digit', month: 'long', year: 'numeric' })}`), { i: true, color: '666666' }), { after: 240 });
  const item = it => {
    const tag = run(tr(STUDY_KINDS[it.kind]) + (groupBy === 'page' ? '' : ` · ${tr('p.')} ${it.page + 1}`) + ': ', { b: true, color: '555555', sz: 18 });
    if (it.kind === 'note') return par(tag + run(it.note, { i: true }) + (it.author ? run('  — ' + it.author, { color: '888888', sz: 18 }) : ''), { indent: 240 });
    let x = par(tag + run(it.text || '…', { shade: it.kind === 'highlight' ? light(it.color) : null, u: it.kind === 'underline', s: it.kind === 'strike' }), { indent: 240, after: it.note ? 40 : 120 });
    if (it.note) x += par(run(tr('Nota') + ': ', { b: true, sz: 18, color: '555555' }) + run(it.note, { i: true }), { indent: 480 });
    return x;
  };
  const groups = groupBy === 'kind' ? Object.keys(STUDY_KINDS).map(k => [tr(STUDY_PLURAL[k]), items.filter(i => i.kind === k)]) : [...new Set(items.map(i => i.page))].map(pg => [tr(`Página ${pg + 1}`), items.filter(i => i.page === pg)]);
  for (const [h, list] of groups) { if (!list.length) continue; body += par(run(h, { b: true, sz: 26, color: '00866A' }), { after: 80, keep: true }) + list.map(item).join(''); }
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

async function studySummaryDialog() {
  const d = D(); if (!d) return;
  const saved = S.settings.study || {};
  const v = await formDialog('Resumen de resaltados y notas', [
    { type: 'hint', label: 'Reúne lo que marcó en el documento (y lo que ya traía de otros programas) con el texto resaltado y su página, para repasar, citar o entregar.' },
    { key: 'format', label: 'Formato', type: 'select', value: saved.format || 'docx', options: [['docx', 'Word (.docx)'], ['md', 'Markdown (.md, para Obsidian, Notion, GitHub…)'], ['copy', 'Copiar al portapapeles (Markdown)']], row: 'cols' },
    { key: 'groupBy', label: 'Agrupar por', type: 'select', value: saved.groupBy || 'page', options: [['page', 'Página'], ['kind', 'Tipo de marca']], row: 'cols' },
    { type: 'heading', label: 'Incluir' },
    ...Object.entries(STUDY_PLURAL).map(([k, l]) => ({ key: k, label: l, type: 'checkbox', value: saved[k] ?? true }))
  ], { ok: 'Crear resumen' });
  if (!v) return;
  S.settings.study = v; saveSettings();
  const kinds = Object.keys(STUDY_KINDS).filter(k => v[k]);
  let items;
  try { items = await withBusy('Creando el resumen…', upd => collectStudyItems(d, { kinds, progress: upd })); }
  catch (e) { toast(e.message, 'err'); return; }
  if (!items.length) { toast(tr('El documento no tiene resaltados ni notas de los tipos elegidos.'), 'err', 6000); return; }
  const name = baseName(d.name) + '_resumen';
  if (v.format === 'docx') download(await studyDocx(d, items, v.groupBy), name + '.docx');
  else {
    const text = studyMarkdown(d, items, v.groupBy);
    if (v.format === 'copy') { try { await navigator.clipboard.writeText(text); toast(tr(`Resumen copiado: ${items.length} anotaciones.`), 'ok'); } catch { download(new Blob([text], { type: 'text/markdown' }), name + '.md'); } return; }
    download(new Blob([text], { type: 'text/markdown' }), name + '.md');
  }
  toast(tr(`Resumen creado: ${items.length} anotaciones.`), 'ok');
}
