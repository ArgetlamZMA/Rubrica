# Firma digital

Rúbrica firma documentos con un certificado digital (por ejemplo, el de firma electrónica emitido por el **SAR de Honduras**).

## Firmar

1. Abra el PDF y vaya a **Proteger → Firma digital**.
2. En **Firmar como** elija su certificado. La primera vez elija **Añadir archivo .p12 / .pfx…**, escriba la contraseña y Rúbrica lo guarda en su lista de identificaciones digitales (sin la contraseña). Verá el titular, el número de identidad o RTN, el emisor, la vigencia y el uso previsto.
3. Escriba la contraseña del certificado (se pide en cada firma; **nunca** se guarda).
4. Elija el motivo, la ubicación (por defecto «San Pedro Sula, Honduras»), la **marca de tiempo** y el **aspecto** del recuadro (o *Invisible*). La vista previa muestra cómo quedará.
5. Si es visible, dibuje en la página el recuadro donde aparecerá; el texto se ajusta solo al tamaño.
6. Elija dónde guardar el PDF firmado (equipo, OneDrive o Google Drive).

## Pedir firmas a otras personas

1. Abra el documento y elija **Formulario → Campo de firma** (o **Proteger → Pedir firma**).
2. Dibuje el recuadro donde debe firmar cada persona e indique su nombre (como aparece en su certificado) y el orden.
3. **Proteger → Enviar para firmar**: guarde el PDF y envíelo con el mensaje propuesto (correo, WhatsApp o compartir en Android).
4. Quien lo recibe lo abre en Rúbrica: el panel **Firmas** muestra las firmas pendientes y quién sigue. Con **Firmar aquí** firma dentro de su campo, y el siguiente recibe el archivo ya firmado.

Rúbrica avisa si alguien firma antes de su turno o si el certificado no parece de la persona indicada. Los campos son estándar: también se pueden firmar con Adobe Acrobat Reader.

## Preferencias de firma

**Proteger → Preferencias de firma** (o *Configuración → Preferencias de firma…*) tiene tres pestañas, como en PDFelement:

- **Identificación digital**: sus certificados `.p12/.pfx` guardados, los del almacén de Windows (incluidos tokens USB) y, en el teléfono, el certificado instalado en Android. Muestra la información de cada uno y permite añadir, quitar y elegir el **predeterminado**.
- **Aspecto de la firma**: estilos del recuadro. Cada estilo define el gráfico (*sin gráfico*, *nombre* en letra grande o *gráfico importado*: su logo o su firma manuscrita guardada), los datos que se muestran (nombre, ubicación, nombre distinguido, logo de fondo, fecha, hora, razón y etiquetas) y la dirección del texto. Hay un *Estilo estándar* incluido; puede crear, duplicar, editar y elegir el predeterminado.
- **Servidores de marca de tiempo**: autoridades de sellado de tiempo (RFC 3161). Viene configurada la del SAR, `TSA_SAR` → `http://tsa.sar.gob.hn/CryptosecOpenKey/tsa_service`, como predeterminada. Puede añadir otras (con usuario y contraseña si el servidor lo pide) y **Probar** la conexión.

## Verificar firmas: íntegra y de confianza

El panel **Firmas** revisa dos cosas por separado:

- **Integridad**: que el documento no haya cambiado desde que se firmó.
- **Confianza**: que el certificado del firmante encadene hasta una autoridad en la que usted confía (por ejemplo, la raíz del SAR). Se verifica la firma de cada certificado de la cadena y su vigencia en la fecha de la firma (o de la marca de tiempo).

| Estado | Significado |
| --- | --- |
| Firma válida · emisor de confianza | Íntegra y emitida por una autoridad de su lista de confianza, del almacén de Windows o de las CA instaladas en Android. |
| Firma íntegra · emisor no verificado | El documento no cambió, pero no se puede confirmar quién emitió el certificado (raíz desconocida, autofirmado o falta un certificado intermedio). |
| Firma NO válida | El contenido firmado fue alterado. |

Para que las firmas del SAR aparezcan **de confianza**:

1. Descargue en [sar.gob.hn/firmaelectronica](https://www.sar.gob.hn/firmaelectronica/) la *Autoridad de Certificación Raíz* y la *Subordinada*.
2. En Rúbrica: **Proteger → Preferencias de firma → Certificados de confianza → Importar certificado** y elija ambos archivos. Compare la huella SHA-256 que muestra Rúbrica con la publicada por el SAR.
3. En Windows también vale instalarlos en el almacén del sistema (doble clic → Instalar certificado → *Entidades de certificación raíz de confianza*), como indica el SAR; Rúbrica lo consulta.

También puede pulsar **Confiar en este emisor…** en una firma del panel: Rúbrica muestra la huella para que la compare antes de confiar. La revocación (OCSP/CRL) aún no se consulta.

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

- Formato **PAdES** (`ETSI.CAdES.detached`, ETSI EN 319 142) con **SHA-256** y el atributo *signing-certificate-v2*, que liga la firma al certificado exacto del firmante. Es el formato de firma electrónica avanzada que validan Adobe Acrobat/Reader y las plataformas europeas y latinoamericanas.
- Con **marca de tiempo**, la firma es PAdES-B-T: la fecha la certifica la TSA y no el reloj del equipo.
- Con **validación a largo plazo (LTV)**, activada por omisión cuando hay marca de tiempo, es PAdES-B-LT. Rúbrica descarga las respuestas **OCSP** (o, si no hay, las listas **CRL**) de todos los certificados de la cadena, del firmante y de la TSA, y las guarda en el diccionario **DSS** del PDF. Si a la cadena le falta una autoridad intermedia, la obtiene de la dirección *caIssuers* del certificado. Así la firma se puede comprobar dentro de muchos años, aunque los certificados hayan vencido o los servidores de la autoridad ya no existan.
- Si un certificado de la cadena está **revocado**, Rúbrica detiene la firma y no la entrega.
- Si no hay conexión para obtener OCSP/CRL, el documento queda firmado igualmente (PAdES-B-T) y Rúbrica avisa que no incluye LTV.
- En la versión web, el navegador no deja consultar los servidores OCSP/CRL (CORS): para LTV use la app de Windows o de Android.
- Se agrega como **actualización incremental**: un documento puede tener varias firmas y agregar comentarios después no rompe las anteriores. La información LTV se agrega en otra actualización incremental que no cuenta como cambio del contenido.
- En una copia **PDF/A**, la apariencia visible de la firma se dibuja sin fuentes sin incrustar, para que el documento siga cumpliendo PDF/A.

## Verificar firmas

El panel **Firmas** (barra lateral) revisa cada firma del documento:

- **Firma íntegra**: el contenido firmado no cambió.
- **Firma íntegra (con cambios posteriores permitidos)**: hay revisiones posteriores (otra firma o comentarios).
- **Firma NO válida**: el contenido firmado fue alterado.

La **confianza** en la autoridad emisora (que el certificado realmente fue emitido por el SAR) se confirma en Adobe Acrobat/Reader agregando el certificado raíz de la autoridad a sus certificados de confianza. Rúbrica no incluye una lista de autoridades raíz.

## Limitaciones actuales

- Certificados con clave ECDSA: use el almacén de Windows o el certificado instalado en Android (la lectura de archivos `.p12` admite RSA). En el almacén de Windows la clave nunca sale del almacén ni del token USB: Rúbrica solo pide que se firme el resumen.
- No se puede firmar un documento protegido con contraseña: quite la contraseña antes de firmar.
