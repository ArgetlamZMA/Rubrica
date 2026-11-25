/* ============================================================
   05 · Exportación: construir el PDF final con pdf-lib
   ============================================================ */
function stdFontName(fam = 'Helvetica', b, i) {
  const F = PL.StandardFonts;
  if (fam === 'Times') return b && i ? F.TimesRomanBoldItalic : b ? F.TimesRomanBold : i ? F.TimesRomanItalic : F.TimesRoman;
  if (fam === 'Courier') return b && i ? F.CourierBoldOblique : b ? F.CourierBold : i ? F.CourierOblique : F.Courier;
  return b && i ? F.HelveticaBoldOblique : b ? F.HelveticaBold : i ? F.HelveticaOblique : F.Helvetica;
}
async function initMetricFonts() {
  const tmp = await PL.PDFDocument.create();
  for (const fam of ['Helvetica', 'Times', 'Courier']) for (const b of [false, true]) for (const i of [false, true]) {
    const n = stdFontName(fam, b, i); S.metricsFonts[n] = await tmp.embedFont(n);
  }
}
const encCache = new Map();
/** Sustituye caracteres que las fuentes estándar (WinAnsi) no pueden codificar */
function safeText(font, s) {
  s = String(s ?? '').replace(/\r/g, '').replace(/\t/g, '    ');
  let out = '';
  for (const ch of s) {
    if (ch === '\n') { out += ch; continue; }
    const k = font.name + '|' + ch;
    let ok = encCache.get(k);
    if (ok === undefined) { try { font.encodeText(ch); ok = true; } catch { ok = false; } encCache.set(k, ok); }
    out += ok ? ch : (ch.normalize('NFD').replace(/[̀-ͯ]/g, '').length === 1 && (() => { try { font.encodeText(ch.normalize('NFD')[0]); return true; } catch { return false; } })() ? ch.normalize('NFD')[0] : '?');
  }
  return out;
}
function metricFont(fam, b, i) { if (!isStdFont(fam)) { const ent = loadedFont(fam, b, i); return ent ? ent.metric : null; } return S.metricsFonts[stdFontName(fam, b, i)]; }
function metricWidth(text, fam, b, i, size) {
  const f = metricFont(fam, b, i);
  if (!f) { const c = metricWidth.c || (metricWidth.c = el('canvas').getContext('2d')); c.font = `${i ? 'italic ' : ''}${b ? 'bold ' : ''}${size}px ${FONT_CSS[fam] || 'Arial'}`; return c.measureText(text).width; }
  return f.widthOfTextAtSize(safeText(f, text), size);
}
function wrapText(text, fam, b, i, size, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    if (maxW <= 0) { out.push(para); continue; }
    const tokens = para.split(/(\s+)/);
    let line = '';
    for (const tk of tokens) {
      if (!tk) continue;
      const cand = line + tk;
      if (metricWidth(cand.replace(/\s+$/, ''), fam, b, i, size) <= maxW || !line.trim()) {
        if (!line.trim() && metricWidth(tk, fam, b, i, size) > maxW && !/^\s+$/.test(tk)) {
          // palabra más larga que la caja: partir por caracteres
          let part = line;
          for (const ch of tk) { if (metricWidth(part + ch, fam, b, i, size) > maxW && part) { out.push(part); part = ''; } part += ch; }
          line = part;
        } else line = cand;
      } else { out.push(line.replace(/\s+$/, '')); line = /^\s+$/.test(tk) ? '' : tk; }
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}

async function loadLib(src, incremental) {
  const o = { updateMetadata: false, throwOnInvalidObject: false, forIncrementalUpdate: !!incremental };
  try { return await PL.PDFDocument.load(src.bytes, o); }
  catch (e) {
    try { return await PL.PDFDocument.load(src.bytes, { ...o, password: src.password ?? '' }); }
    catch (e2) { throw new Error('No se pudo procesar «' + src.name + '»: ' + (e2.message || e.message)); }
  }
}
function formSafe(v) { const f = S.metricsFonts[PL.StandardFonts.Helvetica]; return f ? safeText(f, v) : String(v); }
function fillForm(pdf, doc, srcId, flatten) {
  const vals = doc.formValues[srcId], orig = doc.formOrig[srcId] || {};
  if (!vals || !Object.keys(vals).length) return;
  let form; try { form = pdf.getForm(); } catch { return; }
  for (const [name, v] of Object.entries(vals)) {
    if (v === orig[name]) continue;
    let f; try { f = form.getField(name); } catch { continue; }
    try {
      if (f instanceof PL.PDFTextField) f.setText(formSafe(v));
      else if (f instanceof PL.PDFCheckBox) v ? f.check() : f.uncheck();
      else if (f instanceof PL.PDFRadioGroup) { if (v) f.select(v); else f.clear(); }
      else if (f instanceof PL.PDFDropdown || f instanceof PL.PDFOptionList) {
        if (!v) f.clear(); else { try { f.select(v); } catch { const o = f.getOptions().find(x => x === v); if (o) f.select(o); } }
      }
    } catch (e) { console.warn('Campo', name, e); }
  }
  if (flatten) { try { form.flatten({ updateFieldAppearances: true }); } catch (e) { console.warn('flatten', e); } }
}
function flattenAll(pdf) { try { const f = pdf.getForm(); if (f.getFields().length) f.flatten({ updateFieldAppearances: true }); } catch (e) { console.warn('flatten', e); } }

async function assetImage(pdf, ctx, doc, assetId) {
  if (ctx.images[assetId]) return ctx.images[assetId];
  const a = doc.assets[assetId]; if (!a) return null;
  const img = /png/i.test(a.mime) ? await pdf.embedPng(a.bytes) : await pdf.embedJpg(a.bytes);
  ctx.images[assetId] = img; return img;
}
async function getFont(pdf, ctx, fam, b, i) {
  if (!isStdFont(fam)) {
    const ent = await ensureFont(fam, b, i);
    if (ent) {
      if (ctx.fonts[ent.key]) return ctx.fonts[ent.key];
      if (!ctx.fk) { pdf.registerFontkit(fontkit); ctx.fk = true; }
      try { return (ctx.fonts[ent.key] = await pdf.embedFont(ent.bytes, { subset: !ent.cff })); }
      catch (e) { console.warn('No se pudo incrustar', fam, e); }
    }
    fam = 'Helvetica';
  }
  const n = stdFontName(fam, b, i);
  return ctx.fonts[n] || (ctx.fonts[n] = await pdf.embedFont(n));
}
function roundRectPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}
async function drawOverlays(pdf, pg, p, ctx, doc) {
  const [, Hc] = dims(p);
  const M = exportMatrix(p);
  const Y = (y, h = 0) => Hc - y - h; // de arriba-izq a eje Y hacia arriba
  pg.pushOperators(PL.pushGraphicsState(), PL.concatTransformationMatrix(...M));
  // 1) capa OCR invisible (debajo de todo)
  // en orden de lectura (líneas de arriba abajo, palabras de izquierda a derecha) para copiar y buscar bien
  const words = p.ov.filter(o => o.type === 'ocrword').sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5 ? a.x - b.x : a.y - b.y));
  if (words.length) {
    const font = await getFont(pdf, ctx, 'Helvetica', false, false);
    pg.setFont(font); const key = pg.fontKey;
    for (const o of words) {
      const t = safeText(font, o.t); if (!t.trim()) continue;
      const size = Math.max(1, o.h * 0.85), w1 = font.widthOfTextAtSize(t, size) || 1;
      pg.pushOperators(PL.pushGraphicsState(), PL.beginText(), PL.setFontAndSize(key, size), PL.setTextRenderingMode(PL.TextRenderingMode.Invisible),
        PL.PDFOperator.of('Tz', [PL.PDFNumber.of(clamp(o.w / w1 * 100, 1, 1000))]), PL.setTextMatrix(1, 0, 0, 1, o.x, Y(o.y) - size * 0.82), PL.showText(font.encodeText(t + ' ')), PL.endText(), PL.popGraphicsState());
    }
  }
  for (const o of p.ov) {
    const op = o.opacity ?? 1, col = o.color ? plRgb(o.color) : PL.rgb(0, 0, 0), sw = o.sw || 1;
    switch (o.type) {
      case 'highlight': pg.drawRectangle({ x: o.x, y: Y(o.y, o.h), width: o.w, height: o.h, color: col, opacity: o.opacity ?? 0.45, blendMode: PL.BlendMode.Multiply }); break;
      case 'whiteout': pg.drawRectangle({ x: o.x, y: Y(o.y, o.h), width: o.w, height: o.h, color: plRgb(o.color || '#ffffff') }); break;
      case 'redact': pg.drawRectangle({ x: o.x, y: Y(o.y, o.h), width: o.w, height: o.h, color: PL.rgb(0, 0, 0) }); break;
      case 'underline': pg.drawLine({ start: { x: o.x, y: Y(o.y + o.h - sw / 2) }, end: { x: o.x + o.w, y: Y(o.y + o.h - sw / 2) }, thickness: sw, color: col, opacity: op }); break;
      case 'strike': pg.drawLine({ start: { x: o.x, y: Y(o.y + o.h / 2) }, end: { x: o.x + o.w, y: Y(o.y + o.h / 2) }, thickness: sw, color: col, opacity: op }); break;
      case 'rect': pg.drawRectangle({ x: o.x + sw / 2, y: Y(o.y, o.h) + sw / 2, width: Math.max(0, o.w - sw), height: Math.max(0, o.h - sw), borderColor: col, borderWidth: sw, color: o.fill ? plRgb(o.fill) : undefined, opacity: op, borderOpacity: op }); break;
      case 'ellipse': pg.drawEllipse({ x: o.x + o.w / 2, y: Y(o.y + o.h / 2), xScale: Math.max(0.1, o.w / 2 - sw / 2), yScale: Math.max(0.1, o.h / 2 - sw / 2), borderColor: col, borderWidth: sw, color: o.fill ? plRgb(o.fill) : undefined, opacity: op, borderOpacity: op }); break;
      case 'line': case 'arrow': {
        const [x1, y1, x2, y2] = lineAbs(o);
        pg.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness: sw, color: col, opacity: op, lineCap: PL.LineCapStyle.Round });
        if (o.type === 'arrow') { const h = arrowHead(x1, y1, x2, y2, sw); pg.drawSvgPath(`M${h[0][0]} ${h[0][1]} L${h[1][0]} ${h[1][1]} L${h[2][0]} ${h[2][1]} Z`, { x: 0, y: Hc, color: col, opacity: op }); }
        break;
      }
      case 'ink': pg.drawSvgPath(smoothPath(inkAbs(o, o.x, o.y)), { x: 0, y: Hc, borderColor: col, borderWidth: sw, borderOpacity: op, borderLineCap: PL.LineCapStyle.Round }); break;
      case 'image': { const img = await assetImage(pdf, ctx, doc, o.asset); if (img) pg.drawImage(img, { x: o.x, y: Y(o.y, o.h), width: o.w, height: o.h, opacity: op }); break; }
      case 'code': await drawCodePdf(pg, o, Y, pdf, ctx); break;
      case 'stamp': {
        const bw = Math.max(1.5, o.h * 0.06), r = o.h * 0.14;
        pg.drawSvgPath(roundRectPath(o.x + bw / 2, o.y + bw / 2, o.w - bw, o.h - bw, r), { x: 0, y: Hc, borderColor: col, borderWidth: bw, opacity: op, borderOpacity: op });
        const font = await getFont(pdf, ctx, 'Helvetica', true, false);
        const sub = o.date || o.who, fs = o.h * (sub ? 0.36 : 0.46), ds = o.h * 0.2;
        const lab = safeText(font, o.label), total = 1.05 * fs + (sub ? 1.05 * ds : 0);
        const top = o.y + (o.h - total) / 2;
        pg.drawText(lab, { x: o.x + (o.w - font.widthOfTextAtSize(lab, fs)) / 2, y: Y(top + 0.8715 * fs), size: fs, font, color: col, opacity: op });
        if (sub) { const f2 = await getFont(pdf, ctx, 'Helvetica', true, false), dt = safeText(f2, o.dateText || todayStr()); pg.drawText(dt, { x: o.x + (o.w - f2.widthOfTextAtSize(dt, ds)) / 2, y: Y(top + 1.05 * fs + 0.8715 * ds), size: ds, font: f2, color: col, opacity: op }); }
        break;
      }
      case 'text': case 'textedit': {
        const fam = o.font || 'Helvetica', font = await getFont(pdf, ctx, fam, o.bold, o.italic);
        const size = o.size, pad = o.pad ?? 2, tcol = plRgb(o.color || '#000');
        if (o.bg) pg.drawRectangle({ x: o.x, y: Y(o.y, o.h), width: o.w, height: o.h, color: plRgb(o.bg), opacity: o.type === 'textedit' ? 1 : op });
        if (o.border) pg.drawRectangle({ x: o.x, y: Y(o.y, o.h), width: o.w, height: o.h, borderColor: plRgb(o.border), borderWidth: 1, borderOpacity: op });
        if (o.rotate) {
          const lines = String(o.text).split('\n'), th = o.rotate * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
          const C = [o.x + o.w / 2, Y(o.y + o.h / 2)], n = lines.length;
          lines.forEach((ln, i) => {
            const t = safeText(font, ln), tw = font.widthOfTextAtSize(t, size), dy = ((n - 1) / 2 - i) * 1.2 * size;
            const lx = -tw / 2, ly = dy - 0.35 * size;
            pg.drawText(t, { x: C[0] + lx * cs - ly * sn, y: C[1] + lx * sn + ly * cs, size, font, color: tcol, opacity: op, rotate: PL.degrees(o.rotate) });
          });
        } else {
          const lines = o.type === 'textedit' ? String(o.text).split('\n') : wrapText(o.text, fam, o.bold, o.italic, size, o.w - 2 * pad);
          lines.forEach((ln, i) => {
            const t = safeText(font, ln); if (!t) return;
            const lw = font.widthOfTextAtSize(t, size);
            const x = o.align === 'center' ? o.x + (o.w - lw) / 2 : o.align === 'right' ? o.x + o.w - pad - lw : o.x + pad;
            pg.drawText(t, { x, y: Y(o.y + pad + (baselineOf(fam, o.bold, o.italic) + 1.2 * i) * size), size, font, color: tcol, opacity: op });
          });
        }
        break;
      }
      case 'note': ctx.notes.push({ pg, o, rect: dispRectToUser(p, o) }); break;
      case 'field': ctx.fields.push({ pg, o, rect: dispRectToUser(p, o), rot: rotT(p) }); break;
    }
  }
  pg.pushOperators(PL.popGraphicsState());
}
function addNoteAnnots(pdf, notes) {
  for (const { pg, o, rect } of notes) {
    const c = hexToRgb(o.color || '#ffd400');
    const dict = pdf.context.obj({
      Type: 'Annot', Subtype: 'Text', Rect: rect, Contents: PL.PDFHexString.fromText(o.text || ''), T: PL.PDFHexString.fromText(o.author || ''),
      Name: 'Comment', C: [c.r, c.g, c.b], F: 4, Open: false, M: PL.PDFString.fromDate(new Date())
    });
    pg.node.addAnnot(pdf.context.register(dict));
  }
}
function addFields(pdf, fields) {
  if (!fields.length) return;
  const form = pdf.getForm();
  const used = new Set(form.getFields().map(f => f.getName()));
  for (const { pg, o, rect, rot } of fields) {
    let name = o.name || 'Campo'; let k = 2; while (used.has(name)) name = (o.name || 'Campo') + '_' + k++; used.add(name);
    const opt = { x: rect[0], y: rect[1], width: rect[2] - rect[0], height: rect[3] - rect[1], borderWidth: 1, borderColor: PL.rgb(0.55, 0.6, 0.68), backgroundColor: PL.rgb(1, 1, 1), rotate: PL.degrees(rot) };
    try {
      if (o.ftype === 'check') { const f = form.createCheckBox(name); f.addToPage(pg, opt); if (o.checked) f.check(); }
      else if (o.ftype === 'drop') { const f = form.createDropdown(name); const ops = String(o.options || '').split('\n').map(s => formSafe(s.trim())).filter(Boolean); if (ops.length) f.addOptions(ops); f.addToPage(pg, opt); }
      else { const f = form.createTextField(name); if (o.multiline) f.enableMultiline(); if (o.value) f.setText(formSafe(o.value)); f.addToPage(pg, opt); }
    } catch (e) { console.warn('campo', name, e); }
  }
}
/** Sustituye páginas por imágenes (redacción permanente / compresión fuerte) */
/**
 * Convierte páginas en imagen (redacción permanente o compresión). keepText: Map índice → recuadros excluidos;
 * el texto de esas páginas se vuelve a escribir como capa invisible, salvo las palabras que tocan un recuadro.
 */
