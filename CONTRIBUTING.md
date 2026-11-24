# Cómo contribuir

1. Cree un *fork* y una rama: `git checkout -b mejora/mi-cambio`.
2. La interfaz está en `web/src` (HTML, CSS y JavaScript sin *frameworks*, un archivo por módulo en `web/src/js`). La aplicación de Windows está en `native/Rubrica` (C# / .NET 8 / WebView2).
3. Compile y pruebe:
   ```powershell
   cd web; npm ci; npm run build; python tests/run_all.py
   dotnet test native/Rubrica.Tests
   ```
4. Agregue una prueba en `web/tests` o `native/Rubrica.Tests` para cada error corregido o función nueva.
5. Abra un *pull request* describiendo el cambio. GitHub Actions compila y ejecuta las pruebas automáticamente.

## Convenciones

- Textos de la interfaz en español.
- Nada de servidores intermedios: los documentos van directo entre el equipo y la nube del usuario.
- Cualquier dato sensible (contraseñas, certificados) nunca se guarda en texto plano ni se envía a terceros.

## Publicar una versión

Actualice `version` en `web/package.json` y `CHANGELOG.md`, y cree la etiqueta: `git tag v1.1.0 && git push --tags`. GitHub Actions publica el instalador y las instalaciones existentes lo detectan al iniciar.

## Traducciones

Los textos de la interfaz están en español en el código. Sus traducciones viven en [`web/src/i18n/ui.tsv`](web/src/i18n/ui.tsv): una fila por texto, columnas `es`, `en`, `pt` separadas por tabulador. Para un texto nuevo o una corrección basta con editar esa fila. Los textos con valores variables usan `{0}`, `{1}`… en las tres columnas. Para otro idioma, agregue una columna (por ejemplo `fr`) y su nombre en `LANGS` de `web/src/js/00_i18n.js`.
