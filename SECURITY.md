# Seguridad

Reporte vulnerabilidades de forma privada desde la pestaña **Security → Report a vulnerability** del repositorio (no abra un *issue* público).

## Diseño

- La aplicación de Windows sirve la interfaz en `http://localhost` (solo este equipo). La API local `/__native/*` exige un token aleatorio por sesión que solo recibe la página de la aplicación, y valida el encabezado `Host` contra ataques de *DNS rebinding*.
- Solo se escriben archivos elegidos por el usuario en un diálogo de Windows o abiertos por él.
- Las claves privadas del almacén de Windows nunca salen de Windows. Los archivos `.p12` se procesan en memoria y su contraseña no se guarda.
- Las sesiones de OneDrive/Google Drive usan OAuth 2.0 (PKCE en Microsoft) directamente con Microsoft/Google.
- Las actualizaciones solo se descargan desde las versiones publicadas de este repositorio en GitHub.
