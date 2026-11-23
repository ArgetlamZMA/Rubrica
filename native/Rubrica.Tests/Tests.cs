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
