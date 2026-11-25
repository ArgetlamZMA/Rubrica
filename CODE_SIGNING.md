# Política de firma de código (Code signing policy)

**Estado:** solicitud en trámite al programa de código abierto de SignPath Foundation. Hasta que se apruebe, los instaladores de Windows se publican **sin firma de código** (Windows puede mostrar «Windows protegió su PC»); su integridad se puede comprobar con `SHA256SUMS.txt` y su firma (ver [SECURITY.md](SECURITY.md)).

Una vez aprobada: *Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).*

## Qué se firma

- `Rubrica.exe` y los instaladores de Windows (`Rubrica-Setup-x.y.z.exe` y `Rubrica-Instalador-x.y.z-arm64.exe`).
- Solo binarios compilados por GitHub Actions (ejecutores alojados por GitHub) a partir del código público de este repositorio, en versiones etiquetadas `vX.Y.Z`. El flujo está en [`.github/workflows/build.yml`](.github/workflows/build.yml).
- No se firman binarios de terceros. Las bibliotecas de terceros incluidas se listan en [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- El APK de Android se firma con la clave propia del proyecto, no con SignPath.

## Funciones del equipo

| Función | Miembro |
| --- | --- |
| Autor (commits sin revisión adicional) | [Christian Díaz (@ArgetlamZMA)](https://github.com/ArgetlamZMA) |
| Revisor (cambios de colaboradores externos, *pull requests*) | [Christian Díaz (@ArgetlamZMA)](https://github.com/ArgetlamZMA) |
| Aprobador (cada solicitud de firma) | [Christian Díaz (@ArgetlamZMA)](https://github.com/ArgetlamZMA) |

Todos los miembros usan autenticación de dos factores en GitHub y en SignPath. Cada versión firmada requiere aprobación manual.

## Privacidad

Ver [PRIVACY.md](PRIVACY.md). Rúbrica no envía información a otros sistemas en red salvo los que el usuario elige (OneDrive, Google Drive, servidores de marca de tiempo) y la búsqueda de actualizaciones en GitHub, que se puede desactivar.
