/* ============================================================
   07e · Procesar por lotes y automatizaciones guardadas
   Una lista de pasos (OCR, girar, sello, marca de agua, números,
   Bates, propiedades, comprimir, aplanar, contraseña, ajustar a
   tamaño) se aplica a muchos archivos; el resultado sale en un ZIP
   con un informe. Las secuencias se guardan con nombre para
   repetirlas («automatizaciones»).
   ============================================================ */
const POS6 = [['tl', 'Arriba a la izquierda'], ['tc', 'Arriba al centro'], ['tr', 'Arriba a la derecha'], ['bl', 'Abajo a la izquierda'], ['bc', 'Abajo al centro'], ['br', 'Abajo a la derecha']];
const BATCH_STEPS = {
  ocr: { label: 'Reconocer texto (OCR)', icon: 'scan-text', fields: [
    { key: 'lang', label: 'Idioma', type: 'select', value: 'spa+eng', options: [['spa', 'Español'], ['eng', 'Inglés'], ['spa+eng', 'Español + Inglés'], ['por', 'Portugués'], ['fra', 'Francés']] },
    { key: 'skip', label: 'Omitir páginas que ya tienen texto', type: 'checkbox', value: true }] },
  rotate: { label: 'Girar páginas', icon: 'rotate-cw', fields: [
    { key: 'angle', label: 'Giro', type: 'select', value: '1', options: [['1', '90° a la derecha'], ['-1', '90° a la izquierda'], ['2', '180°']] },
    { key: 'which', label: 'Páginas', type: 'select', value: 'all', options: [['all', 'Todas'], ['landscape', 'Solo las horizontales'], ['portrait', 'Solo las verticales']] }] },
  stamp: { label: 'Sello', icon: 'stamp', fields: [
    { key: 'label', label: 'Sello', type: 'select', value: 'COPIA FIEL', options: () => STAMPS.map(s => [s, tr(s)]) },
    { key: 'pages', label: 'Páginas', type: 'select', value: 'first', options: [['first', 'Primera'], ['all', 'Todas'], ['last', 'Última']] },
    { key: 'pos', label: 'Posición', type: 'select', value: 'tr', options: POS6 },
    { key: 'date', label: 'Con fecha', type: 'checkbox', value: true }] },
  watermark: { label: 'Marca de agua', icon: 'droplets', fields: [
    { key: 'text', label: 'Texto', value: 'COPIA' },
    { key: 'layout', label: 'Distribución', type: 'select', value: 'center', options: [['center', 'Centrada'], ['tile', 'Mosaico'], ['top', 'Arriba'], ['bottom', 'Abajo']] },
    { key: 'opacity', label: 'Opacidad (%)', type: 'number', value: 20, min: 5, max: 100 }] },
  pagenum: { label: 'Números de página', icon: 'list-ordered', fields: [
    { key: 'fmt', label: 'Formato', type: 'select', value: 'Página {n} de {N}', options: [['{n}', '1'], ['Página {n}', 'Página 1'], ['Página {n} de {N}', 'Página 1 de 10'], ['{n} / {N}', '1 / 10']] },
    { key: 'pos', label: 'Posición', type: 'select', value: 'bc', options: POS6 }] },
  bates: { label: 'Numeración Bates', icon: 'hash', fields: [
    { key: 'prefix', label: 'Prefijo', value: 'DOC-' }, { key: 'start', label: 'Número inicial', type: 'number', value: 1, min: 0 },
    { key: 'digits', label: 'Dígitos', type: 'number', value: 6, min: 1, max: 12 },
    { key: 'cont', label: 'Continuar la numeración de un archivo al siguiente', type: 'checkbox', value: true }] },
  meta: { label: 'Propiedades del documento', icon: 'info', fields: [
    { key: 'title', label: 'Título', value: '{archivo}', hint: '{archivo} = nombre del archivo' }, { key: 'author', label: 'Autor', value: '' }, { key: 'subject', label: 'Asunto', value: '' }] },
  compress: { label: 'Comprimir', icon: 'file-archive', fields: [
    { key: 'level', label: 'Nivel', type: 'select', value: 'medium', options: [['medium', 'Media (150 ppp)'], ['strong', 'Fuerte (110 ppp)'], ['max', 'Máxima (72 ppp)']] }] },
  flatten: { label: 'Aplanar formularios y comentarios', icon: 'layers', fields: [] },
  protect: { label: 'Contraseña', icon: 'lock', fields: [
    { key: 'userPw', label: 'Contraseña para abrir (opcional)', type: 'password', value: '' }, { key: 'ownerPw', label: 'Contraseña de permisos', type: 'password', value: '' },
    { key: 'print', label: 'Permitir imprimir', type: 'checkbox', value: true }, { key: 'copy', label: 'Permitir copiar', type: 'checkbox', value: false }] },
  fit: { label: 'Ajustar a tamaño máximo', icon: 'file-down', fields: [
    { key: 'mb', label: 'Máximo por archivo (MB)', value: '4' },
    { key: 'minDpi', label: 'Resolución mínima', type: 'select', value: '96', options: [['150', '150 ppp'], ['110', '110 ppp'], ['96', '96 ppp'], ['72', '72 ppp']] }] }
};
const COMPRESS_LEVELS = { medium: { dpi: 150, quality: 0.72 }, strong: { dpi: 110, quality: 0.6 }, max: { dpi: 72, quality: 0.5 } };

