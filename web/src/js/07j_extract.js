/* ============================================================
   07j · Extraer datos a Excel con plantillas
   Zonas con nombre (número de factura, contenedor, pesos, valores,
   incoterm…) dibujadas sobre un documento de ejemplo y guardadas
   como plantilla por proveedor o naviera. La plantilla se aplica a
   muchos documentos; si una zona no tiene texto (escaneo) se lee
   con OCR. Resultado: Excel o CSV, con los números como números.
   Las zonas no se guardan dentro del PDF.
   ============================================================ */
const ZONE_TYPES = [['text', 'Texto'], ['number', 'Número'], ['date', 'Fecha'], ['code', 'Código (sin espacios)']];
const ZONE_COLORS = ['#7c3aed', '#0891b2', '#c2410c', '#15803d', '#be185d', '#1d4ed8', '#a16207'];
const templates = () => S.settings.extractTemplates || (S.settings.extractTemplates = []);

/** Zonas de un documento (como plantilla): posiciones relativas al tamaño de la página. */
function zonesFromDoc(d) {
  const out = [];
  d.pages.forEach((p, pi) => { const [W, H] = dims(p); for (const o of p.ov) if (o.type === 'zone') out.push({ name: o.name, kind: o.kind || 'text', page: pi + 1, x: o.x / W, y: o.y / H, w: o.w / W, h: o.h / H }); });
  return out;
}
function zonesToDoc(d, tpl) {
  for (const p of d.pages) p.ov = p.ov.filter(o => o.type !== 'zone');
  tpl.zones.forEach((z, k) => {
    const pi = z.page === 'last' ? d.pages.length - 1 : Math.min(d.pages.length, z.page || 1) - 1, p = d.pages[pi]; if (!p) return;
    const [W, H] = dims(p);
    p.ov.push({ id: uid(), type: 'zone', name: z.name, kind: z.kind, color: ZONE_COLORS[k % ZONE_COLORS.length], x: z.x * W, y: z.y * H, w: z.w * W, h: z.h * H });
  });
}
function zoneValue(raw, kind) {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (kind === 'number') { const m = t.match(/-?\(?[\d][\d.,\s]*\d\)?%?|-?\d/); const n = m ? parseNum(m[0].replace(/\s/g, '')) : null; return n == null ? t : n; }
  if (kind === 'code') return t.replace(/\s+/g, '');
  if (kind === 'date') {
    const m = t.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/) || t.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return t;
    if (m[1].length === 4) return `${m[1]}-${m[2]}-${m[3]}`;
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return t;
}
/** Elige la plantilla de un documento por su palabra clave (o null). */
async function detectTemplate(d, list = templates(), worker = null) {
  const withKw = list.filter(t => String(t.keyword || '').trim());
  if (!withKw.length) return null;
  let raw = (await pageWords(d, d.pages[0], 0)).map(w => w.t).join(' ');
  if (!raw.trim() && worker) { // escaneo: la palabra clave se busca con OCR de la primera página
    const c = el('canvas'); await drawPage(d, d.pages[0], 200 / 72, c, 1);
    try { raw = (await worker.recognize(c)).data.text || ''; } catch { } c.width = 0;
  }
  const txt = normalizeStr(raw, false);
  return withKw.find(t => normalizeStr(t.keyword, false).split('|').some(k => k.trim() && txt.includes(k.trim()))) || null;
}
/** Valores de las zonas de una plantilla en un documento: { campo: valor } */
async function extractWithTemplate(d, tpl, { ocr = true, worker = null, progress = () => { } } = {}) {
  const row = {}, wordsCache = new Map();
  for (const z of tpl.zones) {
    const pi = z.page === 'last' ? d.pages.length - 1 : Math.min(d.pages.length, z.page || 1) - 1, p = d.pages[pi];
    if (!p) { row[z.name] = ''; continue; }
    const [W, H] = dims(p), r = { x: z.x * W, y: z.y * H, w: z.w * W, h: z.h * H };
    if (!wordsCache.has(pi)) wordsCache.set(pi, await pageWords(d, p, pi));
    let raw = wordsInRects(wordsCache.get(pi), [r]);
    if (!raw && ocr && worker) {
      // escaneo sin texto: se lee solo la zona, a 300 ppp
      progress(tr(`Leyendo «${z.name}» con OCR…`));
      const k = 300 / 72, full = el('canvas'); await drawPage(d, p, k, full, 1);
      const c = el('canvas'), pad = 4; c.width = Math.ceil((r.w + 2 * pad) * k); c.height = Math.ceil((r.h + 2 * pad) * k);
      c.getContext('2d').drawImage(full, Math.max(0, (r.x - pad) * k), Math.max(0, (r.y - pad) * k), c.width, c.height, 0, 0, c.width, c.height);
      full.width = 0;
      try { raw = ((await worker.recognize(c)).data.text || '').replace(/\s+/g, ' ').trim(); } catch { raw = ''; }
      c.width = 0;
    }
    row[z.name] = zoneValue(raw, z.kind);
  }
  return row;
}

