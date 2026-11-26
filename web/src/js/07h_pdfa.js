/* ============================================================
   07h · Guardar como PDF/A-2b (archivo a largo plazo)
   Las páginas que no pueden cumplir (fuentes sin incrustar usadas
   de forma visible, color CMYK, compresión LZW, funciones de
   transferencia o algo que no se pudo interpretar) se convierten en
   imagen RGB con el texto como capa invisible; el resto queda igual.
   Después se agregan metadatos XMP coherentes, el perfil sRGB como
   «output intent», el identificador del archivo y se corrigen las
   anotaciones, los formularios y las capas.
   ============================================================ */
const PDFA_BAD_ANNOTS = new Set(['/Sound', '/Movie', '/Screen', '/3D', '/RichMedia', '/TrapNet', '/FileAttachment']);

function pdfaStreamText(st) {
  const b = st instanceof PL.PDFRawStream ? PL.decodePDFRawStream(st).decode() : st.getContents ? st.getContents() : new Uint8Array();
  let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return s;
}
function pdfaHasFilter(dict, name) {
  const f = dict.lookup(PL.PDFName.of('Filter'));
  const names = f instanceof PL.PDFArray ? f.asArray().map(x => x.toString()) : f ? [f.toString()] : [];
  return names.some(n => n === '/' + name || n === '/LZW' && name === 'LZWDecode');
}
function pdfaFontEmbedded(lib, font) {
  if (!(font instanceof PL.PDFDict)) return false;
  const N = PL.PDFName.of, sub = font.lookup(N('Subtype'))?.toString();
  if (sub === '/Type3') return true;
  let fd = font.lookup(N('FontDescriptor'));
  if (sub === '/Type0') { const ds = font.lookup(N('DescendantFonts')); const d0 = ds instanceof PL.PDFArray ? ds.lookup(0) : null; fd = d0 instanceof PL.PDFDict ? d0.lookup(N('FontDescriptor')) : null; }
  return fd instanceof PL.PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some(k => fd.has(N(k)));
}
function pdfaColorSpaceBad(lib, cs, depth = 0) {
  if (!cs || depth > 4) return false;
  const N = PL.PDFName.of;
  if (cs instanceof PL.PDFName) return cs.toString() === '/DeviceCMYK' || cs.toString() === '/CMYK';
  if (cs instanceof PL.PDFRef) return pdfaColorSpaceBad(lib, lib.context.lookup(cs), depth + 1);
  if (cs instanceof PL.PDFArray) {
    const kind = cs.lookup(0)?.toString();
    if (kind === '/ICCBased') { const st = cs.lookup(1); const n = st?.dict?.lookup(N('N')); return n && n.asNumber && n.asNumber() === 4 ? true : false; }
    if (kind === '/Indexed') return pdfaColorSpaceBad(lib, cs.get(1), depth + 1);
    if (kind === '/Separation' || kind === '/DeviceN') return pdfaColorSpaceBad(lib, cs.get(kind === '/Separation' ? 2 : 2), depth + 1);
    if (kind === '/Pattern' && cs.size() > 1) return pdfaColorSpaceBad(lib, cs.get(1), depth + 1);
  }
  return false;
}