/** Valores completos de un paso (los que faltan toman el valor por omisión). */
function stepValues(step) {
  const def = BATCH_STEPS[step.type], v = {};
  for (const f of def.fields) v[f.key] = step.v && f.key in step.v ? step.v[f.key] : f.value;
  return v;
}
/** Documento nuevo a partir de bytes PDF (para continuar después de comprimir o aplanar). */
async function docFromBytes(name, bytes, security) {
  const d = new Doc(name); d.pages = await addFileToDoc(d, bytes, name, 'application/pdf'); d.security = security || null; return d;
}
function stampOverlay(p, v) {
  const label = tr(v.label || 'COPIA FIEL'), o = { id: uid(), type: 'stamp', label, color: STAMP_COLORS[STAMP_COLOR(v.label)], date: !!v.date, time: false, who: false, dateText: '' };
  o.dateText = stampSub(o);
  const sub = !!o.dateText, h = sub ? 46 : 38, [W, H] = dims(p), m = 24;
  const w = Math.max(metricWidth(label, 'Helvetica', true, false, h * (sub ? 0.36 : 0.46)), sub ? metricWidth(o.dateText, 'Helvetica', true, false, h * 0.2) : 0) + h * 0.7;
  const pos = v.pos || 'tr', x = pos[1] === 'l' ? m : pos[1] === 'c' ? (W - w) / 2 : W - m - w, y = pos[0] === 't' ? m : H - m - h;
  return { ...o, x, y, w, h, rotate: 0 };
}

/**
 * Aplica los pasos a un documento. ctx: { batesNext, worker(lang), progress }. Devuelve
 * { doc, fit } — fit (si se pidió) se resuelve al guardar.
 */
async function runSteps(d, steps, ctx) {
  let fit = null, flatten = false;
  for (const st of steps) {
    const v = stepValues(st), all = d.pages.map((_, i) => i);
    switch (st.type) {
      case 'ocr': {
        const worker = await ctx.worker(v.lang);
        await ocrPages(d, all, { worker, skipWithText: !!v.skip, progress: ctx.progress });
        break;
      }
      case 'rotate': {
        const dir = +v.angle;
        for (const p of d.pages) {
          const [W, H] = dims(p);
          if (v.which === 'landscape' && W <= H) continue;
          if (v.which === 'portrait' && W > H) continue;
          for (let k = 0; k < Math.abs(dir === 2 ? 2 : 1); k++) { const s = dir === -1 ? -1 : 1; rotateOverlays(p, s); p.rot = ((p.rot + s * 90) % 360 + 360) % 360; }
        }
        break;
      }
      case 'stamp': {
        const idx = v.pages === 'all' ? all : v.pages === 'last' ? [all.length - 1] : [0];
        for (const i of idx) d.pages[i].ov.push(stampOverlay(d.pages[i], v));
        break;
      }
      case 'watermark':
        if (String(v.text || '').trim()) await applyWatermark(d, { text: v.text, size: 60, rotate: 45, color: '#d1242f', opacity: +v.opacity || 20, layout: v.layout, bold: true }, all);
        break;
      case 'pagenum': await applyPageNumbers(d, { fmt: v.fmt, pos: v.pos, size: 10, color: '#333333', start: 1 }, all); break;
      case 'bates': {
        const start = v.cont && ctx.batesNext != null ? ctx.batesNext : (+v.start || 0);
        ctx.batesNext = applyBates(d, { prefix: v.prefix, start, digits: +v.digits || 6, pos: 'br', size: 9 }, all);
        break;
      }
      case 'meta':
        d.meta = { ...d.meta, ...Object.fromEntries(['title', 'author', 'subject'].filter(k => String(v[k] || '').trim()).map(k => [k, tokens(v[k], 1, d.pages.length, d)])) };
        break;
      case 'compress': case 'flatten': {
        ctx.progress(st.type === 'compress' ? 'Comprimiendo…' : 'Aplanando…');
        const bytes = await buildPdf(d, { noEncrypt: true, ...(st.type === 'compress' ? { raster: COMPRESS_LEVELS[v.level] || COMPRESS_LEVELS.medium } : { flatten: true }) });
        const meta = d.meta; d = await docFromBytes(d.name, bytes, d.security); d.meta = meta;
        if (st.type === 'flatten') flatten = true;
        break;
      }
      case 'protect':
        if (v.userPw || v.ownerPw) d.security = { userPw: v.userPw || '', ownerPw: v.ownerPw || '', perms: { print: !!v.print, copy: !!v.copy, modify: false, annotate: false, forms: true, assemble: false } };
        break;
      case 'fit': fit = { max: Math.floor((+String(v.mb).replace(',', '.') || 4) * 1024 * 1024), minDpi: +v.minDpi || 96 }; break;
    }
  }
  return { doc: d, fit, flatten };
}

