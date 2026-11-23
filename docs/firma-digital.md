# Firma digital

Rúbrica firma documentos con un certificado digital (por ejemplo, el de firma electrónica emitido por el **SAR de Honduras**).

## Firmar

1. Abra el PDF y vaya a **Proteger → Firma digital**.
2. En **Firmar como** elija su certificado. La primera vez elija **Añadir archivo .p12 / .pfx…**, escriba la contraseña y Rúbrica lo guarda en su lista de identificaciones digitales (sin la contraseña). Verá el titular, el número de identidad o RTN, el emisor, la vigencia y el uso previsto.
3. Escriba la contraseña del certificado (se pide en cada firma; **nunca** se guarda).
4. Elija el motivo, la ubicación (por defecto «San Pedro Sula, Honduras»), la **marca de tiempo** y el **aspecto** del recuadro (o *Invisible*). La vista previa muestra cómo quedará.
5. Si es visible, dibuje en la página el recuadro donde aparecerá; el texto se ajusta solo al tamaño.
6. Elija dónde guardar el PDF firmado (equipo, OneDrive o Google Drive).

## Preferencias de firma

**Proteger → Preferencias de firma** (o *Configuración → Preferencias de firma…*) tiene tres pestañas, como en PDFelement:

- **Identificación digital**: sus certificados `.p12/.pfx` guardados, los del almacén de Windows (incluidos tokens USB) y, en el teléfono, el certificado instalado en Android. Muestra la información de cada uno y permite añadir, quitar y elegir el **predeterminado**.
- **Aspecto de la firma**: estilos del recuadro. Cada estilo define el gráfico (*sin gráfico*, *nombre* en letra grande o *gráfico importado*: su logo o su firma manuscrita guardada), los datos que se muestran (nombre, ubicación, nombre distinguido, logo de fondo, fecha, hora, razón y etiquetas) y la dirección del texto. Hay un *Estilo estándar* incluido; puede crear, duplicar, editar y elegir el predeterminado.
- **Servidores de marca de tiempo**: autoridades de sellado de tiempo (RFC 3161). Viene configurada la del SAR, `TSA_SAR` → `http://tsa.sar.gob.hn/CryptosecOpenKey/tsa_service`, como predeterminada. Puede añadir otras (con usuario y contraseña si el servidor lo pide) y **Probar** la conexión.

## Marca de tiempo

Con un servidor de marca de tiempo, la fecha de la firma la certifica esa autoridad (no el reloj del equipo) y la firma sigue siendo verificable después de que el certificado venza. Rúbrica envía a la TSA solo el resumen de la firma, recibe el sello firmado por la TSA y lo incrusta en la firma (atributo `signatureTimeStampToken`), como Adobe y PDFelement. El panel **Firmas** muestra la hora y la autoridad del sello.

- Funciona en la app de **Windows** y en la de **Android**. En el navegador los servidores de marca de tiempo no aceptan la conexión, así que allí se firma sin marca de tiempo.
- Si el servidor no responde, Rúbrica pregunta si desea firmar sin marca de tiempo.

## Con el almacén de Windows o un token USB (app de escritorio)

Si importó el certificado en Windows (doble clic en el `.p12` → Importar) o usa un token con su controlador instalado, aparecerá en **Firmar como** dentro del grupo *Almacén de Windows / token*. Windows pedirá el PIN si corresponde; la clave privada nunca sale de Windows.

## Con el certificado instalado en Android (app de Android)

Es la forma recomendada en el teléfono: el certificado se instala una sola vez en Android y la clave privada queda en el almacén del sistema.

1. Copie el `.pfx` al teléfono **por cable USB** (no lo envíe por WhatsApp ni por correo).
2. El teléfono debe tener bloqueo de pantalla (PIN, patrón o contraseña).
3. En Samsung: **Ajustes → Seguridad y privacidad → Más ajustes de seguridad → Instalar desde almacenamiento del dispositivo → Certificado de usuario de VPN y app**. Elija el `.pfx`, escriba su contraseña y póngale un nombre (por ejemplo «Firma SAR»). En otras marcas el menú es parecido (*Seguridad → Cifrado y credenciales → Instalar un certificado*).
4. Opcional: instale también los certificados raíz y subordinado del SAR (`CARoot.cer`, `CASub.cer`) como **Certificado de CA**.
5. Borre el `.pfx` de la carpeta Descargas del teléfono.
6. En Rúbrica: **Proteger → Firma digital → Firmar como → Elegir certificado de Android…**. Android preguntará una vez si Rúbrica puede usarlo; desde entonces la app lo recuerda.

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
- No se puede firmar un documento protegido con contraseña: quite la contraseña antes de firmar.