/** Motivos por los que una página no puede quedar como está en PDF/A-2b (conjunto vacío = cumple). */
function pdfaPageProblems(lib, page) {
  const N = PL.PDFName.of, ctx = lib.context, why = new Set(), seen = new Set();
  const look = (dict, key) => { const v = dict instanceof PL.PDFDict ? dict.lookup(N(key)) : null; return v instanceof PL.PDFDict ? v : null; };
  const scan = (streams, res, tr0, depth) => {
    if (depth > 8) { why.add('parse'); return; }
    let src = '';
    for (const st of streams) { if (st?.dict && pdfaHasFilter(st.dict, 'LZWDecode')) why.add('lzw'); src += pdfaStreamText(st) + '\n'; }
    const fonts = look(res, 'Font'), xobjs = look(res, 'XObject'), css = look(res, 'ColorSpace'), gss = look(res, 'ExtGState'), shs = look(res, 'Shading');
    let toks; try { toks = tokenizeContent(src); } catch { why.add('parse'); return; }
    const stack = []; let tr = tr0, font = null; const args = [];
    let inInline = false;
    for (const t of toks) {
      if (t.t !== 'op') { args.push(t); continue; }
      const op = t.v;
      if (op === 'BI') { inInline = true; args.length = 0; continue; }
      if (op === 'ID') { if (args.some(a => a.t === 'name' && /^(CMYK|DeviceCMYK)$/.test(a.v))) why.add('cmyk'); if (args.some(a => a.t === 'name' && /^(LZW|LZWDecode)$/.test(a.v))) why.add('lzw'); args.length = 0; continue; }
      if (op === 'EI') { inInline = false; args.length = 0; continue; }
      if (inInline) continue;
      switch (op) {
        case 'q': stack.push(tr); break;
        case 'Q': tr = stack.length ? stack.pop() : tr; break;
        case 'Tr': tr = args.at(-1)?.v ?? tr; break;
        case 'Tf': font = args.find(a => a.t === 'name')?.v ?? font; break;
        case 'Tj': case 'TJ': case "'": case '"':
          if (tr !== 3) { const fd = fonts && font ? fonts.lookup(N(font)) : null; if (!pdfaFontEmbedded(lib, fd)) why.add('font'); }
          break;
        case 'k': case 'K': why.add('cmyk'); break;
        case 'cs': case 'CS': {
          const nm = args.find(a => a.t === 'name')?.v;
          if (nm === 'DeviceCMYK' || (css && nm && pdfaColorSpaceBad(lib, css.get(N(nm))))) why.add('cmyk');
          break;
        }
        case 'gs': {
          const g = gss && args[0]?.t === 'name' ? gss.lookup(N(args[0].v)) : null;
          if (g instanceof PL.PDFDict) {
            for (const k of ['TR', 'TR2']) { const v = g.lookup(N(k)); if (v && v.toString() !== '/Default') why.add('other'); }
            const bm = g.lookup(N('BM'))?.toString();
            if (bm && !['/Normal', '/Compatible', '/Multiply', '/Screen', '/Overlay', '/Darken', '/Lighten', '/ColorDodge', '/ColorBurn', '/HardLight', '/SoftLight', '/Difference', '/Exclusion', '/Hue', '/Saturation', '/Color', '/Luminosity'].includes(bm)) why.add('other');
          }
          break;
        }
        case 'sh': { const s = shs && args[0]?.t === 'name' ? shs.lookup(N(args[0].v)) : null; const d = s instanceof PL.PDFStream ? s.dict : s; if (d instanceof PL.PDFDict && pdfaColorSpaceBad(lib, d.get(N('ColorSpace')))) why.add('cmyk'); break; }
        case 'Do': {
          const nm = args.find(a => a.t === 'name')?.v, ref = xobjs && nm ? xobjs.get(N(nm)) : null, x = ref ? ctx.lookup(ref) : null;
          if (!(x instanceof PL.PDFStream)) break;
          const st = x.dict.lookup(N('Subtype'))?.toString();
          if (st === '/Image') {
            if (pdfaColorSpaceBad(lib, x.dict.get(N('ColorSpace'))) || pdfaHasFilter(x.dict, 'LZWDecode')) why.add(pdfaHasFilter(x.dict, 'LZWDecode') ? 'lzw' : 'cmyk');
            if (x.dict.has(N('Alternates')) || x.dict.has(N('OPI'))) why.add('other');
          } else if (st === '/Form') {
            const key = ref.toString() + ':' + tr; if (seen.has(key)) break; seen.add(key);
            if (x.dict.has(N('OPI')) || x.dict.lookup(N('Subtype2'))?.toString() === '/PS') why.add('other');
            const r2 = x.dict.lookup(N('Resources'));
            scan([x], r2 instanceof PL.PDFDict ? r2 : res, tr, depth + 1);
          } else if (st === '/PS') why.add('other');
          break;
        }
      }
      args.length = 0;
    }
  };
  const C = page.node.Contents();
  const streams = !C ? [] : C instanceof PL.PDFArray ? C.asArray().map(r => ctx.lookup(r)) : [C instanceof PL.PDFRef ? ctx.lookup(C) : C];
  const res = page.node.Resources();
  try { scan(streams.filter(Boolean), res, 0, 0); } catch (e) { console.warn('PDF/A: no se pudo analizar la página', e); why.add('parse'); }
  // apariencias de anotaciones (sellos, firmas visibles, notas)
  const ann = page.node.lookup(N('Annots'));
  if (ann instanceof PL.PDFArray) for (let i = 0; i < ann.size(); i++) {
    const a = ann.lookup(i); if (!(a instanceof PL.PDFDict)) continue;
    const ap = a.lookup(N('AP')), n = ap instanceof PL.PDFDict ? ap.lookup(N('N')) : null;
    const forms = n instanceof PL.PDFStream ? [n] : n instanceof PL.PDFDict ? n.keys().map(k => n.lookup(k)).filter(x => x instanceof PL.PDFStream) : [];
    for (const f of forms) { const r2 = f.dict.lookup(N('Resources')); try { scan([f], r2 instanceof PL.PDFDict ? r2 : null, 0, 1); } catch { why.add('parse'); } }
  }
  return why;
}

