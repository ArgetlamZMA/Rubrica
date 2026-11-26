/* ============================================================
   07g · Quitar información oculta
   Para publicar o entregar una versión limpia (acceso a la
   información, licitaciones, clientes): metadatos, adjuntos,
   JavaScript y acciones, comentarios, capas ocultas, miniaturas y
   datos privados de otras aplicaciones. Lo quitado se borra del
   archivo, no solo de la vista.
   ============================================================ */
const SANITIZE_OPTS = [
  ['metadata', 'Metadatos (título, autor, programa, fechas, XMP)', true],
  ['attachments', 'Archivos adjuntos', true],
  ['scripts', 'JavaScript, acciones automáticas y enlaces que ejecutan programas', true],
  ['layers', 'Capas ocultas (las páginas que las tienen se convierten en imagen sin texto)', true],
  ['comments', 'Comentarios y marcas de revisión', false],
  ['forms', 'Campos de formulario (se aplanan: queda el valor escrito)', false],
  ['private', 'Miniaturas incrustadas y datos privados de otras aplicaciones', true],
  ['bookmarks', 'Marcadores', false],
];

/**
 * Limpia bytes PDF. Devuelve { bytes, found: { clave: cantidad } } con lo que se encontró y se quitó.
 */
async function sanitizeBytes(bytes, opts, progress = () => { }) {
  const N = PL.PDFName.of, found = {};
  const bump = (k, n = 1) => { if (n > 0) found[k] = (found[k] || 0) + n; };
  let lib = await PL.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  // 1) capas ocultas: páginas que usan contenido opcional, si hay grupos apagados
  if (opts.layers) {
    const ocp = lib.catalog.lookup(N('OCProperties'));
    const d = ocp instanceof PL.PDFDict ? ocp.lookup(N('D')) : null, off = d instanceof PL.PDFDict ? d.lookup(N('OFF')) : null;
    const anyOff = off instanceof PL.PDFArray && off.size() > 0;
    if (anyOff) {
      const usesOC = page => {
        const res = page.node.Resources(); if (!res) return false;
        const props = res.lookup(N('Properties'));
        if (props instanceof PL.PDFDict && props.keys().length) return true;
        const xo = res.lookup(N('XObject'));
        return xo instanceof PL.PDFDict && xo.keys().some(k => { const x = xo.lookup(k); return (x instanceof PL.PDFStream ? x.dict : x)?.has?.(N('OC')); });
      };
      const idx = lib.getPages().map((p, i) => usesOC(p) ? i : -1).filter(i => i >= 0);
      if (idx.length) {
        progress('Quitando capas ocultas…', 20);
        lib = await rasterizePagesInLib(await lib.save({ useObjectStreams: false }), idx, 200, 0.85, null, null, { keepAnnots: true });
        bump('layers', idx.length);
      }
    }
    if (lib.catalog.has(N('OCProperties'))) { lib.catalog.delete(N('OCProperties')); bump('layers', found.layers ? 0 : 1); }
  }
  progress('Revisando el documento…', 60);
  const cat = lib.catalog, ctx = lib.context;
  const names = cat.lookup(N('Names'));
  if (opts.attachments) {
    if (names instanceof PL.PDFDict && names.has(N('EmbeddedFiles'))) { bump('attachments', countNameTree(names.lookup(N('EmbeddedFiles')))); names.delete(N('EmbeddedFiles')); }
    if (cat.has(N('AF'))) cat.delete(N('AF'));
    if (cat.has(N('Collection'))) cat.delete(N('Collection'));
  }
  if (opts.scripts) {
    if (names instanceof PL.PDFDict && names.has(N('JavaScript'))) { bump('scripts', countNameTree(names.lookup(N('JavaScript')))); names.delete(N('JavaScript')); }
    for (const k of ['OpenAction', 'AA']) if (cat.has(N(k))) { cat.delete(N(k)); bump('scripts'); }
    const af = cat.lookup(N('AcroForm'));
    if (af instanceof PL.PDFDict) for (const k of ['XFA']) if (af.has(N(k))) { af.delete(N(k)); bump('scripts'); }
  }
  if (opts.metadata) {
    const info = ctx.trailerInfo.Info && ctx.lookup(ctx.trailerInfo.Info);
    if (info instanceof PL.PDFDict && info.keys().length) bump('metadata', info.keys().length);
    ctx.trailerInfo.Info = ctx.register(ctx.obj({}));
    if (cat.has(N('Metadata'))) { cat.delete(N('Metadata')); bump('metadata'); }
  }
  if (opts.private) for (const k of ['PieceInfo', 'SpiderInfo', 'Threads', 'Perms']) if (cat.has(N(k))) { cat.delete(N(k)); bump('private'); }
  if (opts.bookmarks && cat.has(N('Outlines'))) { cat.delete(N('Outlines')); if (cat.lookup(N('PageMode'))?.toString() === '/UseOutlines') cat.delete(N('PageMode')); bump('bookmarks'); }
  for (const page of lib.getPages()) {
    const node = page.node;
    if (opts.private) for (const k of ['Thumb', 'PieceInfo']) if (node.has(N(k))) { node.delete(N(k)); bump('private'); }
    if (opts.metadata && node.has(N('Metadata'))) { node.delete(N('Metadata')); bump('metadata'); }
    if (opts.scripts && node.has(N('AA'))) { node.delete(N('AA')); bump('scripts'); }
    const annots = node.lookup(N('Annots'));
    if (!(annots instanceof PL.PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const ref = annots.get(i), a = ctx.lookup(ref); if (!(a instanceof PL.PDFDict)) continue;
      const sub = a.lookup(N('Subtype'))?.toString();
      if (opts.attachments && sub === '/FileAttachment') { annots.remove(i); bump('attachments'); continue; }
      if (opts.comments && sub !== '/Link' && sub !== '/Widget') { annots.remove(i); bump('comments'); continue; }
      if (opts.scripts) {
        if (a.has(N('AA'))) { a.delete(N('AA')); bump('scripts'); }
        const act = a.lookup(N('A'));
        const s = act instanceof PL.PDFDict ? act.lookup(N('S'))?.toString() : null;
        if (['/JavaScript', '/Launch', '/ImportData', '/SubmitForm', '/ResetForm', '/Rendition', '/Movie', '/Sound', '/GoToE', '/GoToR'].includes(s)) {
          if (sub === '/Link') annots.remove(i); else a.delete(N('A'));
          bump('scripts');
        }
      }
    }
    if (!annots.size()) node.delete(N('Annots'));
  }
  if (opts.metadata) {
    // XMP de imágenes, fuentes y demás objetos
    for (const [, o] of ctx.enumerateIndirectObjects()) {
      const d = o instanceof PL.PDFStream ? o.dict : o instanceof PL.PDFDict ? o : null;
      if (d && d !== cat && d.has(N('Metadata'))) { d.delete(N('Metadata')); bump('metadata'); }
    }
  }
  pruneUnreachable(lib);
  progress('Guardando…', 90);
  return { bytes: await lib.save({ useObjectStreams: true, updateFieldAppearances: false }), found };
}
function countNameTree(node) {
  if (!(node instanceof PL.PDFDict)) return 1;
  const n = node.lookup(PL.PDFName.of('Names')), kids = node.lookup(PL.PDFName.of('Kids'));
  let c = n instanceof PL.PDFArray ? Math.floor(n.size() / 2) : 0;
  if (kids instanceof PL.PDFArray) for (let i = 0; i < kids.size(); i++) c += countNameTree(kids.lookup(i));
  return Math.max(c, 1);
}

async function sanitizeDialog() {
  const d = D(); if (!d) return;
  const saved = S.settings.sanitize || {};
  const v = await formDialog('Quitar información oculta', [
    { type: 'hint', label: 'Crea una copia limpia para publicar o entregar. Lo que marque se borra del archivo, no solo de la vista. Revise la copia antes de guardarla.' },
    ...SANITIZE_OPTS.map(([k, label, def]) => ({ key: k, label, type: 'checkbox', value: saved[k] ?? def }))
  ], { ok: 'Crear copia limpia' });
  if (!v) return;
  S.settings.sanitize = v; saveSettings();
  let res;
  try {
    res = await withBusy('Quitando información oculta…', async upd => {
      const src = await buildPdf(d, { noEncrypt: true, flatten: !!v.forms, progress: upd });
      return sanitizeBytes(src, v, upd);
    });
  } catch (e) { toast(e.message, 'err', 9000); return; }
  const nd = await openBytes(baseName(d.name) + '_limpio.pdf', res.bytes); nd.dirty = true; renderTabs();
  const LBL = { metadata: 'metadatos', attachments: 'archivos adjuntos', scripts: 'scripts o acciones', layers: 'páginas con capas ocultas', comments: 'comentarios', private: 'datos privados o miniaturas', bookmarks: 'marcadores' };
  const items = Object.entries(res.found).map(([k, n]) => `<li>${escapeHtml(tr(LBL[k]))}: ${n}</li>`).join('');
  alertDialog('Quitar información oculta', items
    ? escapeHtml(tr('Se quitó de la copia:')) + `<ul>${items}</ul>` + (v.forms ? '<p>' + escapeHtml(tr('Los campos de formulario quedaron aplanados.')) + '</p>' : '')
      + (res.found.layers ? '<p>' + escapeHtml(tr('Las páginas con capas ocultas se convirtieron en imagen sin texto, para que lo oculto no quede en el archivo. Si necesita buscar en ellas, aplique OCR a la copia.')) + '</p>' : '')
    : escapeHtml(tr('No se encontró información oculta de los tipos elegidos. La copia está lista.')));
}
