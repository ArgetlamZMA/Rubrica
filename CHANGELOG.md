# Cambios

## 1.3.0 — en preparación
- **Confianza en las firmas**: el panel Firmas distingue *Firma válida · emisor de confianza* (cadena verificada hasta una raíz de confianza), *Firma íntegra · emisor no verificado* (el documento no cambió, pero no se puede confirmar quién emitió el certificado) y *Firma NO válida*. Antes cualquier firma íntegra se mostraba en verde, aunque el certificado fuera autofirmado.
- Raíces de confianza: certificados importados (`.cer`, `.crt`, `.pem`) en *Preferencias de firma → Certificados de confianza*, «Confiar en este emisor» desde el panel Firmas (con la huella SHA-256 para compararla), el almacén de Windows y los certificados de CA instalados en Android. Se comprueba la firma de cada eslabón y la vigencia de cada certificado en la fecha de la firma (o de la marca de tiempo).
- **OCR sin internet** en Windows y en la versión web: el motor Tesseract y los idiomas español, inglés, portugués y francés vienen incluidos (antes se descargaban de un CDN la primera vez).
- **Windows en ARM** (ARM64): instalador nativo `Rubrica-Setup-x.y.z-arm64.exe`; el actualizador elige el instalador de la arquitectura del equipo.
- Instalador en español, inglés y portugués, con página de privacidad, e instalación automática de WebView2 si falta.
- Preparación para la firma de código con SignPath Foundation ([CODE_SIGNING.md](CODE_SIGNING.md), [PRIVACY.md](PRIVACY.md), [docs/firma-de-codigo.md](docs/firma-de-codigo.md)).
- **Actualizaciones verificadas** (Windows): cada versión publica `SHA256SUMS.txt` firmado (ECDSA P-256); la app solo ejecuta el instalador si la firma del manifiesto y el SHA-256 del instalador coinciden. Si no, no se ejecuta nada y se ofrece la página de descarga.

## 1.2.0 — 2026-11-23
- **Android: firma digital con el certificado instalado en el teléfono** (por ejemplo, la firma electrónica del SAR importada desde su `.pfx` en *Ajustes → Seguridad*). La clave privada no sale del almacén de Android, la contraseña no se vuelve a escribir y Rúbrica recuerda el certificado elegido. Admite claves RSA y EC.
- La firma generada es la misma que en Windows (CMS desacoplado, SHA-256, `adbe.pkcs7.detached`), validada por Adobe Acrobat/Reader.
- **Marca de tiempo (RFC 3161)** en las firmas, con la TSA del SAR configurada y predeterminada (`http://tsa.sar.gob.hn/CryptosecOpenKey/tsa_service`); se pueden añadir y probar otros servidores. El panel de firmas muestra la hora y la autoridad del sello.
- **Preferencias de firma** (como en PDFelement): lista de identificaciones digitales (archivos `.p12/.pfx` guardados sin contraseña, almacén de Windows y Android) con titular, emisor, vigencia y uso previsto; **estilos de apariencia** del recuadro (gráfico: nombre, imagen o ninguno; nombre, ubicación, nombre distinguido, logo, fecha, hora, razón, etiquetas; dirección del texto) con vista previa; servidores de marca de tiempo.
- Nuevo diálogo de firma: «Firmar como», aspecto con vista previa y marca de tiempo.
- **Atajos de teclado** de escritorio: Ctrl+W/Ctrl+F4 cerrar, Ctrl+Tab cambiar de documento, Ctrl+N nuevo, Ctrl+E editar, Ctrl+A seleccionar todo, Ctrl+C/X/V objetos, Ctrl+R girar, Ctrl+0/1/2 vistas, Ctrl+G ir a página, Ctrl+L/F11 pantalla completa, F3 siguiente resultado, F4 panel lateral y **F1** con la lista completa. En Windows se desactivan las teclas del navegador interno (F5 ya no recarga la app).

## 1.1.1 — 2026-11-23
- Primera publicación del APK de Android firmado con la clave definitiva (la 1.1.0 solo incluyó Windows y web).

## 1.1.0 — 2026-11-23
- **Nuevo nombre: Rúbrica** (antes «PDF Studio»). Al actualizar en Windows se conservan la configuración, las firmas y los recientes, y se retiran los accesos directos y la asociación «Abrir con» del nombre anterior.
- **Android**: nueva app (Capacitor) con escáner de documentos de Google ML Kit, OCR sin conexión, selector de archivos de Android (teléfono, Drive, OneDrive), «Abrir con», compartir e imprimir.
- Interfaz táctil: pellizcar para zoom, hoja de propiedades, controles más grandes, diseño para teléfono y plegables.
- La capa de texto OCR se guarda en orden de lectura (mejor al copiar y buscar).

## 1.0.0 — 2026-11-23
- Primera versión pública.
- Editor completo: comentarios, edición de texto, páginas, formularios, conversión, OCR, compresión y protección.
- Firma digital con certificados `.p12/.pfx` y del almacén de Windows; panel de verificación de firmas.
- Aptos como fuente predeterminada; fuentes del sistema y de Microsoft 365; detección de la fuente original al editar.
- OneDrive y Google Drive sin intermediarios.
- Aplicación de Windows (C# + WebView2) con instalador, «Abrir con» y actualizaciones automáticas.