const xmpEsc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
function pdfaXmp(m, iso) {
  const alt = v => `<rdf:Alt><rdf:li xml:lang="x-default">${xmpEsc(v)}</rdf:li></rdf:Alt>`;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
   <dc:format>application/pdf</dc:format>
${m.title ? `   <dc:title>${alt(m.title)}</dc:title>\n` : ''}${m.author ? `   <dc:creator><rdf:Seq><rdf:li>${xmpEsc(m.author)}</rdf:li></rdf:Seq></dc:creator>\n` : ''}${m.subject ? `   <dc:description>${alt(m.subject)}</dc:description>\n` : ''}${m.keywords ? `   <pdf:Keywords>${xmpEsc(m.keywords)}</pdf:Keywords>\n` : ''}   <pdf:Producer>Rúbrica</pdf:Producer>
   <xmp:CreatorTool>Rúbrica</xmp:CreatorTool>
   <xmp:CreateDate>${iso}</xmp:CreateDate>
   <xmp:ModifyDate>${iso}</xmp:ModifyDate>
   <xmp:MetadataDate>${iso}</xmp:MetadataDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Convierte bytes PDF a PDF/A-2b. meta: { title, author, subject, keywords }.
 * Devuelve { bytes, converted: [índices de página convertidos en imagen], reasons: { motivo: páginas } }.
 */
async function toPdfA(bytes, meta = {}, progress = () => { }) {
  const N = PL.PDFName.of;
  progress('Preparando PDF/A…', 5);
  // 1) fuera lo que PDF/A no admite: JavaScript, acciones, adjuntos, datos privados, metadatos viejos
  bytes = (await sanitizeBytes(bytes, { metadata: true, attachments: true, scripts: true, private: true, layers: false })).bytes;
  let lib = await PL.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  progress('Revisando fuentes y colores…', 20);
  const reasons = {}, converted = [];
  lib.getPages().forEach((p, i) => { const w = pdfaPageProblems(lib, p); if (w.size) { converted.push(i); for (const r of w) reasons[r] = (reasons[r] || 0) + 1; } });
  if (converted.length) {
    progress(`Convirtiendo ${converted.length} página(s) que no pueden cumplir…`, 35);
    lib = await rasterizePagesInLib(await lib.save({ useObjectStreams: false }), converted, 200, 0.85, null, new Map(converted.map(i => [i, []])), { keepAnnots: true });
  }
  progress('Ajustando el documento…', 80);
  const ctx = lib.context, cat = lib.catalog;
  // 2) anotaciones: imprimibles, visibles y con apariencia propia
  for (const page of lib.getPages()) {
    const ann = page.node.lookup(N('Annots')); if (!(ann instanceof PL.PDFArray)) continue;
    for (let i = ann.size() - 1; i >= 0; i--) {
      const a = ann.lookup(i); if (!(a instanceof PL.PDFDict)) { ann.remove(i); continue; }
      const sub = a.lookup(N('Subtype'))?.toString();
      if (PDFA_BAD_ANNOTS.has(sub)) { ann.remove(i); continue; }
      if (sub === '/Popup') continue;
      a.set(N('F'), PL.PDFNumber.of(sub === '/Text' ? 4 | 8 | 16 : 4));
      if (sub !== '/Link') {
        const ap = a.lookup(N('AP')), n = ap instanceof PL.PDFDict ? ap.lookup(N('N')) : null;
        const ok = n instanceof PL.PDFStream || (sub === '/Widget' && n instanceof PL.PDFDict && a.lookup(N('FT'))?.toString() === '/Btn');
        if (!ok) {
          const r = a.lookup(N('Rect')); const w = r instanceof PL.PDFArray ? Math.abs(r.lookup(2).asNumber() - r.lookup(0).asNumber()) : 0, h = r instanceof PL.PDFArray ? Math.abs(r.lookup(3).asNumber() - r.lookup(1).asNumber()) : 0;
          const xo = ctx.register(ctx.stream(sub === '/Text' ? `q 1 0.85 0.2 rg 0 0 ${w} ${h} re f Q` : '', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h] }));
          a.set(N('AP'), ctx.obj({ N: xo }));
        } else if (ap instanceof PL.PDFDict) { for (const k of ['R', 'D']) ap.delete(N(k)); }
      }
    }
    if (!ann.size()) page.node.delete(N('Annots'));
  }
  // 3) formularios y capas
  const af = cat.lookup(N('AcroForm'));
  if (af instanceof PL.PDFDict) {
    af.delete(N('NeedAppearances')); af.delete(N('XFA'));
    const f = af.lookup(N('Fields')); if (!(f instanceof PL.PDFArray) || !f.size()) cat.delete(N('AcroForm'));
  }
  const ocp = cat.lookup(N('OCProperties'));
  if (ocp instanceof PL.PDFDict) {
    const cfgs = [ocp.lookup(N('D')), ...((ocp.lookup(N('Configs')) instanceof PL.PDFArray) ? ocp.lookup(N('Configs')).asArray().map(r => ctx.lookup(r)) : [])];
    cfgs.forEach((c, k) => { if (c instanceof PL.PDFDict) { c.delete(N('AS')); if (!c.has(N('Name'))) c.set(N('Name'), PL.PDFHexString.fromText(k ? `Configuración ${k}` : 'Predeterminada')); } });
  }
  // 4) imágenes sin interpolación
  for (const [, o] of ctx.enumerateIndirectObjects()) if (o instanceof PL.PDFStream && o.dict.lookup(N('Subtype'))?.toString() === '/Image' && o.dict.has(N('Interpolate'))) o.dict.set(N('Interpolate'), PL.PDFBool.False);
  // 5) metadatos coherentes (diccionario Info = XMP), perfil de color e identificador
  const now = new Date(), iso = now.toISOString().replace(/\.\d+Z$/, 'Z'), pdfDate = 'D:' + iso.replace(/[-:T]/g, '').replace('Z', 'Z');
  const m = { title: meta.title || '', author: meta.author || '', subject: meta.subject || '', keywords: Array.isArray(meta.keywords) ? meta.keywords.join(', ') : (meta.keywords || '') };
  const info = { Producer: PL.PDFHexString.fromText('Rúbrica'), Creator: PL.PDFHexString.fromText('Rúbrica'), CreationDate: PL.PDFString.of(pdfDate), ModDate: PL.PDFString.of(pdfDate) };
  if (m.title) info.Title = PL.PDFHexString.fromText(m.title);
  if (m.author) info.Author = PL.PDFHexString.fromText(m.author);
  if (m.subject) info.Subject = PL.PDFHexString.fromText(m.subject);
  if (m.keywords) info.Keywords = PL.PDFHexString.fromText(m.keywords);
  ctx.trailerInfo.Info = ctx.register(ctx.obj(info));
  const xml = new TextEncoder().encode(pdfaXmp(m, iso));
  cat.set(N('Metadata'), ctx.register(ctx.stream(xml, { Type: 'Metadata', Subtype: 'XML' })));
  const icc = ctx.register(ctx.stream(b64ToU8(SRGB_ICC_B64), { N: 3 }));
  cat.set(N('OutputIntents'), ctx.obj([{ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PL.PDFString.of('sRGB'), Info: PL.PDFString.of('sRGB IEC61966-2.1'), RegistryName: PL.PDFString.of('http://www.color.org'), DestOutputProfile: icc }]));
  if (m.title) cat.set(N('ViewerPreferences'), ctx.obj({ DisplayDocTitle: true }));
  if (!cat.has(N('Lang')) && typeof LANG !== 'undefined') cat.set(N('Lang'), PL.PDFString.of(({ es: 'es', en: 'en', pt: 'pt' })[LANG] || 'es'));
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join('');
  ctx.trailerInfo.ID = ctx.obj([PL.PDFHexString.of(id), PL.PDFHexString.of(id)]);
  pruneUnreachable(lib);
  progress('Guardando…', 95);
  return { bytes: await lib.save({ useObjectStreams: true, updateFieldAppearances: false }), converted, reasons };
}

