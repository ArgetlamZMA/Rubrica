/* ============================================================
   07c · Ajustar al tamaño de un portal (p. ej. límite de carga en MB)
   1) Optimización sin pérdida. 2) Si no alcanza, páginas como imagen
   bajando la resolución por pasos hasta un mínimo. 3) Si aún no
   alcanza (o se pidió no perder calidad), dividir en partes de
   máximo X MB.
   ============================================================ */
const FIT_STEPS = [{ dpi: 200, quality: 0.8 }, { dpi: 150, quality: 0.72 }, { dpi: 130, quality: 0.66 }, { dpi: 110, quality: 0.6 }, { dpi: 96, quality: 0.55 }, { dpi: 84, quality: 0.5 }, { dpi: 72, quality: 0.45 }, { dpi: 72, quality: 0.32 }];

/** Divide bytes PDF en partes de máximo maxBytes. Devuelve [{ bytes, from, to }] (páginas desde 1). */
async function splitBytesBySize(bytes, maxBytes, progress) {
  const src = await PL.PDFDocument.load(bytes, { ignoreEncryption: true }), n = src.getPageCount();
  const build = async idx => { const out = await PL.PDFDocument.create(); (await out.copyPages(src, idx)).forEach(p => out.addPage(p)); return out.save({ useObjectStreams: true }); };
  // tamaño aproximado de cada página por separado (incluye sus recursos)
  const sizes = [];
  for (let i = 0; i < n; i++) { sizes.push((await build([i])).length); progress && progress(`Midiendo página ${i + 1} de ${n}…`, (i / n) * 50); }
  const big = sizes.findIndex(s => s > maxBytes);
  if (big >= 0) throw new Error(`La página ${big + 1} pesa ${fmtSize(sizes[big])}, más que el límite de ${fmtSize(maxBytes)}. Comprímala más o reduzca su resolución.`);
  const groups = []; let cur = [], sum = 0;
  sizes.forEach((s, i) => { if (cur.length && sum + s > maxBytes * 0.97) { groups.push(cur); cur = []; sum = 0; } cur.push(i); sum += s; });
  if (cur.length) groups.push(cur);
  const parts = [];
  const pack = async idx => {
    const b = await build(idx);
    if (b.length <= maxBytes || idx.length === 1) { parts.push({ bytes: b, from: idx[0] + 1, to: idx[idx.length - 1] + 1 }); return; }
    const h = Math.ceil(idx.length / 2); await pack(idx.slice(0, h)); await pack(idx.slice(h));
  };
  for (let g = 0; g < groups.length; g++) { await pack(groups[g]); progress && progress(`Armando parte ${g + 1} de ${groups.length}…`, 50 + (g / groups.length) * 50); }
  return parts;
}

async function fitSizeDialog() {
  const d = D(); if (!d) return;
  const v = await formDialog('Ajustar al tamaño de un portal', [
    { key: 'mb', label: 'Tamaño máximo por archivo (MB)', value: String(S.settings.fitMb || 4), placeholder: '4', row: 'cols' },
    { key: 'minDpi', label: 'Resolución mínima', type: 'select', value: String(S.settings.fitMinDpi || 96), row: 'cols', options: [['150', '150 ppp (texto muy nítido)'], ['110', '110 ppp'], ['96', '96 ppp (recomendado)'], ['72', '72 ppp (máxima compresión)']] },
    { key: 'mode', label: 'Método', type: 'select', value: S.settings.fitMode || 'both', options: [['both', 'Comprimir y, si no alcanza, dividir en partes'], ['compress', 'Solo comprimir'], ['split', 'Solo dividir en partes (sin perder calidad)']] },
    { type: 'hint', label: 'Para portales con límite de carga (aduanas, SAR, bancos, licitaciones). Primero se intenta sin pérdida; si hace falta, las páginas se convierten en imagen bajando la resolución hasta la mínima elegida (el texto deja de ser seleccionable; puede aplicar OCR después).' }
  ], { ok: 'Ajustar', validate: v => (+String(v.mb).replace(',', '.') > 0.05 ? null : 'Escriba un tamaño en MB mayor que 0.') });
  if (!v) return;
  const mb = +String(v.mb).replace(',', '.'), max = Math.floor(mb * 1024 * 1024), minDpi = +v.minDpi;
  S.settings.fitMb = mb; S.settings.fitMinDpi = minDpi; S.settings.fitMode = v.mode; saveSettings();
  try {
    const res = await withBusy('Ajustando tamaño…', upd => fitToSize(d, max, { minDpi, mode: v.mode, progress: upd }));
    if (res.parts) {
      const zip = new JSZip();
      res.parts.forEach((p, i) => zip.file(`${baseName(d.name)}_parte${String(i + 1).padStart(2, '0')}_p${p.from}-${p.to}.pdf`, p.bytes));
      download(await zip.generateAsync({ type: 'blob' }), baseName(d.name) + `_partes_${mb}MB.zip`);
      const head = res.dpi ? `Se generaron ${res.parts.length} partes de máximo ${fmtSize(max)} (páginas a ${res.dpi} ppp):` : `Se generaron ${res.parts.length} partes de máximo ${fmtSize(max)} sin perder calidad:`;
      alertDialog('Ajustar al tamaño de un portal', escapeHtml(head) + '<br><br>' + res.parts.map((p, i) => escapeHtml(`Parte ${i + 1}: páginas ${p.from}–${p.to} · ${fmtSize(p.bytes.length)}`)).join('<br>'));
    } else {
      const nd = await openBytes(baseName(d.name) + `_${mb}MB.pdf`, res.bytes); nd.dirty = true; renderTabs();
      toast(res.dpi ? `Listo: ${fmtSize(res.bytes.length)} (límite ${fmtSize(max)}) · páginas a ${res.dpi} ppp.` : `Listo: ${fmtSize(res.bytes.length)} (límite ${fmtSize(max)}) · sin pérdida.`, 'ok', 7000);
    }
  } catch (e) { toast(e.message, 'err', 9000); }
}

/** Ajusta un documento a maxBytes. Devuelve { bytes, dpi } o { parts:[{bytes, from, to}], dpi }. */
async function fitToSize(d, maxBytes, { minDpi = 96, mode = 'both', progress } = {}) {
  const prog = progress || (() => { });
  prog('Optimizando sin pérdida…', 5);
  const lossless = await buildPdf(d, { noEncrypt: true });
  if (lossless.length <= maxBytes) return { bytes: lossless, dpi: null };
  if (mode === 'split') return { parts: await splitBytesBySize(lossless, maxBytes, prog), dpi: null };
  // el tamaño de una página como imagen crece con el cuadrado de la resolución: tras cada intento
  // se salta a la resolución estimada en lugar de probar todos los pasos
  let best = null, target = Infinity;
  for (const st of FIT_STEPS.filter(s => s.dpi >= minDpi)) {
    if (st.dpi > target && st !== FIT_STEPS.filter(s => s.dpi >= minDpi).at(-1)) continue;
    prog(`Probando ${st.dpi} ppp…`, 20);
    const b = await buildPdf(d, { noEncrypt: true, raster: st });
    best = { bytes: b, dpi: st.dpi };
    if (b.length <= maxBytes) return best;
    target = st.dpi * Math.sqrt(maxBytes / b.length) * 1.05;
  }
  if (mode === 'compress') throw new Error(`Con ${minDpi} ppp el documento pesa ${fmtSize(best.bytes.length)}, más que ${fmtSize(maxBytes)}. Baje la resolución mínima o use «dividir en partes».`);
  return { parts: await splitBytesBySize(best.bytes, maxBytes, prog), dpi: best.dpi };
}
