using System.Security.Cryptography;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using Xunit;

namespace Rubrica.Tests;

public class UpdaterTests
{
    [Theory]
    [InlineData("v1.2.0", "1.1.9", true)]
    [InlineData("v1.0.0", "1.0.0", false)]
    [InlineData("1.10.0", "1.9.3", true)]
    [InlineData("v2", "1.9", true)]
    [InlineData("v1.0.1-beta", "1.0.0", true)]
    [InlineData("basura", "1.0.0", false)]
    public void ComparaVersiones(string candidata, string actual, bool esperado) =>
        Assert.Equal(esperado, Updater.IsNewer(candidata, actual));
}

public class CertStoreTests
{
    [Fact]
    public void FirmaCmsDesacopladaVerificable()
    {
        using var rsa = RSA.Create(2048);
        var req = new CertificateRequest("CN=Prueba Rúbrica, SERIALNUMBER=0501", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var cert = req.CreateSelfSigned(DateTimeOffset.Now.AddDays(-1), DateTimeOffset.Now.AddDays(30));
        var data = System.Text.Encoding.UTF8.GetBytes("contenido del PDF fuera de /Contents");

        var der = CertStore.SignWith(cert, data);

        var cms = new SignedCms(new ContentInfo(data), detached: true);
        cms.Decode(der);
        cms.CheckSignature(verifySignatureOnly: true);
        Assert.Equal("2.16.840.1.101.3.4.2.1", cms.SignerInfos[0].DigestAlgorithm.Value);
        Assert.Contains(cms.SignerInfos[0].SignedAttributes.Cast<CryptographicAttributeObject>(), a => a.Oid.Value == "1.2.840.113549.1.9.5");
    }

    [Fact]
    public void ExtraeNumeroDeSerieDelSujeto()
    {
        Assert.Equal("05011989049857", CertStore.SubjectSerial("CN=CHRISTIAN DIAZ, SERIALNUMBER=05011989049857, O=ZMA, C=HN"));
        Assert.Equal("", CertStore.SubjectSerial("CN=Sin serie"));
    }
}

public class FontNamesTests
{
    [Fact]
    public void LeeNombreDeFuenteDelSistema()
    {
        var arial = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), "arial.ttf");
        if (!File.Exists(arial)) return; // entorno sin fuentes de Windows
        var n = FontNames.Read(arial);
        Assert.NotNull(n);
        Assert.Equal("Arial", n!.Value.Family);
    }

    [Fact]
    public void IgnoraArchivosQueNoSonFuentes()
    {
        var tmp = Path.GetTempFileName();
        File.WriteAllText(tmp, "esto no es una fuente TrueType");
        try { Assert.Null(FontNames.Read(tmp)); }
        finally { File.Delete(tmp); }
    }
}

public class TsaTests
{
    [Theory]
    [InlineData("ftp://tsa.sar.gob.hn/tsa")]
    [InlineData("file:///C:/Windows/win.ini")]
    [InlineData("no es una url")]
    public async Task RechazaDireccionesNoHttp(string url) =>
        await Assert.ThrowsAsync<ArgumentException>(() => Tsa.RequestAsync(url, new byte[] { 0x30, 0x00 }, null));

    [Fact]
    public async Task RechazaSolicitudesQueNoSonDer() =>
        await Assert.ThrowsAsync<ArgumentException>(() => Tsa.RequestAsync("http://tsa.sar.gob.hn/CryptosecOpenKey/tsa_service", new byte[] { 0x01, 0x02 }, null));
}

public class UpdaterVerificationTests
{
    private static (string pub, Func<byte[], byte[]> sign) NewKey()
    {
        var ec = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return (ec.ExportSubjectPublicKeyInfoPem(), d => ec.SignData(d, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence));
    }

    private static string TempFile(byte[] content) { var f = Path.GetTempFileName(); File.WriteAllBytes(f, content); return f; }

    [Fact]
    public void LaClavePublicaDeLaAppEsValida()
    {
        using var ec = ECDsa.Create();
        ec.ImportFromPem(AppInfo.UpdatePublicKey);
        Assert.Equal(256, ec.KeySize);
    }

    [Fact]
    public void AceptaInstaladorFirmadoYConHashCorrecto()
    {
        var (pub, sign) = NewKey();
        var setup = System.Text.Encoding.UTF8.GetBytes("instalador de prueba");
        var hash = Convert.ToHexString(SHA256.HashData(setup)).ToLowerInvariant();
        var manifest = System.Text.Encoding.UTF8.GetBytes($"{hash}  Rubrica-Setup-1.3.0.exe\n0000000000000000000000000000000000000000000000000000000000000000  Rubrica-Web-1.3.0.zip\n");
        var f = TempFile(setup);
        try { Updater.VerifyFile(f, "Rubrica-Setup-1.3.0.exe", manifest, sign(manifest), pub); }
        finally { File.Delete(f); }
    }