async function pdfaDialog() {
  const d = D(); if (!d) return;
  const ok = await confirmDialog('Guardar como PDF/A', escapeHtml(tr('PDF/A (ISO 19005-2, nivel B) es el formato para conservar documentos a largo plazo y el que piden muchos archivos públicos y sistemas de gestión documental. Rúbrica crea una copia que lo cumple: incrusta los metadatos y el perfil de color, y quita lo que el formato no admite (JavaScript, adjuntos, acciones). Las páginas que usan fuentes sin incrustar o color CMYK se convierten en imagen con el texto buscable.')), 'Crear copia PDF/A');
  if (!ok) return;
  let r;
  try { r = await withBusy('Creando PDF/A…', async upd => toPdfA(await buildPdf(d, { noEncrypt: true, flatten: true, progress: upd }), d.meta || {}, upd)); }
  catch (e) { toast(e.message, 'err', 9000); return; }
  const nd = await openBytes(baseName(d.name) + '_PDFA.pdf', r.bytes); nd.pdfa = true; nd.dirty = true; renderTabs();
  const LBL = { font: 'fuentes sin incrustar', cmyk: 'color CMYK', lzw: 'compresión LZW', other: 'efectos que PDF/A no admite', parse: 'contenido que no se pudo analizar' };
  if (r.converted.length) toast(tr(`PDF/A listo. ${r.converted.length} página(s) se convirtieron en imagen (${Object.keys(r.reasons).map(k => tr(LBL[k])).join(', ')}); el texto sigue buscable.`), 'ok', 9000);
  else toast(tr('PDF/A listo: ninguna página tuvo que convertirse en imagen.'), 'ok', 6000);
}