/** Guarda el resultado: un PDF o varias partes (si se pidió tamaño máximo y no alcanza). Siempre cifra al final. */
async function saveStepsResult(r, progress) {
  const d = r.doc;
  if (!r.fit) return [await buildPdf(d, { flatten: r.flatten, progress })];
  const res = await fitToSize(d, r.fit.max, { minDpi: r.fit.minDpi, mode: 'both', progress });
  const outs = res.parts ? res.parts.map(p => p.bytes) : [res.bytes];
  if (!d.security) return outs;
  const enc = [];
  for (const b of outs) { const e = await docFromBytes(d.name, b, d.security); e.meta = d.meta; enc.push(await buildPdf(e, {})); }
  return enc;
}

/** Procesa archivos ({ name, bytes, mime } o { name, doc }) con una lista de pasos. Devuelve el informe. */
async function runBatch(files, steps, { pattern = '{archivo}', progress = () => { } } = {}) {
  const workers = {}, report = [], outputs = [];
  const ctx = { batesNext: null, progress, worker: async lang => workers[lang] || (workers[lang] = await ocrWorker(lang, progress)) };
  const used = new Set();
  const outName = (f, i, k, n) => {
    let b = tokens(pattern, i + 1, files.length, { name: f.name }).replace(/[\\/:*?"<>|]+/g, '_').trim() || baseName(f.name);
    if (n > 1) b += `_parte${String(k + 1).padStart(2, '0')}`;
    let nm = b + '.pdf', j = 2; while (used.has(nm.toLowerCase())) nm = `${b} (${j++}).pdf`;
    used.add(nm.toLowerCase()); return nm;
  };
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i], t0 = performance.now();
      progress(`Procesando ${i + 1} de ${files.length}: ${f.name}…`, (i / files.length) * 100);
      try {
        let d = f.doc;
        if (d) { const meta = d.meta, sec = d.security; d = await docFromBytes(d.name, await buildPdf(d, { noEncrypt: true }), sec); d.meta = { ...meta }; }
        else { d = new Doc(f.name); d.pages = await addFileToDoc(d, f.bytes, f.name, f.mime); }
        const before = f.bytes?.length ?? null, pages = d.pages.length;
        const r = await runSteps(d, steps, ctx);
        const outs = await saveStepsResult(r, (m) => m && progress(m));
        outs.forEach((b, k) => outputs.push({ name: outName(f, i, k, outs.length), bytes: b }));
        report.push({ name: f.name, ok: true, pages: r.doc.pages.length || pages, before, after: outs.reduce((a, b) => a + b.length, 0), parts: outs.length, files: outputs.slice(-outs.length).map(o => o.name), ms: performance.now() - t0 });
      } catch (e) {
        report.push({ name: f.name, ok: false, error: e.message || String(e) });
      }
    }
  } finally { for (const w of Object.values(workers)) try { await w.terminate(); } catch { } }
  return { report, outputs };
}

