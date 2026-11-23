# Arquitectura

```
┌──────────────────────── Rubrica.exe (C# · .NET 8 · WinForms) ────────────────────────┐
│  WebView2 (motor de Edge)            LocalServer (http://localhost:8765, solo este PC)  │
│  ┌──────────────────────────┐       ┌──────────────────────────────────────────────┐    │
│  │ web/dist/index.html      │ HTTP  │ /            → interfaz (archivos estáticos)  │    │
│  │ PDF.js · pdf-lib ·       │◄─────►│ /__native/*  → diálogos, lectura/escritura,   │    │
│  │ fontkit · forge · JSZip  │ token │               fuentes, certificados, firma,   │    │
│  └──────────────────────────┘       │               actualizaciones                 │    │
│                                      └──────────────────────────────────────────────┘    │
│  Instancia única (named pipe) · «Abrir con» .pdf · registro en %LOCALAPPDATA%\Rubrica  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
          │ OAuth 2.0 directo                         │ GitHub Releases (actualizaciones)
          ▼                                           ▼
   Microsoft Graph / Google Drive              api.github.com
```

- **web/** — toda la edición ocurre en JavaScript dentro de la ventana: PDF.js dibuja las páginas; pdf-lib construye el PDF final; las anotaciones se guardan como objetos en coordenadas de la página y se aplican al exportar. Se compila en un único `index.html` que también funciona en un navegador (versión web / PWA).
- **native/Rubrica** — host de Windows: ventana, servidor local, diálogos nativos de Abrir/Guardar, catálogo de fuentes (incluye las de Microsoft 365 como Aptos), firma con el almacén de certificados (`SignedCms`) y actualizaciones.
- **installer/** — Inno Setup: instalación por usuario, accesos directos, «Abrir con».
- **.github/workflows/build.yml** — compila, ejecuta pruebas (Playwright + xUnit), genera el instalador y publica versiones.

## Módulos de la interfaz (`web/src/js`)

| Archivo | Contenido |
|---|---|
| 01_util | utilidades, ventanas modales, formularios |
| 02_state | modelo de documento, geometría de página, apertura |
| 03_render | visor, capas, miniaturas, campos de formulario |
| 04_tools | herramientas, ratón, panel de propiedades, edición de texto |
| 05_export / 05b_textremove | construcción del PDF final; eliminación del texto original editado |
| 06_pages | organizar páginas, recortar, dividir |
| 07_features | guardar/abrir, marca de agua, encabezados, Bates, firma manuscrita, contraseñas, búsqueda, conversión, OCR, compresión |
| 08_cloud | OneDrive y Google Drive |
| 10_fonts | fuentes del sistema, Aptos, detección de fuente |
| 11_sign | firma digital y verificación |
| 12_native | puente con la app de Windows |
| 99_main | cinta de opciones, inicio, atajos, arranque |
