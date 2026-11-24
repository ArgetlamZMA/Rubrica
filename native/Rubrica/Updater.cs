using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Rubrica;

/// <summary>
/// Actualizaciones desde las versiones publicadas en GitHub (Releases).
/// Desde la 1.3 el instalador solo se ejecuta si:
///   1) el manifiesto SHA256SUMS.txt de la versión está firmado con la clave de Rúbrica
///      (ECDSA P-256, firma en SHA256SUMS.txt.sig; clave pública en <see cref="AppInfo.UpdatePublicKey"/>), y
///   2) el SHA-256 del instalador descargado coincide con el del manifiesto.
/// Si algo no cuadra, no se ejecuta nada y se ofrece abrir la página de descarga.
/// </summary>
internal static class Updater
{
    public const string SumsName = "SHA256SUMS.txt", SigName = "SHA256SUMS.txt.sig";
    private static readonly HttpClient Http = CreateClient();
    private static Release? _last;

    private sealed record Release(string Tag, string Page, string? SetupName, string? SetupUrl, string? SumsUrl, string? SigUrl);

    private static HttpClient CreateClient()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        h.DefaultRequestHeaders.UserAgent.ParseAdd("Rubrica/" + AppInfo.Version);
        h.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return h;
    }

    public static async Task<object> CheckAsync()
    {
        using var r = await Http.GetAsync($"https://api.github.com/repos/{AppInfo.GitHubRepo}/releases/latest");
        if (!r.IsSuccessStatusCode) return new { available = false, status = (int)r.StatusCode };
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        var tag = root.TryGetProperty("tag_name", out var t) ? t.GetString() ?? "" : "";
        var notes = root.TryGetProperty("body", out var b) ? b.GetString() ?? "" : "";
        var page = root.TryGetProperty("html_url", out var h) ? h.GetString() ?? "" : $"https://github.com/{AppInfo.GitHubRepo}/releases/latest";
        string? setupName = null, setupUrl = null, sums = null, sig = null;
        if (root.TryGetProperty("assets", out var assets))
        {
            foreach (var a in assets.EnumerateArray())
            {
                var n = a.GetProperty("name").GetString() ?? "";
                var u = a.GetProperty("browser_download_url").GetString();
                if (setupUrl == null && n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && n.Contains("Setup", StringComparison.OrdinalIgnoreCase)) { setupName = n; setupUrl = u; }
                else if (n.Equals(SumsName, StringComparison.OrdinalIgnoreCase)) sums = u;
                else if (n.Equals(SigName, StringComparison.OrdinalIgnoreCase)) sig = u;
            }
        }
        _last = new Release(tag, page, setupName, setupUrl, sums, sig);
        return new { available = setupUrl != null && IsNewer(tag, AppInfo.Version), version = tag.TrimStart('v', 'V'), notes, url = setupUrl, page, verified = sums != null && sig != null };
    }

    internal static bool IsNewer(string candidate, string current)
    {
        return Version.TryParse(Normalize(candidate), out var a) && Version.TryParse(Normalize(current), out var c) && a > c;
    }

    internal static string Normalize(string v)
    {
        v = v.Trim().TrimStart('v', 'V');
        var cut = v.IndexOfAny(new[] { '-', '+', ' ' });
        if (cut >= 0) v = v[..cut];
        return v.Contains('.') ? v : v + ".0";
    }

    /// <summary>Verifica la firma ECDSA (P-256, SHA-256, DER) del manifiesto con la clave pública dada (PEM).</summary>
    internal static bool VerifyManifest(byte[] manifest, byte[] signature, string publicKeyPem)
    {
        try
        {
            using var ec = ECDsa.Create();
            ec.ImportFromPem(publicKeyPem);
            return ec.VerifyData(manifest, signature, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
        }
        catch (CryptographicException) { return false; }
    }

    /// <summary>Lee un manifiesto con líneas «hash  nombre» (formato de sha256sum; acepta «*nombre»).</summary>
    internal static Dictionary<string, string> ParseSums(byte[] manifest)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var raw in Encoding.UTF8.GetString(manifest).Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length < 66) continue;
            var hash = line[..64];
            if (!hash.All(Uri.IsHexDigit)) continue;
            var name = line[64..].TrimStart(' ', '\t', '*').Trim();
            if (name.Length > 0) map[name] = hash.ToLowerInvariant();
        }
        return map;
    }

    /// <summary>Comprueba un archivo descargado contra el manifiesto firmado. Lanza una excepción si no coincide.</summary>
    internal static void VerifyFile(string file, string fileName, byte[] manifest, byte[] signature, string publicKeyPem)
    {
        if (!VerifyManifest(manifest, signature, publicKeyPem))
            throw new UpdateVerificationException("La firma del manifiesto de la actualización no es válida.");
        if (!ParseSums(manifest).TryGetValue(fileName, out var expected))
            throw new UpdateVerificationException($"El manifiesto firmado no incluye «{fileName}».");
        string actual;
        using (var fs = File.OpenRead(file)) actual = Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(actual), Encoding.ASCII.GetBytes(expected)))
            throw new UpdateVerificationException("El instalador descargado no coincide con el publicado (SHA-256 distinto).");
    }

    public static async Task DownloadAndRunAsync(string url)
    {
        var rel = _last;
        var allowed = $"https://github.com/{AppInfo.GitHubRepo}/releases/download/";
        if (rel == null || rel.SetupUrl == null || !string.Equals(url, rel.SetupUrl, StringComparison.Ordinal) || !url.StartsWith(allowed, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Dirección de actualización no permitida. Vuelva a buscar actualizaciones.");
        if (rel.SumsUrl == null || rel.SigUrl == null)
            throw new UpdateVerificationException("Esta versión no trae el manifiesto firmado, así que no se instalará automáticamente.");
        var manifest = await Http.GetByteArrayAsync(rel.SumsUrl);
        var signature = await Http.GetByteArrayAsync(rel.SigUrl);
        var file = Path.Combine(Path.GetTempPath(), "Rubrica-Setup-" + Guid.NewGuid().ToString("N")[..8] + ".exe");
        using (var r = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
        {
            r.EnsureSuccessStatusCode();
            await using var fs = File.Create(file);
            await r.Content.CopyToAsync(fs);
        }
        try { VerifyFile(file, rel.SetupName!, manifest, signature, AppInfo.UpdatePublicKey); }
        catch { try { File.Delete(file); } catch { } throw; }
        Log.Info("Instalador verificado (" + rel.Tag + "), ejecutando " + file);
        Process.Start(new ProcessStartInfo(file, "/SILENT /SUPPRESSMSGBOXES /CLOSEAPPLICATIONS /NORESTART") { UseShellExecute = true });
    }

    public static string ReleasePage => _last?.Page ?? $"https://github.com/{AppInfo.GitHubRepo}/releases/latest";
}

/// <summary>La actualización descargada no pasó la verificación: no se ejecuta.</summary>
internal sealed class UpdateVerificationException(string message) : Exception(message);
