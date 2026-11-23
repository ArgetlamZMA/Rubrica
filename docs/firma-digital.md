# Firma digital

PDF Studio firma documentos con un certificado digital (por ejemplo, el de firma electrónica emitido por el **SAR de Honduras**).

## Con archivo `.p12` / `.pfx`

1. Abra el PDF y vaya a **Proteger → Firma digital**.
2. Pulse **Elegir .p12 / .pfx**, escriba la contraseña del certificado y pulse **Verificar certificado**. Verá el titular, el emisor y la fecha de vencimiento.
3. Elija el motivo y la ubicación (por defecto «San Pedro Sula, Honduras»), y si la firma será **visible** o **invisible**.
4. Si es visible, dibuje en la página el recuadro donde aparecerá. Puede incluir su firma manuscrita guardada.
5. Elija dónde guardar el PDF firmado (equipo, OneDrive o Google Drive).

La contraseña **nunca** se guarda. Opcionalmente la app recuerda el archivo `.p12` en este equipo para no buscarlo cada vez.

## Con el almacén de Windows o un token USB (app de escritorio)

Si importó el certificado en Windows (doble clic en el `.p12` → Importar) o usa un token con su controlador instalado, elija la pestaña **Almacén de Windows / token**. Windows pedirá el PIN si corresponde; la clave privada nunca sale de Windows.

## Qué tipo de firma se genera

- Formato **CMS/PKCS#7 desacoplado** (`adbe.pkcs7.detached`) con **SHA-256**, el formato estándar que Adobe Acrobat/Reader valida.
- Se incluye la cadena de certificados que trae el archivo y la hora de firma.
- Se agrega como **actualización incremental**: un documento puede tener varias firmas y agregar comentarios después no rompe las anteriores (Acrobat lo mostrará como «cambios posteriores a la firma»).

## Verificar firmas

El panel **Firmas** (barra lateral) revisa cada firma del documento:

- **Firma íntegra**: el contenido firmado no cambió.
- **Firma íntegra (con cambios posteriores permitidos)**: hay revisiones posteriores (otra firma o comentarios).
- **Firma NO válida**: el contenido firmado fue alterado.

La **confianza** en la autoridad emisora (que el certificado realmente fue emitido por el SAR) se confirma en Adobe Acrobat/Reader agregando el certificado raíz de la autoridad a sus certificados de confianza. PDF Studio no incluye una lista de autoridades raíz.

## Limitaciones actuales

- Certificados con clave ECDSA: use el almacén de Windows (la lectura de `.p12` admite RSA).
- No se agrega sello de tiempo de una autoridad TSA (la hora es la del equipo).
- No se puede firmar un documento protegido con contraseña: quite la contraseña antes de firmar.
