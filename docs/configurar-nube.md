# Conectar OneDrive y Google Drive

PDF Studio se conecta directamente a su nube mediante OAuth 2.0; no hay servidores intermedios. Hay que registrar la aplicación **una sola vez** (gratis) y pegar el *ID de cliente* en **⚙ Configuración**. La app usa la dirección `http://localhost:8765/`.

## OneDrive (Microsoft)

1. Entre a <https://entra.microsoft.com> → *Aplicaciones* → *Registros de aplicaciones* → **Nuevo registro**.
2. Nombre: `PDF Studio`. Tipo de cuenta: *Cuentas en cualquier directorio organizativo y cuentas personales de Microsoft*.
3. URI de redirección: plataforma **Aplicación de página única (SPA)** → `http://localhost:8765/`.
4. Copie el **Id. de aplicación (cliente)**.
5. En *Permisos de API* agregue de Microsoft Graph (delegados): `Files.ReadWrite.All`, `User.Read`, `offline_access`. Si su organización lo exige, conceda el consentimiento de administrador.

## Google Drive

1. Entre a <https://console.cloud.google.com> y cree un proyecto.
2. *APIs y servicios* → *Biblioteca* → habilite **Google Drive API**.
3. *Pantalla de consentimiento OAuth*: tipo **Externo**; agregue sus cuentas como *usuarios de prueba*.
4. *Credenciales* → **ID de cliente de OAuth** → tipo **Aplicación web**. Origen autorizado `http://localhost:8765`, URI de redireccionamiento `http://localhost:8765/`.
5. Copie el **ID de cliente**. Al iniciar sesión Google mostrará «app no verificada»: elija *Continuar* (es su propia app).

Si publica un *fork*, cada organización puede registrar su propia aplicación; los ID de cliente no son secretos.
