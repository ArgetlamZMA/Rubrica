# Política de privacidad de Rúbrica

Rúbrica trabaja con sus documentos **en su propio equipo o teléfono**. No tiene cuentas, no recopila estadísticas de uso ni envía sus documentos a servidores de Rúbrica o de ZMA Inversiones.

## Conexiones que hace la aplicación

| Conexión | Cuándo | Qué se envía | Cómo desactivarla |
| --- | --- | --- | --- |
| GitHub (`api.github.com`, `github.com`) | Al iniciar la app de Windows, para buscar actualizaciones, y al instalar una | La versión de Rúbrica (encabezado *User-Agent*) y su dirección IP, como cualquier visita a un sitio web | *Configuración → Buscar actualizaciones al iniciar* |
| OneDrive (Microsoft) y Google Drive | Solo si usted conecta su cuenta y abre o guarda allí | Los documentos que usted elige abrir o guardar, con el inicio de sesión de Microsoft o Google | No conectar la cuenta, o *Desconectar* en Configuración |
| Servidor de marca de tiempo (p. ej. TSA del SAR) | Solo al firmar con marca de tiempo | Un resumen criptográfico (hash) de la firma, nunca el documento | Elegir *Sin marca de tiempo* o quitar el servidor predeterminado |

Nada más sale del equipo: el OCR, la conversión, la firma digital y la verificación de firmas se hacen localmente. Las contraseñas de los certificados no se guardan.

## Datos guardados en el equipo

Preferencias, documentos recientes, firmas manuscritas, la lista de identificaciones digitales (archivos `.p12/.pfx` sin su contraseña) y los certificados de confianza se guardan solo en este equipo (Windows: `%LOCALAPPDATA%\Rubrica` y el almacenamiento de la app; Android: el almacenamiento privado de la app). Se borran al desinstalar o desde *Configuración*.

## Contacto

Reporte dudas o problemas en <https://github.com/ArgetlamZMA/Rubrica/issues>.
