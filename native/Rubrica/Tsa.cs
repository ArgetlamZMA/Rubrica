using System.Net.Http.Headers;

namespace Rubrica;

/// <summary>
/// Puente hacia los servidores de marca de tiempo (RFC 3161). El navegador no puede llamarlos
/// directamente (CORS / http), así que la interfaz envía aquí la solicitud ya armada y este
/// proceso la reenvía tal cual al servidor configurado (por ejemplo, la TSA del SAR).
/// </summary>
internal static class Tsa
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };

    static Tsa() => Http.DefaultRequestHeaders.UserAgent.ParseAdd("Rubrica/" + AppInfo.Version);

    public static async Task<byte[]> RequestAsync(string url, byte[] query, string? basicAuth)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new ArgumentException("La dirección del servidor de marca de tiempo no es válida.");
        if (query.Length == 0 || query.Length > 4096 || query[0] != 0x30)
            throw new ArgumentException("Solicitud de marca de tiempo no válida.");
        using var msg = new HttpRequestMessage(HttpMethod.Post, uri) { Content = new ByteArrayContent(query) };
        msg.Content.Headers.ContentType = new MediaTypeHeaderValue("application/timestamp-query");
        msg.Headers.Accept.ParseAdd("application/timestamp-reply");
        if (!string.IsNullOrEmpty(basicAuth)) msg.Headers.Authorization = new AuthenticationHeaderValue("Basic", basicAuth);
        using var resp = await Http.SendAsync(msg);
        var body = await resp.Content.ReadAsByteArrayAsync();
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"El servidor de marca de tiempo respondió {(int)resp.StatusCode} {resp.ReasonPhrase}.");
        if (body.Length == 0 || body[0] != 0x30)
            throw new HttpRequestException("El servidor de marca de tiempo no devolvió una respuesta válida.");
        return body;
    }
}