/* ---------- Interfaz ---------- */
function stepEditor(step, onChange) {
  const def = BATCH_STEPS[step.type], v = stepValues(step), box = el('div', { class: 'bs-fields' });
  for (const f of def.fields) {
    let i;
    if (f.type === 'checkbox') { i = el('input', { type: 'checkbox' }); i.checked = !!v[f.key]; box.append(el('label', { class: 'chk' }, i, el('span', { text: f.label }))); }
    else {
      if (f.type === 'select') { i = el('select', { 'aria-label': f.label }); for (const [val, l] of (typeof f.options === 'function' ? f.options() : f.options)) i.append(el('option', { value: val, text: l })); i.value = String(v[f.key]); }
      else i = el('input', { type: f.type || 'text', 'aria-label': f.label, min: f.min, max: f.max, value: v[f.key] ?? '' });
      box.append(el('div', { class: 'row' }, el('label', { text: f.label }), i, f.hint ? el('div', { class: 'hint', text: f.hint }) : null));
    }
    i.onchange = i.oninput = () => { step.v = { ...(step.v || {}), [f.key]: i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value }; onChange && onChange(); };
  }
  return box;
}
function describeSteps(steps) { return steps.map(s => tr(BATCH_STEPS[s.type]?.label || s.type)).join(' → '); }

