/* ============================================================
   11e · Solicitar firmas a otras personas
   Campos de firma vacíos con el nombre de quien debe firmar y el
   orden. Son campos de firma estándar: el documento se puede firmar
   en Rúbrica (que firma dentro del campo y avisa si se salta el
   orden) o en Adobe Acrobat/Reader.
   ============================================================ */
const fieldHex = s => PL.PDFHexString.fromText(String(s ?? ''));

/** Campo de firma vacío (sin /V) con una apariencia que indica quién debe firmar. */
async function addEmptySigField(pdf, pg, { name, signer, order, rect, rot = 0 }) {
  const ctx = pdf.context, N = PL.PDFName.of;
  const w = Math.abs(rect[2] - rect[0]), h = Math.abs(rect[3] - rect[1]), vw = rot % 180 ? h : w, vh = rot % 180 ? w : h;
  const f1 = await pdf.embedFont(PL.StandardFonts.Helvetica), f2 = await pdf.embedFont(PL.StandardFonts.HelveticaBold);
  const head = safeText(f2, tr('Firma') + (order ? ` ${order}` : '')), who = safeText(f1, signer || '');
  const s1 = Math.min(9, vh * 0.28), s2 = Math.min(11, vh * 0.32, (vw - 8) / Math.max(1, f1.widthOfTextAtSize(who, 1)));
  const ops = [
    PL.pushGraphicsState(), PL.setFillingRgbColor(0.95, 0.97, 1), PL.rectangle(0, 0, vw, vh), PL.fill(),
    PL.setStrokingRgbColor(0.35, 0.45, 0.7), PL.setLineWidth(0.8), PL.setDashPattern([3, 2], 0), PL.rectangle(0.5, 0.5, vw - 1, vh - 1), PL.stroke(), PL.popGraphicsState(),
    PL.setFillingRgbColor(0.35, 0.45, 0.7), PL.beginText(), PL.setFontAndSize('F2', s1), PL.moveText(4, vh - s1 - 3), PL.showText(f2.encodeText(head)), PL.endText(),
    PL.setFillingRgbColor(0.15, 0.2, 0.35), PL.beginText(), PL.setFontAndSize('F1', s2), PL.moveText(4, Math.max(3, vh / 2 - s2 / 2 - 2)), PL.showText(f1.encodeText(who)), PL.endText(),
  ];
  const dict = { BBox: [0, 0, vw, vh], Resources: { Font: { F1: f1.ref, F2: f2.ref } } };
  if (rot) { const t = rot * Math.PI / 180; dict.Matrix = [Math.round(Math.cos(t)), Math.round(Math.sin(t)), -Math.round(Math.sin(t)), Math.round(Math.cos(t)), 0, 0]; }
  const ap = ctx.register(ctx.formXObject(ops, dict));
  const widget = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: fieldHex(name), TU: fieldHex(`${tr('Firma')} ${order || ''}: ${signer || ''}`.replace(/\s+:/, ':')),
    Rect: [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])], F: 4, P: pg.ref, AP: { N: ap },
    MK: rot ? { R: rot } : {}, RubricaSigner: fieldHex(signer || ''), RubricaOrder: order || 0
  }));
  let annots = pg.node.lookupMaybe(N('Annots'), PL.PDFArray); if (!annots) { annots = ctx.obj([]); pg.node.set(N('Annots'), annots); }
  annots.push(widget);
  const acro = pdf.catalog.getOrCreateAcroForm();
  let fields = acro.dict.lookup(N('Fields')); if (!(fields instanceof PL.PDFArray)) { fields = ctx.obj([]); acro.dict.set(N('Fields'), fields); }
  fields.push(widget);
}

