# Cambios

## 1.5.0 — en preparación
- **Redacción que conserva el texto**: la página redactada sigue siendo buscable y se puede copiar, excepto lo que está bajo los recuadros. Cualquier palabra que toque un recuadro se elimina del archivo.
- **Quitar información oculta** (*Proteger*): crea una copia limpia sin metadatos ni XMP, adjuntos, JavaScript y acciones automáticas, enlaces que ejecutan programas, capas ocultas, miniaturas ni datos privados de otras aplicaciones; opcionalmente sin comentarios, formularios ni marcadores. Muestra un informe de lo que quitó.
- **Guardar como PDF/A-2b** (*Convertir → PDF/A*), el formato de archivo a largo plazo: metadatos XMP, perfil de color sRGB e identificador; quita JavaScript, adjuntos y acciones. Solo las páginas que no pueden cumplir (fuentes sin incrustar, color CMYK, LZW) se convierten en imagen, con el texto buscable. Una copia PDF/A sigue siéndolo al editarla y guardarla. Los archivos generados se validan con veraPDF en cada compilación.
- La compilación se detiene si dos archivos de la interfaz declaran el mismo nombre (antes la app no arrancaba).

## 1.4.0 — en preparación
- **Códigos QR y de barras (Code 128)** en *Editar → Código QR / barras*: vectoriales (nítidos al imprimir), con el contenido editable en el panel de propiedades y texto legible opcional bajo el código de barras. Para enlaces, números de contenedor, guías, DUCA, etc.
- **Sellos para logística y aduanas**: RECIBIDO CONFORME, LIQUIDADO, AFORADO, ENTREGADO, COPIA FIEL, NO NEGOCIABLE y los anteriores, con color según el tipo, fecha, hora y nombre del usuario. Se escriben en el idioma de la interfaz.
- **Ajustar al tamaño de un portal** en *Convertir → Ajustar a tamaño*: indique el límite en MB (aduanas, SAR, bancos, licitaciones) y Rúbrica comprime el PDF hasta que quepa, buscando la mayor resolución posible sin bajar de la mínima elegida; si no alcanza, lo divide en partes de máximo ese tamaño (en un ZIP con el rango de páginas en el nombre de cada parte).
- **Armar expediente** (*Inicio → Expediente*, *Organizar → Armar expediente* o la tarjeta de la pantalla de inicio): une documentos abiertos, archivos del equipo o de la nube en un solo PDF con portada (datos del expediente, logotipo y color propios), índice con enlaces a cada documento, marcadores, numeración Bates (también correcta en páginas giradas) y, si se pide, ajuste a un tamaño máximo en MB. Trae datos predefinidos para aduanas (importador, RTN, DUCA, régimen, aduana, BL, contenedores, facturas, agente aduanero), licitaciones y uso general; los datos se pueden editar o agregar y se recuerdan para el próximo expediente.
- **Abrir documentos de Word, Excel y PowerPoint** en la app de Windows (*Convertir → Desde Office*, *Abrir*, arrastrar y soltar, combinar o armar expediente): se convierten a PDF con el Microsoft Office instalado o, si no hay, con LibreOffice. La conversión es local, con las macros desactivadas, y no toca un Office que el usuario tenga abierto.
- **Procesar por lotes y automatizaciones** (*Convertir → Por lotes*, *Inicio → Automatizaciones*): aplique a muchos archivos una secuencia de pasos (OCR, girar, sello, marca de agua, números de página, Bates continuo entre archivos, propiedades, comprimir, aplanar, contraseña y tamaño máximo) y descargue el resultado en un ZIP con un informe por archivo. Guarde la secuencia con un nombre para repetirla con un clic sobre el documento abierto.
- **Comparar versiones** (*Inicio → Comparar*, *Organizar → Comparar versiones*): compara un original con su versión revisada palabra por palabra y por apariencia (sellos, firmas, imágenes; útil con escaneos que tienen OCR). Abre una copia de la versión revisada con lo agregado en verde, lo modificado en naranja (con una nota que muestra el texto anterior), lo eliminado como nota roja y recuadros donde cambió la apariencia. Incluye una lista de cambios con enlace a cada página, exportable a CSV.
- **Comprimir ya no quita el texto**: al convertir páginas en imagen (Comprimir, Ajustar a tamaño, Armar expediente), el texto, incluido el de OCR, se vuelve a escribir como capa invisible en el mismo lugar. El PDF comprimido sigue siendo buscable y se puede copiar. Las páginas con redacción permanente siguen saliendo sin texto.
- **Corrección de seguridad en la redacción permanente**: al convertir una página en imagen, su contenido original (texto e imágenes tapados) quedaba en el archivo como objetos sin usar, recuperables con herramientas de análisis de PDF. Ahora se borra la página original, se quitan los campos de formulario que tenía y se eliminan del archivo todos los objetos que ya nadie referencia. Esto también hace que la compresión reduzca el tamaño de verdad. **Si redactó documentos con versiones anteriores, vuelva a exportarlos con esta versión antes de compartirlos.**

## 1.3.0 — en preparación
- **Confianza en las firmas**: el panel Firmas distingue *Firma válida · emisor de confianza* (cadena verificada hasta una raíz de confianza), *Firma íntegra · emisor no verificado* (el documento no cambió, pero no se puede confirmar quién emitió el certificado) y *Firma NO válida*. Antes cualquier firma íntegra se mostraba en verde, aunque el certificado fuera autofirmado.
- Raíces de confianza: certificados importados (`.cer`, `.crt`, `.pem`) en *Preferencias de firma → Certificados de confianza*, «Confiar en este emisor» desde el panel Firmas (con la huella SHA-256 para compararla), el almacén de Windows y los certificados de CA instalados en Android. Se comprueba la firma de cada eslabón y la vigencia de cada certificado en la fecha de la firma (o de la marca de tiempo).
- **Interfaz en inglés y portugués**, además de español: *Configuración → Idioma de la interfaz* (automático según el idioma del sistema). Fechas con el formato regional del idioma; el motivo y las etiquetas del recuadro de firma se escriben en el idioma elegido. El contenido de los documentos nunca se traduce. Las traducciones están en `web/src/i18n/ui.tsv` (una fila por texto: español, inglés, portugués), fáciles de corregir o ampliar.
- **OCR sin internet** en Windows y en la versión web: el motor Tesseract y los idiomas español, inglés, portugués y francés vienen incluidos (antes se descargaban de un CDN la primera vez).
- **Windows en ARM** (ARM64): instalador nativo `Rubrica-Instalador-x.y.z-arm64.exe`; el actualizador elige el instalador de la arquitectura del equipo.
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
