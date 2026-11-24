# Seguridad

Reporte vulnerabilidades de forma privada desde la pestaña **Security → Report a vulnerability** del repositorio (no abra un *issue* público).

## Diseño

- La aplicación de Windows sirve la interfaz en `http://localhost` (solo este equipo). La API local `/__native/*` exige un token aleatorio por sesión que solo recibe la página de la aplicación, y valida el encabezado `Host` contra ataques de *DNS rebinding*.
- Solo se escriben archivos elegidos por el usuario en un diálogo de Windows o abiertos por él.
- Las claves privadas del almacén de Windows nunca salen de Windows. Los archivos `.p12` se procesan en memoria y su contraseña no se guarda.
- Las sesiones de OneDrive/Google Drive usan OAuth 2.0 (PKCE en Microsoft) directamente con Microsoft/Google.
- Las actualizaciones solo se descargan desde las versiones publicadas de este repositorio en GitHub, y desde la 1.3 solo se ejecutan si el manifiesto `SHA256SUMS.txt` está firmado con la clave de actualizaciones de Rúbrica (ECDSA P-256; la clave pública está en `native/Rubrica/AppInfo.cs`, la privada solo en el secreto `UPDATE_SIGNING_KEY` de GitHub Actions) y el SHA-256 del instalador coincide.
- Para comprobar a mano una descarga: `Get-FileHash Rubrica-Setup-x.y.z.exe` y compare con `SHA256SUMS.txt`; la firma se verifica con `openssl dgst -sha256 -verify clave-publica.pem -signature SHA256SUMS.txt.sig SHA256SUMS.txt`.
