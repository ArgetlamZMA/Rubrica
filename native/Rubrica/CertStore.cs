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
                keyUsage = KeyUsage(c),
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

    /// <summary>Usos de la clave (p. ej. DigitalSignature, NonRepudiation); vacío si el certificado no los restringe.</summary>
    internal static string[] KeyUsage(X509Certificate2 c)
    {
        var ku = c.Extensions.OfType<X509KeyUsageExtension>().FirstOrDefault();
        if (ku == null) return Array.Empty<string>();
        return Enum.GetValues<X509KeyUsageFlags>()
            .Where(f => f != X509KeyUsageFlags.None && ku.KeyUsages.HasFlag(f))
            .Select(f => f.ToString()).ToArray();
    }

    internal static string SubjectSerial(string subject)
    {
        var m = Regex.Match(subject, @"(?:SERIALNUMBER|OID\.2\.5\.4\.5)=([^,]+)", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups[1].Value.Trim() : "";
    }

    /// <summary>
    /// Valida la cadena del firmante contra el almacén de confianza de Windows (sin consultar revocación).
    /// certs: certificados en Base64 (DER) incluidos en la firma; leafSerial: número de serie del firmante (hex).
    /// </summary>
    internal static object VerifyChain(string[] certs, string? leafSerial, DateTime? when)
    {
        var all = certs.Select(b => { try { return new X509Certificate2(Convert.FromBase64String(b)); } catch { return null; } })
                       .Where(c => c != null).Cast<X509Certificate2>().ToList();
        if (all.Count == 0) return new { trusted = false, status = new[] { "La firma no incluye certificados." } };
        static string Norm(string s) => s.TrimStart('0').ToUpperInvariant();
        var leaf = string.IsNullOrEmpty(leafSerial) ? null : all.FirstOrDefault(c => Norm(c.SerialNumber) == Norm(leafSerial!));
        leaf ??= all.FirstOrDefault(c => !all.Any(o => o != c && o.Issuer == c.Subject)) ?? all[0];
        using var chain = new X509Chain();
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chain.ChainPolicy.VerificationFlags = X509VerificationFlags.IgnoreWrongUsage;
        if (when.HasValue) chain.ChainPolicy.VerificationTime = when.Value.ToLocalTime();
        foreach (var c in all) if (c != leaf) chain.ChainPolicy.ExtraStore.Add(c);
        var ok = chain.Build(leaf);
        var names = chain.ChainElements.Select(e => e.Certificate.GetNameInfo(X509NameType.SimpleName, false)).ToArray();
        return new
        {
            trusted = ok,
            root = names.LastOrDefault() ?? "",
            chain = names,
            status = chain.ChainStatus.Select(s => s.StatusInformation.Trim()).Where(s => s.Length > 0).Distinct().ToArray(),
        };
    }
}
