# Rúbrica para Android

Versión para teléfonos y plegables (probada para Galaxy Z Fold 7, Z Fold 8 Ultra y S24 Ultra). Usa el mismo editor que la versión de Windows, empaquetado con [Capacitor](https://capacitorjs.com).

## Instalar

1. En el teléfono, abra la versión más reciente en *Releases* del repositorio y descargue `Rubrica-Android-x.y.z.apk`.
2. Ábralo. Android pedirá permitir «Instalar apps desconocidas» para el navegador o el administrador de archivos: actívelo solo para esa app.
3. Las actualizaciones se instalan igual, encima de la versión anterior (están firmadas con la misma clave).

## Qué incluye

- **Escanear documento**: escáner de Google (ML Kit) con detección de bordes, corrección de perspectiva, filtros y varias páginas; crea el PDF en tamaño Carta (configurable) y le agrega texto reconocido (OCR) para buscar y copiar. Funciona sin conexión.
- **Abrir / Guardar**: selector de archivos de Android, que incluye el teléfono, Google Drive y OneDrive (si su app está instalada). «Guardar» escribe sobre el mismo archivo.
- **«Abrir con» y «Compartir»**: Rúbrica aparece al abrir un PDF o al compartir PDF e imágenes desde otras apps.
- **Compartir e imprimir** el PDF resultante.
- Todo el editor: anotaciones, edición de texto, páginas, formularios, firma digital con `.p12`, contraseñas, conversión.
- Interfaz táctil: pellizcar para zoom, panel de propiedades como hoja inferior, botón *Atrás* de Android, diseño amplio al desplegar el Fold.

## Fuentes

Android no incluye Aptos. Para usarla, copie el archivo `.ttf` de Aptos al teléfono y en ⚙ Configuración pulse «Agregar fuente…». Sin ella se usa Helvetica.

## Firma de la app (clave de compilación)

GitHub Actions firma el APK con la clave guardada en los secretos del repositorio:

| Secreto | Contenido |
|---|---|
| `ANDROID_KEYSTORE_B64` | el archivo `.jks` en Base64 |
| `ANDROID_KEYSTORE_PASSWORD` | su contraseña (alias interno `pdfstudio`) |

Sin esos secretos se genera un APK «-prueba» con una clave temporal (útil para probar, pero cada compilación exige desinstalar la anterior). **Guarde una copia de la clave**: sin ella no se pueden instalar actualizaciones encima de la app existente.

## Compilar localmente

```bash
cd web && npm ci && npm run build
cd ../mobile && npm ci && npx cap sync android
cd android && ./gradlew assembleDebug      # requiere Android SDK y JDK 21
```
