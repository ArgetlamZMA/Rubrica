using System.Net.Http.Headers;

namespace Rubrica;

/// <summary>
/// Descargas para la validación a largo plazo (LTV) de firmas: respuestas OCSP, listas CRL y certificados de emisores.
/// Los navegadores no permiten estas llamadas desde la página (CORS). Solo http/https, tamaños acotados y sin cookies.
/// Las respuestas son datos firmados: su integridad se comprueba en la interfaz, no dependen del transporte.
/// </summary>
public static class NetFetch
{
    private static readonly HttpClient Http = new(new HttpClientHandler { UseCookies = false, AllowAutoRedirect = true, MaxAutomaticRedirections = 3 }) { Timeout = TimeSpan.FromSeconds(30) };
    public const int MaxResponse = 20 * 1024 * 1024;

    public static Uri Validate(string url, string method, int bodyLength)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new ArgumentException("Dirección no válida: solo se permiten http y https.");
        if (uri.IsLoopback && !AllowLoopback) throw new ArgumentException("Dirección no permitida.");
        if (method != "GET" && method != "POST") throw new ArgumentException("Método no permitido.");
        if (bodyLength > 64 * 1024) throw new ArgumentException("Solicitud demasiado grande.");
        return uri;
    }

    /// <summary>Solo para pruebas.</summary>
    internal static bool AllowLoopback { get; set; }

    public static async Task<byte[]> FetchAsync(string url, string method, string? contentType, byte[] body)
    {
        var uri = Validate(url, method, body.Length);
        using var msg = new HttpRequestMessage(method == "POST" ? HttpMethod.Post : HttpMethod.Get, uri);
        if (method == "POST")
        {
            msg.Content = new ByteArrayContent(body);
            msg.Content.Headers.ContentType = new MediaTypeHeaderValue(string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType);
        }
        using var resp = await Http.SendAsync(msg, HttpCompletionOption.ResponseHeadersRead);
        if (!resp.IsSuccessStatusCode) throw new HttpRequestException($"{uri.Host} respondió {(int)resp.StatusCode} {resp.ReasonPhrase}.");
        if (resp.Content.Headers.ContentLength > MaxResponse) throw new HttpRequestException("La respuesta es demasiado grande.");
        await using var s = await resp.Content.ReadAsStreamAsync();
        using var ms = new MemoryStream();
        var buf = new byte[81920]; int n;
        while ((n = await s.ReadAsync(buf)) > 0) { ms.Write(buf, 0, n); if (ms.Length > MaxResponse) throw new HttpRequestException("La respuesta es demasiado grande."); }
        return ms.ToArray();
    }
}
