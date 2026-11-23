# Cambios

## 1.2.0 — 2026-11-23
- **Android: firma digital con el certificado instalado en el teléfono** (por ejemplo, la firma electrónica del SAR importada desde su `.pfx` en *Ajustes → Seguridad*). La clave privada no sale del almacén de Android, la contraseña no se vuelve a escribir y Rúbrica recuerda el certificado elegido. Admite claves RSA y EC.
- La firma generada es la misma que en Windows (CMS desacoplado, SHA-256, `adbe.pkcs7.detached`), validada por Adobe Acrobat/Reader.

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