    [Fact]
    public void RechazaInstaladorAlterado()
    {
        var (pub, sign) = NewKey();
        var hash = Convert.ToHexString(SHA256.HashData(new byte[] { 1, 2, 3 })).ToLowerInvariant();
        var manifest = System.Text.Encoding.UTF8.GetBytes($"{hash}  Rubrica-Setup-1.3.0.exe\n");
        var f = TempFile(new byte[] { 1, 2, 3, 4 });
        try { Assert.Throws<UpdateVerificationException>(() => Updater.VerifyFile(f, "Rubrica-Setup-1.3.0.exe", manifest, sign(manifest), pub)); }
        finally { File.Delete(f); }
    }

    [Fact]
    public void RechazaManifiestoFirmadoConOtraClave()
    {
        var (pub, _) = NewKey();
        var (_, otherSign) = NewKey();
        var data = new byte[] { 9, 9, 9 };
        var hash = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
        var manifest = System.Text.Encoding.UTF8.GetBytes($"{hash} *Rubrica-Setup-1.3.0.exe\n");
        var f = TempFile(data);
        try { Assert.Throws<UpdateVerificationException>(() => Updater.VerifyFile(f, "Rubrica-Setup-1.3.0.exe", manifest, otherSign(manifest), pub)); }
        finally { File.Delete(f); }
    }

    [Fact]
    public void RechazaManifiestoModificadoDespuesDeFirmar()
    {
        var (pub, sign) = NewKey();
        var manifest = System.Text.Encoding.UTF8.GetBytes(new string('a', 64) + "  Rubrica-Setup-1.3.0.exe\n");
        var sig = sign(manifest);
        manifest[0] = (byte)'b';
        Assert.False(Updater.VerifyManifest(manifest, sig, pub));
    }

    [Fact]
    public void LeeManifiestoConAsteriscoYRetornoDeCarro()
    {
        var m = Updater.ParseSums(System.Text.Encoding.UTF8.GetBytes(new string('A', 64) + " *Rubrica-Setup-1.3.0.exe\r\nbasura\n"));
        Assert.Equal(new string('a', 64), m["Rubrica-Setup-1.3.0.exe"]);
        Assert.Single(m);
    }
}

public class VerifyChainTests
{
    [Fact]
    public void CadenaConRaizDesconocidaNoEsDeConfianza()
    {
        using var rootKey = RSA.Create(2048);
        var rootReq = new CertificateRequest("CN=RAIZ DE PRUEBA, C=HN", rootKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        rootReq.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        using var root = rootReq.CreateSelfSigned(DateTimeOffset.Now.AddDays(-1), DateTimeOffset.Now.AddYears(5));
        using var leafKey = RSA.Create(2048);
        var leafReq = new CertificateRequest("CN=FIRMANTE DE PRUEBA, C=HN", leafKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var leaf = leafReq.Create(root, DateTimeOffset.Now.AddDays(-1), DateTimeOffset.Now.AddYears(1), new byte[] { 1, 2, 3, 4 });
        var r = CertStore.VerifyChain(new[] { Convert.ToBase64String(root.RawData), Convert.ToBase64String(leaf.RawData) }, "01020304", DateTime.UtcNow);
        var json = System.Text.Json.JsonSerializer.Serialize(r);
        Assert.Contains("\"trusted\":false", json);
        Assert.Contains("FIRMANTE DE PRUEBA", json); // elige el firmante por número de serie, no el primero de la lista
    }

    [Fact]
    public void SinCertificadosNoEsDeConfianza()
    {
        var json = System.Text.Json.JsonSerializer.Serialize(CertStore.VerifyChain(new[] { "no es base64 !!" }, null, null));
        Assert.Contains("\"trusted\":false", json);
    }
}

public class UpdaterArchTests
{
    [Theory]
    [InlineData("Rubrica-Setup-1.3.0-arm64.exe", "Rubrica-Setup-1.3.0.exe", true, true)]
    [InlineData("Rubrica-Setup-1.3.0-arm64.exe", "Rubrica-Setup-1.3.0.exe", false, false)]
    [InlineData("Rubrica-Setup-1.3.0.exe", "Rubrica-Setup-1.3.0-arm64.exe", false, true)]
    [InlineData("Rubrica-Setup-1.3.0.exe", "Rubrica-Setup-1.3.0-arm64.exe", true, false)]
    public void EligeElInstaladorDeLaArquitectura(string candidate, string current, bool arm64, bool better) =>
        Assert.Equal(better, Updater.IsBetterSetup(candidate, current, arm64));
}