async function batchDialog(preset) {
  const files = [], cfg = S.settings;
  const autos = () => cfg.automations || (cfg.automations = []);
  let steps = structuredClone(preset?.steps || cfg.batchLast?.steps || [{ type: 'ocr' }, { type: 'compress' }]);
  const fileList = el('div', { class: 'recent-list', style: { maxHeight: '170px', overflow: 'auto', minHeight: '48px' } });
  const drawFiles = () => {
    fileList.innerHTML = '';
    if (!files.length) fileList.append(el('div', { class: 'cb-empty', text: 'Agregue los archivos a procesar (PDF, imágenes u Office en Windows)' }));
    files.forEach((f, i) => fileList.append(el('div', { class: 'recent-row' }, icEl(f.doc ? 'file-check' : isPdfName(f.name) ? 'file-text' : isOfficeName(f.name) ? 'file-type-2' : 'image'),
      el('span', { class: 'nm', text: f.name }), el('span', { class: 'src', text: f.doc ? tr('abierto') : fmtSize(f.bytes.length) }),
      el('button', { class: 'icon-btn sm', html: ic('x'), title: 'Quitar', onclick: () => { files.splice(i, 1); drawFiles(); } }))));
    count.textContent = files.length ? tr(`${files.length} archivo(s)`) : '';
  };
  const count = el('span', { class: 'hint' });
  const add = async from => { try { files.push(...await pickFiles(from, true)); drawFiles(); } catch (e) { toast(e.message, 'err'); } };
  const addOpen = () => { const m = S.docs.filter(d => d.pages.length && !files.some(f => f.doc === d)); if (!m.length) { toast('No hay más documentos abiertos.'); return; } m.forEach(doc => files.push({ name: doc.name, doc })); drawFiles(); };

  const stepList = el('div', { class: 'batch-steps' });
  const drawSteps = () => {
    stepList.innerHTML = '';
    if (!steps.length) stepList.append(el('div', { class: 'cb-empty', text: 'Agregue pasos con el menú de abajo' }));
    steps.forEach((st, i) => {
      const def = BATCH_STEPS[st.type];
      stepList.append(el('div', { class: 'bstep' },
        el('div', { class: 'bs-head' }, el('span', { class: 'bs-n', text: String(i + 1) }), icEl(def.icon), el('b', { text: def.label }),
          el('span', { style: { flex: 1 } }),
          el('button', { class: 'icon-btn sm', type: 'button', html: ic('arrow-up'), title: 'Subir', onclick: () => { if (i) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; drawSteps(); } } }),
          el('button', { class: 'icon-btn sm', type: 'button', html: ic('arrow-down'), title: 'Bajar', onclick: () => { if (i < steps.length - 1) { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; drawSteps(); } } }),
          el('button', { class: 'icon-btn sm', type: 'button', html: ic('x'), title: 'Quitar', onclick: () => { steps.splice(i, 1); drawSteps(); } })),
        def.fields.length ? stepEditor(st) : null));
    });
  };
  const addSel = el('select', { 'aria-label': 'Agregar paso' });
  addSel.append(el('option', { value: '', text: tr('+ Agregar paso…') }));
  for (const [k, d] of Object.entries(BATCH_STEPS)) addSel.append(el('option', { value: k, text: d.label }));
  addSel.onchange = () => { if (!addSel.value) return; const t = addSel.value; addSel.value = ''; if (t === 'fit') steps = steps.filter(s => s.type !== 'fit'); steps.push({ type: t }); drawSteps(); };

  // automatizaciones guardadas
  const autoSel = el('select', { 'aria-label': 'Automatización guardada' });
  const drawAutos = (sel) => {
    autoSel.innerHTML = ''; autoSel.append(el('option', { value: '', text: tr(autos().length ? '— Automatizaciones guardadas —' : '— Sin automatizaciones guardadas —') }));
    for (const a of autos()) autoSel.append(el('option', { value: a.id, text: a.name }));
    autoSel.value = sel || '';
  };
  autoSel.onchange = () => { const a = autos().find(x => x.id === autoSel.value); if (a) { steps = structuredClone(a.steps); pattern.value = a.pattern || '{archivo}'; drawSteps(); } };
  const saveAuto = async () => {
    if (!steps.length) { toast('Agregue al menos un paso.', 'err'); return; }
    const cur = autos().find(x => x.id === autoSel.value);
    const v = await formDialog('Guardar automatización', [{ key: 'name', label: 'Nombre', value: cur?.name || '', placeholder: tr('Ej.: Expediente para el portal aduanero') }, { type: 'hint', label: escapeHtml(describeSteps(steps)) }], { ok: 'Guardar', validate: v => v.name.trim() ? null : 'Escriba un nombre.' });
    if (!v) return;
    const same = autos().find(x => x.name.trim().toLowerCase() === v.name.trim().toLowerCase());
    const a = same || { id: uid() }; Object.assign(a, { name: v.name.trim(), steps: structuredClone(steps), pattern: pattern.value }); if (!same) autos().push(a);
    saveSettings(); drawAutos(a.id); renderRibbon(); toast('Automatización guardada.', 'ok');
  };
  const delAuto = async () => {
    const a = autos().find(x => x.id === autoSel.value); if (!a) { toast('Elija una automatización guardada.'); return; }
    if (!(await confirmDialog('Eliminar automatización', escapeHtml(tr(`¿Eliminar «${a.name}»?`)), 'Eliminar', true))) return;
    cfg.automations = autos().filter(x => x !== a); saveSettings(); drawAutos(); renderRibbon();
  };
  const pattern = el('input', { type: 'text', value: preset?.pattern || cfg.batchLast?.pattern || '{archivo}', 'aria-label': 'Nombre de los archivos resultantes' });
  const openRes = el('input', { type: 'checkbox' }); openRes.checked = !!cfg.batchLast?.open;

  const body = el('div', { class: 'fm batch' },
    el('h5', { text: 'Archivos' }),
    el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center' } },
      el('button', { class: 'btn', type: 'button', html: ic('files') + escapeHtml(tr('Documentos abiertos')), onclick: addOpen }),
      ...(PSN ? [el('button', { class: 'btn', type: 'button', html: ic('folder-open') + escapeHtml(tr('Elegir archivos')), onclick: () => add('local') })] : [
        el('button', { class: 'btn', type: 'button', html: ic('hard-drive') + escapeHtml(tr('Este equipo')), onclick: () => add('local') }),
        el('button', { class: 'btn', type: 'button', html: ic('cloud') + 'OneDrive', onclick: () => add('onedrive') }),
        el('button', { class: 'btn', type: 'button', html: ic('cloud') + 'Google Drive', onclick: () => add('gdrive') })]), count),
    fileList,
    el('h5', { text: 'Pasos' }),
    el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' } }, autoSel,
      el('button', { class: 'btn sm', type: 'button', html: ic('save') + escapeHtml(tr('Guardar como automatización…')), onclick: saveAuto }),
      el('button', { class: 'btn sm', type: 'button', html: ic('trash-2') + escapeHtml(tr('Eliminar')), onclick: delAuto })),
    stepList, addSel,
    el('div', { class: 'hint', style: { margin: '6px 0 10px' }, text: 'Los pasos se aplican en orden. «Ajustar a tamaño máximo» siempre se hace al final y la contraseña se aplica al guardar.' }),
    el('div', { class: 'cols' }, el('div', { class: 'row' }, el('label', { text: 'Nombre de los archivos resultantes' }), pattern, el('div', { class: 'hint', text: '{archivo} = nombre original · {n} = número · {fecha} = hoy' })),
      el('label', { class: 'chk', style: { alignSelf: 'center' } }, openRes, el('span', { text: 'Abrir los resultados en pestañas (hasta 10)' }))));
  drawFiles(); drawSteps(); drawAutos(preset?.id);
  const ok = await openModal({ title: 'Procesar por lotes', body, wide: true, buttons: [{ label: 'Cancelar', value: false }, {
    label: 'Procesar', primary: true, onClick: () => !files.length ? (toast('Agregue archivos.', 'err'), false) : !steps.length ? (toast('Agregue al menos un paso.', 'err'), false) : true }] }).result;
  if (!ok) return;
  cfg.batchLast = { steps, pattern: pattern.value, open: openRes.checked }; saveSettings();
  let res;
  try { res = await withBusy('Procesando…', upd => runBatch(files, steps, { pattern: pattern.value, progress: upd })); }
  catch (e) { toast(e.message, 'err', 9000); return; }
  await deliverBatch(res, openRes.checked);
}

