"""Comprobaciones de PDF/A-2b (subconjunto de las reglas de veraPDF) con pikepdf.
Devuelve una lista de problemas; vacía = cumple lo comprobado. En CI se valida además con veraPDF."""
import re
import pikepdf
from pikepdf import Name

def _xmp_text(xmp, tag):
    m = re.search(rf'<{tag}>(.*?)</{tag}>', xmp, re.S)
    if not m: return None
    v = re.sub(r'<[^>]+>', '', m.group(1)).strip()
    return v

def _pdf_date_to_iso(d):
    m = re.match(r"D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z", str(d))
    return f'{m[1]}-{m[2]}-{m[3]}T{m[4]}:{m[5]}:{m[6]}Z' if m else None

def _embedded(font):
    if font.get('/Subtype') == '/Type3': return True
    fd = font.get('/FontDescriptor')
    if font.get('/Subtype') == '/Type0':
        fd = font['/DescendantFonts'][0].get('/FontDescriptor')
    return fd is not None and any(k in fd for k in ('/FontFile', '/FontFile2', '/FontFile3'))

def _cmyk_cs(cs):
    if cs is None: return False
    if isinstance(cs, Name): return str(cs) in ('/DeviceCMYK', '/CMYK')
    if isinstance(cs, pikepdf.Array) and len(cs):
        k = str(cs[0])
        if k == '/ICCBased': return int(cs[1].get('/N', 3)) == 4
        if k == '/Indexed': return _cmyk_cs(cs[1])
        if k in ('/Separation', '/DeviceN'): return _cmyk_cs(cs[2])
    return False

def _filters(obj):
    f = obj.get('/Filter')
    if f is None: return []
    return [str(x) for x in f] if isinstance(f, pikepdf.Array) else [str(f)]

def _scan(pdf, stream_owner, resources, problems, where, tr0=0, depth=0, seen=None):
    seen = seen if seen is not None else set()
    if depth > 8: return
    fonts = resources.get('/Font', {}) if resources is not None else {}
    xobjs = resources.get('/XObject', {}) if resources is not None else {}
    css = resources.get('/ColorSpace', {}) if resources is not None else {}
    tr, stack, font = tr0, [], None
    for operands, op in pikepdf.parse_content_stream(stream_owner):
        op = str(op)
        if op == 'q': stack.append(tr)
        elif op == 'Q': tr = stack.pop() if stack else tr
        elif op == 'Tr': tr = int(operands[0])
        elif op == 'Tf': font = str(operands[0])
        elif op in ('Tj', 'TJ', "'", '"'):
            if tr != 3:
                f = fonts.get(font) if font else None
                if f is None or not _embedded(f): problems.append(f'{where}: fuente no incrustada usada de forma visible ({font})')
        elif op in ('k', 'K'): problems.append(f'{where}: color CMYK ({op})')
        elif op in ('cs', 'CS'):
            n = str(operands[0])
            if n == '/DeviceCMYK' or _cmyk_cs(css.get(n)): problems.append(f'{where}: espacio de color CMYK')
        elif op == 'INLINE IMAGE':
            pass
        elif op == 'Do':
            x = xobjs.get(str(operands[0]))
            if x is None: continue
            if x.get('/Subtype') == '/Image':
                if _cmyk_cs(x.get('/ColorSpace')): problems.append(f'{where}: imagen CMYK')
                if '/LZWDecode' in _filters(x): problems.append(f'{where}: imagen LZW')
                if x.get('/Interpolate') is True: problems.append(f'{where}: imagen con Interpolate')
            elif x.get('/Subtype') == '/Form':
                key = (x.objgen, tr)
                if key in seen: continue
                seen.add(key)
                _scan(pdf, x, x.get('/Resources', resources), problems, where, tr, depth + 1, seen)