/* ---------- Excel ---------- */
function xlsxFromRows(rows, sheet = 'Datos') {
  const z = new JSZip(), esc = v => xmlEsc(v);
  const cell = (v, r, c, head) => {
    const ref = colName(c) + (r + 1);
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${head ? ' s="1"' : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${head ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(v ?? '')}</t></is></c>`;
  };
  const widths = rows[0].map((_, c) => Math.min(60, Math.max(10, ...rows.map(r => String(r[c] ?? '').length + 2))));
  const data = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, i, c, i === 0)).join('')}</row>`).join('');
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheet.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  z.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData><autoFilter ref="A1:${colName(rows[0].length - 1)}${rows.length}"/></worksheet>`);
  return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const csvFromRows = rows => '﻿' + rows.map(r => r.map(v => typeof v === 'number' ? String(v) : '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n') + '\r\n';

/**
 * Aplica plantillas a varios documentos. files: [{ name, doc } | { name, bytes, mime }]. tpl: plantilla fija o null (detectar).
 * Devuelve { rows (con encabezado), report:[{ name, template, ok, error }] }.
 */
async function runExtraction(files, tpl, { ocr = true, progress = () => { } } = {}) {
  let worker = null; const out = [], report = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; progress(tr(`Leyendo ${i + 1} de ${files.length}: ${f.name}…`), (i / files.length) * 100);
      try {
        let d = f.doc;
        if (!d) { d = new Doc(f.name); d.pages = await addFileToDoc(d, f.bytes, f.name, f.mime); }
        if (!tpl && ocr && !worker && !(await pageWords(d, d.pages[0], 0)).length) worker = await ocrWorker('spa+eng', progress);
        const t = tpl || await detectTemplate(d, templates(), ocr ? worker : null);
        if (!t) { report.push({ name: f.name, ok: false, error: tr('Ninguna plantilla coincide con este documento.') }); continue; }
        if (ocr && !worker) {
          // OCR solo si alguna zona lo necesita: se crea el motor la primera vez
          const needs = await (async () => { for (const z of t.zones) { const pi = Math.min(d.pages.length, z.page || 1) - 1; if (!(await pageWords(d, d.pages[pi], pi)).length) return true; } return false; })();
          if (needs) worker = await ocrWorker('spa+eng', progress);
        }
        const row = await extractWithTemplate(d, t, { ocr, worker, progress });
        out.push({ file: f.name, template: t.name, row });
        report.push({ name: f.name, template: t.name, ok: true });
      } catch (e) { report.push({ name: f.name, ok: false, error: e.message || String(e) }); }
    }
  } finally { if (worker) try { await worker.terminate(); } catch { } }
  const cols = [...new Set(out.flatMap(o => Object.keys(o.row)))];
  const rows = [[tr('Archivo'), tr('Plantilla'), ...cols], ...out.map(o => [o.file, o.template, ...cols.map(c => o.row[c] ?? '')])];
  return { rows, report };
}

/* ---------- Interfaz ---------- */
async function extractDialog() {
  const d = D();
  const cur = d ? zonesFromDoc(d) : [];
  const sel = el('select', { 'aria-label': 'Plantilla' });
  const fill = v => {
    sel.innerHTML = '';
    if (cur.length) sel.append(el('option', { value: '__doc', text: tr(`Zonas de este documento (${cur.length})`) }));
    sel.append(el('option', { value: '__auto', text: tr('Detectar la plantilla de cada documento (por su palabra clave)') }));
    for (const t of templates()) sel.append(el('option', { value: t.id, text: `${t.name} · ${t.zones.length} ${tr('zonas')}${t.keyword ? ' · «' + t.keyword + '»' : ''}` }));
    sel.value = v || (cur.length ? '__doc' : templates()[0]?.id || '__auto');
  };
  fill(S.settings.extractLast);
  const files = d ? [{ name: d.name, doc: d }] : [];
  const list = el('div', { class: 'recent-list', style: { maxHeight: '150px', overflow: 'auto', minHeight: '40px' } });
  const draw = () => { list.innerHTML = ''; if (!files.length) list.append(el('div', { class: 'cb-empty', text: 'Agregue los documentos de los que quiere extraer datos' })); files.forEach((f, i) => list.append(el('div', { class: 'recent-row' }, icEl(f.doc ? 'file-check' : 'file-text'), el('span', { class: 'nm', text: f.name }), el('button', { class: 'icon-btn sm', html: ic('x'), title: 'Quitar', onclick: () => { files.splice(i, 1); draw(); } })))); };
  const addOpen = () => { S.docs.filter(x => x.pages.length && !files.some(f => f.doc === x)).forEach(x => files.push({ name: x.name, doc: x })); draw(); };
  const addFiles = async from => { try { files.push(...await pickFiles(from, true)); draw(); } catch (e) { toast(e.message, 'err'); } };
  const ocr = el('input', { type: 'checkbox' }); ocr.checked = S.settings.extractOcr ?? true;
  const fmt = el('select', { 'aria-label': 'Formato' }); for (const [v, l] of [['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV']]) fmt.append(el('option', { value: v, text: l })); fmt.value = S.settings.extractFmt || 'xlsx';
  const saveTpl = async () => {
    if (!cur.length) { toast(tr('Primero dibuje zonas con la herramienta «Zona de datos» (Convertir → Zonas).'), 'err', 6000); return; }
    const old = templates().find(t => t.id === sel.value);
    const v = await formDialog('Guardar plantilla', [
      { key: 'name', label: 'Nombre', value: old?.name || '', placeholder: tr('Ej.: Factura proveedor X / BL naviera Y') },
      { key: 'keyword', label: 'Palabra clave para reconocerla (opcional)', value: old?.keyword || '', placeholder: tr('Texto que siempre aparece en la página 1, p. ej. MSC o RTN del proveedor'), hint: tr('Varias alternativas separadas por |') }
    ], { ok: 'Guardar', validate: v => v.name.trim() ? null : 'Escriba un nombre.' });
    if (!v) return;
    const t = templates().find(x => x.name.toLowerCase() === v.name.trim().toLowerCase()) || (templates().push({ id: uid() }), templates().at(-1));
    Object.assign(t, { name: v.name.trim(), keyword: v.keyword.trim(), zones: cur }); saveSettings(); fill(t.id); toast(tr('Plantilla guardada.'), 'ok');
  };
  const showTpl = () => { const t = templates().find(x => x.id === sel.value); if (!t || !d) { toast(tr('Elija una plantilla guardada.')); return; } d.checkpoint(); zonesToDoc(d, t); afterStructureChange(); m.close(null); toast(tr('Zonas de la plantilla en el documento: muévalas o ajústelas y vuelva a guardarla.'), '', 6000); };
  const delTpl = async () => { const t = templates().find(x => x.id === sel.value); if (!t) return; if (!(await confirmDialog('Eliminar plantilla', escapeHtml(tr(`¿Eliminar «${t.name}»?`)), 'Eliminar', true))) return; S.settings.extractTemplates = templates().filter(x => x !== t); saveSettings(); fill(); };
  const body = el('div', { class: 'fm' },
    el('div', { class: 'hint', style: { marginBottom: '8px' }, text: 'Dibuje zonas con nombre sobre un documento de ejemplo (Convertir → Zonas), guárdelas como plantilla y aplíquelas a muchos documentos del mismo formato.' }),
    el('div', { class: 'row' }, el('label', { text: 'Plantilla' }), sel),
    el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '4px 0 10px' } },
      el('button', { class: 'btn sm', type: 'button', html: ic('square-dashed') + escapeHtml(tr('Dibujar zonas')), onclick: () => { m.close(null); setTool('zone'); } }),
      el('button', { class: 'btn sm', type: 'button', html: ic('save') + escapeHtml(tr('Guardar plantilla…')), onclick: saveTpl }),
      el('button', { class: 'btn sm', type: 'button', html: ic('eye') + escapeHtml(tr('Mostrar en el documento')), onclick: showTpl }),
      el('button', { class: 'btn sm', type: 'button', html: ic('trash-2') + escapeHtml(tr('Eliminar')), onclick: delTpl })),
    el('h5', { text: 'Documentos' }),
    el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' } },
      el('button', { class: 'btn sm', type: 'button', html: ic('files') + escapeHtml(tr('Documentos abiertos')), onclick: addOpen }),
      el('button', { class: 'btn sm', type: 'button', html: ic('hard-drive') + escapeHtml(tr(PSN ? 'Elegir archivos' : 'Este equipo')), onclick: () => addFiles('local') })),
    list,
    el('div', { class: 'cols', style: { marginTop: '10px' } }, el('label', { class: 'chk' }, ocr, el('span', { text: 'Leer con OCR las zonas sin texto (escaneos)' })), el('div', { class: 'row' }, el('label', { text: 'Formato' }), fmt)));
  draw();
  const m = openModal({ title: 'Extraer datos a Excel', body, wide: true, buttons: [{ label: 'Cancelar', value: null }, { label: 'Extraer', primary: true, onClick: () => files.length ? true : (toast('Agregue documentos.', 'err'), false) }] });
  if (!(await m.result)) return;
  S.settings.extractLast = sel.value; S.settings.extractOcr = ocr.checked; S.settings.extractFmt = fmt.value; saveSettings();
  const tpl = sel.value === '__doc' ? { name: tr('Zonas de este documento'), zones: cur } : sel.value === '__auto' ? null : templates().find(t => t.id === sel.value);
  let res;
  try { res = await withBusy('Extrayendo datos…', upd => runExtraction(files, tpl, { ocr: ocr.checked, progress: upd })); } catch (e) { toast(e.message, 'err'); return; }
  const ok = res.report.filter(r => r.ok).length;
  const table = el('table', { class: 'kv extract-preview' }, el('tbody', {}, ...res.rows.slice(0, 51).map((r, i) => el('tr', {}, ...r.map(v => el(i ? 'td' : 'th', { text: typeof v === 'number' ? v.toLocaleString(LOC()) : String(v) }))))));
  const errs = res.report.filter(r => !r.ok);
  const name = (tpl ? tpl.name : tr('Datos extraídos')).replace(/[\\/:*?"<>|]+/g, ' ');
  await openModal({ title: tr(`Datos extraídos: ${ok} de ${res.report.length} documentos`), wide: true, body: el('div', {}, el('div', { style: { overflow: 'auto', maxHeight: '50vh' } }, table),
    errs.length ? el('div', { class: 'hint', style: { marginTop: '8px', color: 'var(--danger)' }, text: errs.map(e => `${e.name}: ${e.error}`).join(' · ') }) : null),
    buttons: [{ label: 'Cerrar', value: null }, { label: fmt.value === 'csv' ? 'Descargar CSV' : 'Descargar Excel', primary: true, onClick: async () => {
      if (fmt.value === 'csv') download(new Blob([csvFromRows(res.rows)], { type: 'text/csv' }), name + '.csv');
      else download(await xlsxFromRows(res.rows, name), name + '.xlsx');
      return true; } }] }).result;
}

async function editZone(p, o) {
  const v = await formDialog('Zona de datos', [{ key: 'name', label: 'Nombre del dato (columna en Excel)', value: o.name }, { key: 'kind', label: 'Tipo', type: 'select', value: o.kind || 'text', options: ZONE_TYPES }], { validate: v => v.name.trim() ? null : 'Escriba el nombre del dato.' });
  if (!v) return;
  D().checkpoint(); o.name = v.name.trim(); o.kind = v.kind; renderOverlays(p); renderProps();
}