async function rasterizePagesInLib(bytes, indices, dpi = 150, quality = 0.85, progress, keepText = null, { keepAnnots = false } = {}) {
  const pj = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const lib = await PL.PDFDocument.load(bytes, { updateMetadata: false });
  let n = 0, helv = null; const gone = [];
  for (const i of indices) {
    progress && progress(null, (n++ / indices.length) * 100);
    const pg = await pj.getPage(i + 1);
    const vp = pg.getViewport({ scale: dpi / 72 }), vp1 = pg.getViewport({ scale: 1 });
    const cv = el('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const c2 = cv.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, cv.width, cv.height);
    // si las anotaciones se conservan como objetos, no se pintan también en la imagen
    await pg.render({ canvasContext: c2, viewport: vp, annotationMode: keepAnnots ? pdfjsLib.AnnotationMode.DISABLE : pdfjsLib.AnnotationMode.ENABLE }).promise;
    const img = await lib.embedJpg(await canvasToBytes(cv, 'image/jpeg', quality));
    cv.width = cv.height = 0;
    const np = lib.insertPage(i, [vp1.width, vp1.height]);
    np.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    if (keepText && keepText.has(i)) {
      helv = helv || await lib.embedFont(PL.StandardFonts.Helvetica);
      await redrawTextLayer(pg, vp1, np, helv, keepText.get(i) || []);
    }
    if (keepAnnots) {
      // las anotaciones pasan a la página nueva (la rotación y el recorte de la página original se aplican en la vista: mismas coordenadas solo si no hay giro)
      const old = lib.getPage(i + 1).node, ann = old.lookup(PL.PDFName.of('Annots'));
      if (ann instanceof PL.PDFArray && !(lib.getPage(i + 1).getRotation().angle % 360)) {
        const N = PL.PDFName.of, ob = lib.getPage(i + 1).getCropBox();
        for (let k = 0; k < ann.size(); k++) {
          const a = lib.context.lookup(ann.get(k)); if (!(a instanceof PL.PDFDict)) continue;
          a.set(N('P'), np.ref);
          const r = a.lookup(N('Rect')); if (r instanceof PL.PDFArray && r.size() === 4) a.set(N('Rect'), lib.context.obj([0, 1, 2, 3].map(j => r.lookup(j).asNumber() - (j % 2 ? ob.y : ob.x))));
        }
        np.node.set(N('Annots'), ann); old.delete(N('Annots'));
      }
    }
    gone.push(wipePageNode(lib, lib.getPage(i + 1)));
    lib.removePage(i + 1);
  }
  pj.destroy();
  dropWidgets(lib, new Set(gone.flat()));
  pruneUnreachable(lib);
  return lib;
}
/**
 * Escribe el texto de una página de PDF.js como capa invisible (mismo lugar y ancho) sobre la página nueva.
 * exclude: recuadros (coordenadas de la vista) cuyo texto NO debe sobrevivir — cualquier palabra que los toque se omite.
 */
async function redrawTextLayer(pg, vp1, np, font, exclude = []) {
  let tc; try { tc = await pg.getTextContent(); } catch { return 0; }
  const H = vp1.height; let k = 0;
  const boxes = exclude.map(r => ({ x0: r.x - 2, y0: r.y - 2, x1: r.x + r.w + 2, y1: r.y + r.h + 2 }));
  const hits = (x0, y0, x1, y1) => boxes.some(r => !(x1 < r.x0 || x0 > r.x1 || y1 < r.y0 || y0 > r.y1));
  np.setFont(font); const key = np.fontKey;
  const draw = (str, a, b, c, d, e, f, width) => {
    const sx = Math.hypot(a, b), w1 = font.widthOfTextAtSize(str, 1) * sx || 1, tz = clamp(width / w1 * 100, 1, 1000);
    np.pushOperators(PL.beginText(), PL.setFontAndSize(key, 1), PL.setTextRenderingMode(PL.TextRenderingMode.Invisible),
      PL.PDFOperator.of('Tz', [PL.PDFNumber.of(tz)]), PL.setTextMatrix(a, -b, -c, d, e, H - f), PL.showText(font.encodeText(str)), PL.endText());
    k++;
  };
  np.pushOperators(PL.pushGraphicsState());
  for (const it of tc.items) {
    const str = safeText(font, it.str || '').replace(/\n/g, ' ');
    if (!str.trim() || !(it.width > 0)) continue;
    const [a, b, c, d, e, f] = pdfjsLib.Util.transform(vp1.transform, it.transform);
    const sx = Math.hypot(a, b), sy = Math.hypot(c, d); if (!sx || !sy) continue;
    // caja del tramo en la vista: desde la línea base hacia arriba (altura de la fuente) y un poco hacia abajo
    const ux = a / sx, uy = b / sx, vx = -c / sy, vy = -d / sy; // dirección del texto y «arriba»
    const corners = (o0, o1) => [[o0, -0.25], [o1, -0.25], [o0, 1], [o1, 1]].map(([o, h]) => [e + ux * o + vx * h * sy, f + uy * o + vy * h * sy]);
    const bbox = pts => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
    if (!boxes.length || !hits(...bbox(corners(0, it.width)))) { draw(str, a, b, c, d, e, f, it.width); continue; }
    // el tramo toca un recuadro: se escriben solo las palabras que quedan completamente fuera
    const total = font.widthOfTextAtSize(str, 1) || 1;
    for (const m of str.matchAll(/\S+/g)) {
      const o0 = font.widthOfTextAtSize(str.slice(0, m.index), 1) / total * it.width, o1 = font.widthOfTextAtSize(str.slice(0, m.index + m[0].length), 1) / total * it.width;
      if (hits(...bbox(corners(o0, o1)))) continue;
      draw(m[0], a, b, c, d, e + ux * o0, f + uy * o0, o1 - o0);
    }
  }
  np.pushOperators(PL.popGraphicsState());
  return k;
}
/** Vacía una página que se va a quitar (contenido, recursos, anotaciones) para que nada de ella sobreviva en el archivo. Devuelve las anotaciones que tenía. */
function wipePageNode(lib, page) {
  const N = PL.PDFName.of, node = page.node, annots = node.lookup(N('Annots'));
  const refs = [];
  if (annots instanceof PL.PDFArray) for (let k = 0; k < annots.size(); k++) { const a = annots.get(k); if (a instanceof PL.PDFRef) refs.push(a.toString()); }
  for (const key of ['Contents', 'Resources', 'Annots', 'Thumb', 'PieceInfo', 'Metadata', 'B', 'StructParents']) node.delete(N(key));
  return refs;
}
/** Quita del formulario los campos cuyos widgets estaban en páginas convertidas a imagen (ya quedaron dibujados en ella). */
function dropWidgets(lib, refs) {
  if (!refs.size) return;
  const N = PL.PDFName.of, acro = lib.catalog.lookup(N('AcroForm'));
  if (!(acro instanceof PL.PDFDict)) return;
  const prune = (arr) => {
    if (!(arr instanceof PL.PDFArray)) return 0;
    for (let k = arr.size() - 1; k >= 0; k--) {
      const r = arr.get(k), o = r instanceof PL.PDFRef ? lib.context.lookup(r) : r;
      if (r instanceof PL.PDFRef && refs.has(r.toString())) { arr.remove(k); continue; }
      if (o instanceof PL.PDFDict) { const kids = o.lookup(N('Kids')); if (kids instanceof PL.PDFArray && prune(kids) === 0 && kids.size() === 0) arr.remove(k); }
    }
    return arr.size();
  };
  prune(acro.lookup(N('Fields')));
}
/** Elimina los objetos que ya nadie referencia (pdf-lib no los recolecta al guardar). */
function pruneUnreachable(lib) {
  const ctx = lib.context, seen = new Set(), stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info];
  while (stack.length) {
    let o = stack.pop();
    if (!o) continue;
    if (o instanceof PL.PDFRef) { const k = o.toString(); if (seen.has(k)) continue; seen.add(k); o = ctx.lookup(o); }
    if (o instanceof PL.PDFStream) o = o.dict;
    if (o instanceof PL.PDFDict) for (const [, v] of o.entries()) stack.push(v);
    else if (o instanceof PL.PDFArray) for (let k = 0; k < o.size(); k++) stack.push(o.get(k));
  }
  let n = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.toString())) { ctx.delete(ref); n++; }
  return n;
}
function isInPlace(doc) {
  const s0 = doc.sources[doc.pages[0]?.src];
  return !!(doc.pages.length && s0 && s0.kind === 'pdf' && doc.pages.length === s0.numPages && doc.pages.every((p, i) => p.src === s0.id && p.idx === i));
}
/**
 * Construye el PDF final.
 * opts: { noEncrypt, flatten, raster:{dpi,quality}, progress(msg,pct), pages:[indices] }
 */