/** Campos de firma vacíos del PDF: [{ name, signer, order, pageIndex, rect (PDF), rot }], en orden. */
async function pendingSignatureFields(bytes) {
  const lib = await PL.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const N = PL.PDFName.of, out = [], pages = lib.getPages(), pageOf = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  const str = v => v instanceof PL.PDFHexString || v instanceof PL.PDFString ? v.decodeText() : '';
  const walk = (ref, inherited = {}) => {
    const d = lib.context.lookup(ref); if (!(d instanceof PL.PDFDict)) return;
    const own = { ft: d.lookup(N('FT'))?.toString() || inherited.ft, name: [inherited.name, str(d.lookup(N('T')))].filter(Boolean).join('.'), v: d.has(N('V')) || inherited.v };
    const kids = d.lookup(N('Kids'));
    if (kids instanceof PL.PDFArray && kids.size() && lib.context.lookup(kids.get(0)) instanceof PL.PDFDict && lib.context.lookup(kids.get(0)).has(N('T'))) { for (let i = 0; i < kids.size(); i++) walk(kids.get(i), own); return; }
    if (own.ft !== '/Sig' || own.v) return;
    const widgets = kids instanceof PL.PDFArray ? kids.asArray() : [ref];
    for (const wr of widgets) {
      const w = lib.context.lookup(wr); if (!(w instanceof PL.PDFDict)) continue;
      let pi = w.get(N('P')) ? pageOf.get(w.get(N('P')).toString()) : undefined;
      if (pi === undefined) pi = pages.findIndex(p => { const a = p.node.lookup(N('Annots')); return a instanceof PL.PDFArray && a.asArray().some(x => x.toString() === wr.toString()); });
      if (pi < 0 || pi === undefined) continue;
      const r = w.lookup(N('Rect')); if (!(r instanceof PL.PDFArray)) continue;
      const rect = [0, 1, 2, 3].map(k => r.lookup(k).asNumber());
      if (Math.abs(rect[2] - rect[0]) < 2 || Math.abs(rect[3] - rect[1]) < 2) continue; // invisibles: no se proponen
      const order = d.lookup(N('RubricaOrder'))?.asNumber?.() || 0;
      out.push({ name: own.name, signer: str(d.lookup(N('RubricaSigner'))) || str(d.lookup(N('TU'))), order, pageIndex: pi, rect, rot: pages[pi].getRotation().angle % 360 });
    }
  };
  const fields = lib.catalog.lookup(N('AcroForm'))?.lookup?.(N('Fields'));
  if (fields instanceof PL.PDFArray) for (let i = 0; i < fields.size(); i++) walk(fields.get(i));
  return out.sort((a, b) => (a.order || 99) - (b.order || 99) || a.pageIndex - b.pageIndex);
}
async function docPendingSignatures(d) {
  const out = [];
  for (const s of Object.values(d.sources)) {
    if (s.kind !== 'pdf') continue;
    // PDF.js ya leyó el formulario: solo si hay campos de firma se analiza el archivo con pdf-lib
    if (!s.pending) s.pending = s.pdf.getFieldObjects().then(fo => fo && Object.values(fo).flat().some(f => f.type === 'signature') ? pendingSignatureFields(s.bytes) : []).catch(() => []);
    for (const f of await s.pending) { const pi = d.pages.findIndex(p => p.src === s.id && p.idx === f.pageIndex); if (pi >= 0) out.push({ ...f, docPage: pi }); }
  }
  return out;
}
const normName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
/** ¿El titular del certificado parece ser quien debe firmar? (al menos dos palabras del nombre en común, o la única) */
function signerMatches(expected, cn) {
  const a = normName(expected), b = new Set(normName(cn));
  if (!a.length) return true;
  const hit = a.filter(w => b.has(w)).length;
  return hit >= Math.min(2, a.length);
}

/** Firma en un campo existente: avisa si se salta el orden o si el certificado no parece de quien debe firmar. */
async function signPendingField(field) {
  const d = D(); if (!d) return;
  const pend = await docPendingSignatures(d);
  const before = pend.filter(f => f.order && field.order && f.order < field.order);
  if (before.length && !(await confirmDialog('Orden de las firmas', escapeHtml(tr(`Este documento espera primero la firma de ${before.map(f => f.signer || f.name).join(', ')}. ¿Firmar de todas formas?`)), 'Firmar de todas formas'))) return;
  return digitalSignDialog({ field });
}

async function shareForSigningDialog() {
  const d = D(); if (!d) return;
  const pend = await docPendingSignatures(d);
  const ovs = d.pages.flatMap(p => p.ov.filter(o => o.type === 'field' && o.ftype === 'sig'));
  const people = [...pend.map(f => f.signer), ...ovs.sort((a, b) => (a.order || 0) - (b.order || 0)).map(o => o.signer)].filter(Boolean);
  if (!people.length) { toast(tr('Primero agregue campos de firma (Formulario → Campo de firma).'), 'err', 6000); return; }
  const msg = tr(`Le envío el documento «${baseName(d.name)}» para su firma digital. Ábralo con Rúbrica (o Adobe Acrobat Reader), vaya a «Firmas» y pulse «Firmar aquí» en el campo con su nombre. Orden de firma: ${people.map((p, i) => `${i + 1}. ${p}`).join(', ')}.`);
  const ta = el('textarea', { style: { width: '100%', minHeight: '110px' } }); ta.value = msg;
  const r = await openModal({ title: 'Enviar para firmar', body: el('div', {},
    el('div', { class: 'hint', style: { marginBottom: '8px' }, text: tr('Guarde el documento y envíelo con este mensaje. Cada persona firma en su campo; el siguiente recibe el archivo ya firmado.') }), ta),
    buttons: [{ label: 'Copiar mensaje', onClick: async () => { try { await navigator.clipboard.writeText(ta.value); toast(tr('Mensaje copiado.'), 'ok'); } catch { } return false; } },
      ...(PSN || isTouch() ? [{ label: 'Compartir', value: 'share' }] : [{ label: 'Abrir correo', value: 'mail' }]),
      { label: 'Guardar documento', primary: true, value: 'save' }] }).result;
  if (r === 'share') return shareDoc(d);
  if (r === 'mail') { location.href = 'mailto:?subject=' + encodeURIComponent(tr('Documento para firmar: ') + baseName(d.name)) + '&body=' + encodeURIComponent(ta.value + '\n\n' + tr('(Adjunte el PDF guardado.)')); return; }
  if (r === 'save') return saveDoc(d, true);
}
