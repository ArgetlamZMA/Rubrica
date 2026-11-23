using System.Diagnostics;
using System.Text.Json;

namespace PdfStudio;

/// <summary>Actualizaciones desde las versiones publicadas en GitHub (Releases).</summary>
internal static class Updater
{
    private static readonly HttpClient Http = CreateClient();

    private static HttpClient CreateClient()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        h.DefaultRequestHeaders.UserAgent.ParseAdd("PDFStudio/" + AppInfo.Version);
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
        string? url = null;
        if (root.TryGetProperty("assets", out var assets))
        {
            foreach (var a in assets.EnumerateArray())
            {
                var n = a.GetProperty("name").GetString() ?? "";
                if (n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && n.Contains("Setup", StringComparison.OrdinalIgnoreCase))
                {
                    url = a.GetProperty("browser_download_url").GetString();
                    break;
                }
            }
        }
        return new { available = url != null && IsNewer(tag, AppInfo.Version), version = tag.TrimStart('v', 'V'), notes, url };
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

    public static async Task DownloadAndRunAsync(string url)
    {
        var allowed = $"https://github.com/{AppInfo.GitHubRepo}/releases/download/";
        if (!url.StartsWith(allowed, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Dirección de actualización no permitida.");
        var file = Path.Combine(Path.GetTempPath(), "PDFStudio-Setup-" + Guid.NewGuid().ToString("N")[..8] + ".exe");
        using (var r = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
        {
            r.EnsureSuccessStatusCode();
            await using var fs = File.Create(file);
            await r.Content.CopyToAsync(fs);
        }
        Log.Info("Ejecutando instalador " + file);
        Process.Start(new ProcessStartInfo(file, "/SILENT /SUPPRESSMSGBOXES /CLOSEAPPLICATIONS /NORESTART") { UseShellExecute = true });
    }
}
