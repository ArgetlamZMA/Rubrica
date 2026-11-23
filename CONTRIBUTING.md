# Cómo contribuir

1. Cree un *fork* y una rama: `git checkout -b mejora/mi-cambio`.
2. La interfaz está en `web/src` (HTML, CSS y JavaScript sin *frameworks*, un archivo por módulo en `web/src/js`). La aplicación de Windows está en `native/PdfStudio` (C# / .NET 8 / WebView2).
3. Compile y pruebe:
   ```powershell
   cd web; npm ci; npm run build; python tests/run_all.py
   dotnet test native/PdfStudio.Tests
   ```
4. Agregue una prueba en `web/tests` o `native/PdfStudio.Tests` para cada error corregido o función nueva.
5. Abra un *pull request* describiendo el cambio. GitHub Actions compila y ejecuta las pruebas automáticamente.

## Convenciones

- Textos de la interfaz en español.
- Nada de servidores intermedios: los documentos van directo entre el equipo y la nube del usuario.
- Cualquier dato sensible (contraseñas, certificados) nunca se guarda en texto plano ni se envía a terceros.

## Publicar una versión

Actualice `version` en `web/package.json` y `CHANGELOG.md`, y cree la etiqueta: `git tag v1.1.0 && git push --tags`. GitHub Actions publica el instalador y las instalaciones existentes lo detectan al iniciar.