def check_pdfa2b(path):
    problems = []
    raw = open(path, 'rb').read()
    if not raw.startswith(b'%PDF-1.') or not re.match(rb'%PDF-1\.\d[\r\n]+%[\x80-\xff]{4}', raw): problems.append('cabecera sin comentario binario')
    pdf = pikepdf.open(path)
    if pdf.is_encrypted: problems.append('cifrado')
    tr = pdf.trailer
    if '/ID' not in tr: problems.append('el trailer no tiene /ID')
    root = pdf.Root
    md = root.get('/Metadata')
    if md is None: problems.append('sin XMP'); xmp = ''
    else:
        if '/Filter' in md: problems.append('el XMP está comprimido')
        xmp = md.read_bytes().decode('utf-8', 'replace')
        if _xmp_text(xmp, 'pdfaid:part') != '2' or _xmp_text(xmp, 'pdfaid:conformance') != 'B': problems.append('XMP sin pdfaid 2B')
    info = pdf.docinfo
    for k, tag in (('/Title', 'dc:title'), ('/Author', 'dc:creator'), ('/Subject', 'dc:description'), ('/Keywords', 'pdf:Keywords'), ('/Producer', 'pdf:Producer'), ('/Creator', 'xmp:CreatorTool')):
        if k in info and _xmp_text(xmp, tag) != str(info[k]): problems.append(f'Info {k} no coincide con XMP {tag}: {info[k]!s} / {_xmp_text(xmp, tag)}')
    for k, tag in (('/CreationDate', 'xmp:CreateDate'), ('/ModDate', 'xmp:ModifyDate')):
        if k in info and _pdf_date_to_iso(info[k]) != _xmp_text(xmp, tag): problems.append(f'Info {k} no coincide con XMP {tag}')
    ois = root.get('/OutputIntents')
    if not ois or not any(o.get('/S') == '/GTS_PDFA1' and '/DestOutputProfile' in o for o in ois): problems.append('sin OutputIntent GTS_PDFA1')
    names = root.get('/Names', {})
    if '/JavaScript' in names: problems.append('JavaScript')
    if '/EmbeddedFiles' in names: problems.append('adjuntos')
    if '/OpenAction' in root and root.OpenAction.get('/S') in ('/JavaScript', '/Launch'): problems.append('OpenAction con script')
    if '/AA' in root: problems.append('acciones /AA en el catálogo')
    af = root.get('/AcroForm')
    if af is not None and af.get('/NeedAppearances') is True: problems.append('NeedAppearances')
    for obj in pdf.objects:
        if isinstance(obj, pikepdf.Stream) and '/LZWDecode' in _filters(obj): problems.append('flujo LZW')
    for i, page in enumerate(pdf.pages):
        where = f'página {i + 1}'
        if '/AA' in page.obj: problems.append(f'{where}: acciones /AA')
        _scan(pdf, page, page.obj.get('/Resources'), problems, where)
        for a in page.obj.get('/Annots', []):
            st = str(a.get('/Subtype'))
            if st == '/Popup': continue
            f = int(a.get('/F', 0))
            if not f & 4 or f & (1 | 2 | 32 | 256): problems.append(f'{where}: anotación {st} con banderas {f}')
            if st != '/Link':
                ap = a.get('/AP')
                if ap is None or '/N' not in ap: problems.append(f'{where}: anotación {st} sin apariencia')
                elif st != '/Widget' and not isinstance(ap.N, pikepdf.Stream): problems.append(f'{where}: apariencia {st} no es un flujo')
                else:
                    for ff in ([ap.N] if isinstance(ap.N, pikepdf.Stream) else []):
                        _scan(pdf, ff, ff.get('/Resources'), problems, f'{where} (apariencia {st})')
            act = a.get('/A')
            if act is not None and str(act.get('/S')) in ('/JavaScript', '/Launch', '/ImportData', '/SubmitForm', '/ResetForm', '/Movie', '/Sound'): problems.append(f'{where}: acción {act.get("/S")}')
    return sorted(set(problems))

if __name__ == '__main__':
    import sys
    for p in sys.argv[1:]:
        r = check_pdfa2b(p)
        print(p, 'OK' if not r else r)
