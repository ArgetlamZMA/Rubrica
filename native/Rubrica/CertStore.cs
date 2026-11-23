using System.Security.Cryptography;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using System.Text.RegularExpressions;

namespace Rubrica;

/// <summary>
/// Certificados del almacén personal de Windows (incluye tokens USB y tarjetas inteligentes con su
/// controlador instalado). La clave privada nunca sale de Windows: aquí solo se calcula la firma CMS.
/// </summary>
internal static class CertStore
{
    public static object[] List()
    {
        using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);
        store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
        return store.Certificates
            .Where(c => c.HasPrivateKey && c.NotAfter > DateTime.Now.AddYears(-1))
            .OrderByDescending(c => c.NotAfter)
            .Select(c => (object)new
            {
                thumbprint = c.Thumbprint,
                name = c.GetNameInfo(X509NameType.SimpleName, false),
                issuer = c.GetNameInfo(X509NameType.SimpleName, true),
                subject = c.Subject,
                serialNumber = SubjectSerial(c.Subject),
                notBefore = c.NotBefore.ToUniversalTime().ToString("o"),
                notAfter = c.NotAfter.ToUniversalTime().ToString("o"),
            })
            .ToArray();
    }

    public static byte[] Sign(byte[] data, string thumbprint)
    {
        using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);
        store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
        var found = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, false);
        if (found.Count == 0) throw new CryptographicException("No se encontró el certificado seleccionado.");
        return SignWith(found[0], data);
    }

    /// <summary>Firma CMS desacoplada con SHA-256 (compatible con adbe.pkcs7.detached).</summary>
    public static byte[] SignWith(X509Certificate2 cert, byte[] data)
    {
        var cms = new SignedCms(new ContentInfo(data), detached: true);
        var signer = new CmsSigner(SubjectIdentifierType.IssuerAndSerialNumber, cert)
        {
            DigestAlgorithm = new Oid("2.16.840.1.101.3.4.2.1"),
            IncludeOption = X509IncludeOption.WholeChain,
        };
        signer.SignedAttributes.Add(new Pkcs9SigningTime(DateTime.UtcNow));
        cms.ComputeSignature(signer, silent: false);
        return cms.Encode();
    }

    internal static string SubjectSerial(string subject)
    {
        var m = Regex.Match(subject, @"(?:SERIALNUMBER|OID\.2\.5\.4\.5)=([^,]+)", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups[1].Value.Trim() : "";
    }
}
