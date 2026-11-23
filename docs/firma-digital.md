# Firma digital

Rúbrica firma documentos con un certificado digital (por ejemplo, el de firma electrónica emitido por el **SAR de Honduras**).

## Con archivo `.p12` / `.pfx`

1. Abra el PDF y vaya a **Proteger → Firma digital**.
2. Pulse **Elegir .p12 / .pfx**, escriba la contraseña del certificado y pulse **Verificar certificado**. Verá el titular, el emisor y la fecha de vencimiento.
3. Elija el motivo y la ubicación (por defecto «San Pedro Sula, Honduras»), y si la firma será **visible** o **invisible**.
4. Si es visible, dibuje en la página el recuadro donde aparecerá. Puede incluir su firma manuscrita guardada.
5. Elija dónde guardar el PDF firmado (equipo, OneDrive o Google Drive).

La contraseña **nunca** se guarda. Opcionalmente la app recuerda el archivo `.p12` en este equipo para no buscarlo cada vez.

## Con el almacén de Windows o un token USB (app de escritorio)

Si importó el certificado en Windows (doble clic en el `.p12` → Importar) o usa un token con su controlador instalado, elija la pestaña **Almacén de Windows / token**. Windows pedirá el PIN si corresponde; la clave privada nunca sale de Windows.

## Con el certificado instalado en Android (app de Android)

Es la forma recomendada en el teléfono: el certificado se instala una sola vez en Android y la clave privada queda en el almacén del sistema.

1. Copie el `.pfx` al teléfono **por cable USB** (no lo envíe por WhatsApp ni por correo).
2. El teléfono debe tener bloqueo de pantalla (PIN, patrón o contraseña).
3. En Samsung: **Ajustes → Seguridad y privacidad → Más ajustes de seguridad → Instalar desde almacenamiento del dispositivo → Certificado de usuario de VPN y app**. Elija el `.pfx`, escriba su contraseña y póngale un nombre (por ejemplo «Firma SAR»). En otras marcas el menú es parecido (*Seguridad → Cifrado y credenciales → Instalar un certificado*).
4. Opcional: instale también los certificados raíz y subordinado del SAR (`CARoot.cer`, `CASub.cer`) como **Certificado de CA**.
5. Borre el `.pfx` de la carpeta Descargas del teléfono.
6. En Rúbrica: **Proteger → Firma digital → Certificado de Android → Elegir certificado**. Android preguntará una vez si Rúbrica puede usarlo; desde entonces la app lo recuerda.

Rúbrica solo pide a Android que firme el resumen del documento: nunca recibe la clave privada ni la contraseña. Repita la instalación en cada teléfono.

## Qué tipo de firma se genera

- Formato **CMS/PKCS#7 desacoplado** (`adbe.pkcs7.detached`) con **SHA-256**, el formato estándar que Adobe Acrobat/Reader valida.
- Se incluye la cadena de certificados que trae el archivo y la hora de firma.
- Se agrega como **actualización incremental**: un documento puede tener varias firmas y agregar comentarios después no rompe las anteriores (Acrobat lo mostrará como «cambios posteriores a la firma»).

## Verificar firmas

El panel **Firmas** (barra lateral) revisa cada firma del documento:

- **Firma íntegra**: el contenido firmado no cambió.
- **Firma íntegra (con cambios posteriores permitidos)**: hay revisiones posteriores (otra firma o comentarios).
- **Firma NO válida**: el contenido firmado fue alterado.

La **confianza** en la autoridad emisora (que el certificado realmente fue emitido por el SAR) se confirma en Adobe Acrobat/Reader agregando el certificado raíz de la autoridad a sus certificados de confianza. Rúbrica no incluye una lista de autoridades raíz.

## Limitaciones actuales

- Certificados con clave ECDSA: use el almacén de Windows o el certificado instalado en Android (la lectura de archivos `.p12` admite RSA).
- No se agrega sello de tiempo de una autoridad TSA (la hora es la del equipo).
- No se puede firmar un documento protegido con contraseña: quite la contraseña antes de firmar.
