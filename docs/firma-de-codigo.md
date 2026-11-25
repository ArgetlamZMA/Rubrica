# Firma de código con SignPath Foundation

Objetivo: que Windows deje de mostrar «Windows protegió su PC» al instalar Rúbrica. SignPath Foundation da gratis un certificado de firma de código a proyectos de código abierto; el certificado está a nombre de **SignPath Foundation** y la firma se hace en sus servidores, sin que usted maneje la clave privada.

El flujo de GitHub Actions ya está preparado: en cuanto existan el secreto y las variables del paso 4, las versiones etiquetadas `v*` se firman solas (con su aprobación manual en SignPath).

## Lo que ya cumple el repositorio

| Requisito de SignPath Foundation | Dónde está |
| --- | --- |
| Licencia de código abierto aprobada por la OSI | MIT ([LICENSE](../LICENSE)) — ver la *nota sobre la marca* abajo |
| Código público, compilado por GitHub Actions en ejecutores de GitHub | [`.github/workflows/build.yml`](../.github/workflows/build.yml) |
| Ya publicado en la forma que se firmará | Versiones 1.0.0 a 1.2.0 en Releases |
| «Code signing policy» en la página del proyecto, con funciones del equipo | [CODE_SIGNING.md](../CODE_SIGNING.md), enlazada en el README |
| Política de privacidad, mostrada al instalar, con opción para desactivar conexiones | [PRIVACY.md](../PRIVACY.md), página del instalador, *Configuración → Buscar actualizaciones al iniciar* |
| Nombre y versión de producto iguales en cada compilación | `Product` = Rúbrica; versión sin hash de commit |
| Desinstalación | Instalador de Inno Setup con desinstalador |

**Nota sobre la marca:** las condiciones piden que todos los componentes tengan licencia de código abierto. Hoy el logo y el nombre de ZMA Inversiones están excluidos de la licencia MIT. Antes de enviar la solicitud, decida una de estas opciones: (a) publicar los archivos de `branding/` con una licencia abierta (por ejemplo CC BY 4.0) y conservar la protección de la marca como *marca registrada* aparte, como hacen muchos proyectos; o (b) mencionarlo en la solicitud y preguntar si es aceptable.

## 1. Preparar su cuenta (10 minutos)

1. Active la **verificación en dos pasos** en GitHub (*Settings → Password and authentication*). SignPath la exige a todo el equipo.
2. Revise que el repositorio `ArgetlamZMA/Rubrica` sea público y que la última versión tenga instalador.

## 2. Enviar la solicitud

1. Abra <https://signpath.org/apply.html> y complete el formulario.
2. Datos sugeridos:
   - **Proyecto:** Rúbrica — editor PDF de código abierto para Windows y Android (editar, comentar, OCR, formularios, firma digital con certificados X.509 y marca de tiempo).
   - **Repositorio:** <https://github.com/ArgetlamZMA/Rubrica>
   - **Licencia:** MIT.
   - **Página de descarga:** <https://github.com/ArgetlamZMA/Rubrica/releases>
   - **Code signing policy:** <https://github.com/ArgetlamZMA/Rubrica/blob/main/CODE_SIGNING.md>
   - **Privacidad:** <https://github.com/ArgetlamZMA/Rubrica/blob/main/PRIVACY.md>
   - **Qué se firma:** `Rubrica.exe` y los instaladores `Rubrica-Setup-x.y.z.exe` / `Rubrica-Instalador-x.y.z-arm64.exe`, compilados por GitHub Actions.
3. Espere la respuesta por correo. Pueden pedir cambios; tráigalos aquí y los hacemos.

## 3. Configurar SignPath (después de la aprobación)

En <https://app.signpath.io>, en la organización que le asignen:

1. **Proyecto:** cree o confirme el proyecto con *slug* `rubrica`, vinculado al repositorio de GitHub (*Trusted Build System: GitHub.com*).
2. **Configuraciones de artefacto:** cree dos, copiando el contenido de estos archivos:
   - *slug* `rubrica-exe` ← [`.signpath/artifact-configurations/rubrica-exe.xml`](../.signpath/artifact-configurations/rubrica-exe.xml)
   - *slug* `rubrica-setup` ← [`.signpath/artifact-configurations/rubrica-setup.xml`](../.signpath/artifact-configurations/rubrica-setup.xml)
3. **Política de firma:** la de versiones (normalmente *slug* `release-signing`), con usted como **aprobador**.
4. **Usuario de CI:** cree un usuario de tipo *CI user* con permiso de *submitter* en esa política y copie su **API token**.
5. Anote el **ID de la organización** (aparece en la URL: `app.signpath.io/Web/<ID de organización>/...`).

## 4. Conectar GitHub

En el repositorio, *Settings → Secrets and variables → Actions*:

| Tipo | Nombre | Valor |
| --- | --- | --- |
| Secreto | `SIGNPATH_API_TOKEN` | El API token del usuario de CI |
| Variable | `SIGNPATH_ORGANIZATION_ID` | El ID de la organización |
| Variable | `SIGNPATH_PROJECT_SLUG` | `rubrica` |
| Variable | `SIGNPATH_POLICY_SLUG` | `release-signing` (o el que le asignen) |

## 5. Publicar una versión firmada

1. Cree la versión en *Releases* (etiqueta `vX.Y.Z`) como hasta ahora.
2. El flujo compila, sube `Rubrica.exe` a SignPath y **espera su aprobación** (hasta 60 minutos). SignPath le avisa por correo: apruebe la solicitud en su panel.
3. Luego firma el instalador (segunda aprobación), genera `SHA256SUMS.txt` firmado y publica todo en la versión.
4. Compruebe en Windows: clic derecho en el instalador → *Propiedades → Firmas digitales* → «SignPath Foundation».

Mientras no estén el secreto y las variables, el flujo sigue publicando instaladores sin firma de código, como ahora.