async function buildPdf(doc, opts = {}) {
  commitEditing();
  const prog = opts.progress || (() => { });
  const pages = opts.pages ? opts.pages.map(i => doc.pages[i]) : doc.pages;
  if (!pages.length) throw new Error('El documento no tiene páginas.');
  const inplace = !opts.pages && isInPlace(doc);
  const redactIdx = pages.map((p, i) => p.ov.some(o => o.type === 'redact') ? i : -1).filter(i => i >= 0);
  const flatten = !!opts.flatten || redactIdx.length > 0 || !!opts.raster;
  let pdf, outPages = [];
  prog('Preparando páginas…', 5);
  if (inplace) {
    const s0 = doc.sources[pages[0].src];
    // documentos firmados: se guardan como actualización incremental para no invalidar las firmas
    var incremental = !!(s0.sigs && s0.sigs.length) && !flatten && !(doc.security && !opts.noEncrypt && !doc.security.inherited);
    pdf = await loadLib(s0, incremental);
    fillForm(pdf, doc, s0.id, flatten);
    outPages = pdf.getPages();
  } else {
    pdf = await PL.PDFDocument.create();
    const libs = {}, firstCopies = {};
    for (const sid of [...new Set(pages.map(p => p.src).filter(Boolean))]) {
      const src = doc.sources[sid]; if (src.kind !== 'pdf') continue;
      const lib = await loadLib(src);
      fillForm(lib, doc, sid, true); flattenAll(lib);
      libs[sid] = lib;
      const uniq = [...new Set(pages.filter(p => p.src === sid).map(p => p.idx))];
      const copied = await pdf.copyPages(lib, uniq);
      firstCopies[sid] = new Map(uniq.map((ix, k) => [ix, copied[k]]));
    }
    let k = 0;
    for (const p of pages) {
      prog(null, 5 + (k++ / pages.length) * 40);
      const src = p.src && doc.sources[p.src];
      if (src && src.kind === 'pdf') {
        const m = firstCopies[src.id]; let cp = m.get(p.idx);
        if (cp) m.delete(p.idx); else [cp] = await pdf.copyPages(libs[src.id], [p.idx]);
        outPages.push(pdf.addPage(cp));
      } else if (src && src.kind === 'image') {
        const pg = pdf.addPage([p.w, p.h]);
        const img = src.mime === 'image/png' ? await pdf.embedPng(src.bytes) : await pdf.embedJpg(src.bytes);
        const r = p.img || { x: 0, y: 0, w: p.w, h: p.h };
        pg.drawImage(img, { x: r.x, y: p.h - r.y - r.h, width: r.w, height: r.h });
        outPages.push(pg);
      } else outPages.push(pdf.addPage([p.w, p.h]));
    }
  }
  const ctx = { fonts: {}, images: {}, notes: [], fields: [] };
  for (let i = 0; i < pages.length; i++) {
    prog('Aplicando cambios…', 45 + (i / pages.length) * 35);
    const p = pages[i], pg = outPages[i];
    pg.setRotation(PL.degrees(rotT(p)));
    if (p.crop) pg.setCropBox(p.bx + p.crop.x, p.by + (p.h - p.crop.y - p.crop.h), p.crop.w, p.crop.h);
    if (p.ov.some(o => o.type === 'textedit') && doc.sources[p.src]?.kind === 'pdf') stripEditedText(pdf, pg, p);
    if (p.ov.length) await drawOverlays(pdf, pg, p, ctx, doc);
  }
  addNoteAnnots(pdf, ctx.notes);
  addFields(pdf, ctx.fields);
  const m = doc.meta || {};
  if (m.title) pdf.setTitle(m.title); if (m.author) pdf.setAuthor(m.author); if (m.subject) pdf.setSubject(m.subject);
  if (m.keywords) pdf.setKeywords(String(m.keywords).split(/[,;]\s*/));
  pdf.setProducer('Rúbrica'); pdf.setModificationDate(new Date());
  const rasterIdx = opts.raster ? pages.map((_, i) => i) : redactIdx;
  if (rasterIdx.length) {
    prog(opts.raster ? 'Comprimiendo páginas…' : 'Aplicando redacción permanente…', 80);
    const tmp = await pdf.save({ useObjectStreams: false, addDefaultPage: false });
    // el texto (también el de OCR) sigue buscable; en páginas con redacción, solo las palabras fuera de los recuadros
    const keep = new Map(rasterIdx.map(i => [i, pages[i].ov.filter(o => o.type === 'redact').map(o => ({ x: o.x, y: o.y, w: o.w, h: o.h }))]));
    pdf = await rasterizePagesInLib(tmp, rasterIdx, opts.raster?.dpi || 150, opts.raster?.quality || 0.85, (mm, pp) => prog(null, 80 + pp * 0.15), keep);
  }
  const sec = doc.security;
  if (typeof incremental !== 'undefined' && incremental) { prog('Guardando…', 97); return await pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: true }); }
  if (sec && !opts.noEncrypt && (sec.userPw || sec.ownerPw)) {
    const pm = sec.perms || {};
    pdf.encrypt({
      userPassword: sec.userPw || '', ownerPassword: sec.ownerPw || sec.userPw || uid() + uid(),
      permissions: { printing: pm.print ? 'highResolution' : false, modifying: !!pm.modify, copying: !!pm.copy, annotating: !!pm.annotate, fillingForms: !!pm.forms, contentAccessibility: true, documentAssembly: !!pm.assemble }
    });
  }
  prog('Guardando…', 97);
  return await pdf.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: true });
}