async function deliverBatch({ report, outputs }, open) {
  if (outputs.length) {
    if (open && outputs.length <= 10) { for (const o of outputs) { const nd = await openBytes(o.name, o.bytes); nd.dirty = true; } renderTabs(); }
    else if (outputs.length === 1) download(new Blob([outputs[0].bytes], { type: 'application/pdf' }), outputs[0].name);
    else {
      const zip = new JSZip(); outputs.forEach(o => zip.file(o.name, o.bytes));
      download(await zip.generateAsync({ type: 'blob' }), `Lote_${new Date().toISOString().slice(0, 10)}.zip`);
    }
  }
  const ok = report.filter(r => r.ok).length;
  const rows = report.map(r => el('tr', {}, el('td', { text: r.name }), r.ok
    ? el('td', { text: `${r.pages} p. · ${r.before != null ? fmtSize(r.before) + ' → ' : ''}${fmtSize(r.after)}${r.parts > 1 ? ' · ' + tr(`${r.parts} partes`) : ''}` })
    : el('td', { class: 'err-txt', text: r.error })));
  await openModal({ title: 'Procesar por lotes', wide: true, body: el('div', {},
    el('p', { text: ok === report.length ? tr(`Se procesaron ${ok} archivo(s).`) : tr(`Se procesaron ${ok} de ${report.length} archivos; revise los errores.`) }),
    el('table', { class: 'kv batch-report' }, el('tbody', {}, ...rows))),
    buttons: [{ label: 'Entendido', primary: true, value: true }] }).result;
}

/** Ejecuta una automatización guardada sobre el documento actual (o pide archivos si no hay ninguno). */
async function runAutomation(a) {
  const d = D();
  if (!d) return batchDialog(a);
  let res;
  try { res = await withBusy(tr(`Aplicando «${a.name}»…`), upd => runBatch([{ name: d.name, doc: d }], a.steps, { pattern: a.pattern || '{archivo}', progress: upd })); }
  catch (e) { toast(e.message, 'err', 9000); return; }
  const r = res.report[0];
  if (!r.ok) { toast(r.error, 'err', 9000); return; }
  if (res.outputs.length === 1) { const nd = await openBytes(res.outputs[0].name, res.outputs[0].bytes); nd.dirty = true; renderTabs(); toast(tr(`«${a.name}» aplicada: ${fmtSize(r.after)}.`), 'ok', 6000); }
  else await deliverBatch(res, false);
}
/** Menú desplegable simple bajo un elemento. items: [{ label, icon, act } | { sep: true }] */
function popupMenu(anchor, items) {
  $$('.popmenu').forEach(m => m.remove());
  const m = el('div', { class: 'popmenu', role: 'menu' });
  const close = () => { m.remove(); document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', key, true); };
  const out = e => { if (!m.contains(e.target)) close(); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  for (const it of items) m.append(it.sep ? el('div', { class: 'pm-sep' }) : el('button', { type: 'button', role: 'menuitem', html: ic(it.icon || 'dot') + escapeHtml(it.label), onclick: () => { close(); it.act(); } }));
  document.body.append(m);
  const r = (anchor || document.body).getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(r.left, innerWidth - m.offsetWidth - 4)) + 'px'; m.style.top = Math.min(r.bottom + 2, innerHeight - m.offsetHeight - 4) + 'px';
  setTimeout(() => { document.addEventListener('mousedown', out, true); document.addEventListener('keydown', key, true); m.querySelector('button')?.focus(); });
}
function automationsMenu() {
  const list = S.settings.automations || [];
  const anchor = $$('.rbtn').find(b => b._def?.act === automationsMenu);
  popupMenu(anchor, [...list.map(a => ({ label: a.name, icon: 'play', act: () => runAutomation(a) })), ...(list.length ? [{ sep: true }] : []),
    { label: tr('Procesar por lotes…'), icon: 'layers', act: () => batchDialog() }]);
}
