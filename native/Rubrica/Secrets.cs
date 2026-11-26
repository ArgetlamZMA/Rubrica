using System.Security.Cryptography;
using System.Text;

namespace Rubrica;

/// <summary>
/// Guarda contraseñas de la configuración (por ejemplo, la del servidor de marca de tiempo) cifradas con DPAPI,
/// ligadas a la cuenta de Windows del usuario: el valor guardado no sirve copiado a otra cuenta u otro equipo.
/// </summary>
public static class Secrets
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Rubrica.secret.v1");

    public static string Protect(string plain) =>
        Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(plain ?? ""), Entropy, DataProtectionScope.CurrentUser));

    public static string Unprotect(string sealedB64)
    {
        try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(sealedB64 ?? ""), Entropy, DataProtectionScope.CurrentUser)); }
        catch (Exception e) when (e is CryptographicException or FormatException)
        { throw new InvalidOperationException("La contraseña guardada no se puede leer en esta cuenta de Windows. Escríbala de nuevo en Preferencias de firma."); }
    }
}
