using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Rubrica;

/// <summary>
/// Servidor HTTP local (solo localhost). Sirve la interfaz y la API /__native/*.
/// La API exige el token de sesión que solo recibe la página de la aplicación y
/// valida el encabezado Host para evitar ataques de «DNS rebinding».
/// </summary>
internal sealed class LocalServer : IDisposable
{
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);
    private static readonly string[] ReadableExt = { ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff" };
    private static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".json"] = "application/json",
        [".css"] = "text/css", [".png"] = "image/png", [".ico"] = "image/x-icon", [".svg"] = "image/svg+xml", [".txt"] = "text/plain; charset=utf-8",
    };

    private readonly MainForm _form;
    private readonly HashSet<string> _allowed = new(StringComparer.OrdinalIgnoreCase);
    private HttpListener? _listener;

    public LocalServer(MainForm form) => _form = form;

    public int Port { get; private set; }
    public string Token { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
    public string Origin => $"http://localhost:{Port}";

    public void Start()
    {
        for (var port = AppInfo.PreferredPort; port < AppInfo.PreferredPort + 15; port++)
        {
            var l = new HttpListener();
            l.Prefixes.Add($"http://localhost:{port}/");
            try
            {
                l.Start();
                _listener = l;
                Port = port;
                break;
            }
            catch (HttpListenerException)
            {
                l.Close();
            }
        }
        if (_listener == null) throw new InvalidOperationException("No hay un puerto local libre (8765–8779).");
        if (Port != AppInfo.PreferredPort) Log.Info($"Puerto {AppInfo.PreferredPort} ocupado; se usa {Port}. La nube requiere registrar http://localhost:{Port}/");
        _ = Task.Run(() => LoopAsync());
    }

    public void AllowPaths(IEnumerable<string> paths)
    {
        lock (_allowed) foreach (var p in paths) if (!string.IsNullOrWhiteSpace(p)) _allowed.Add(Path.GetFullPath(p));
    }

    private bool IsAllowed(string full)
    {
        lock (_allowed) return _allowed.Contains(full);
    }

    private async Task LoopAsync()
    {
        while (_listener is { IsListening: true })
        {
            HttpListenerContext ctx;
            try { ctx = await _listener.GetContextAsync(); }
            catch (Exception) { break; }
            _ = Task.Run(() => HandleAsync(ctx));
        }
    }

    private async Task HandleAsync(HttpListenerContext ctx)
    {
        var res = ctx.Response;
        try
        {
            var host = ctx.Request.Headers["Host"] ?? "";
            if (!host.Equals($"localhost:{Port}", StringComparison.OrdinalIgnoreCase) && !host.Equals($"127.0.0.1:{Port}", StringComparison.Ordinal))
            {
                res.StatusCode = 403;
                return;
            }
            var path = Uri.UnescapeDataString(ctx.Request.Url!.AbsolutePath);
            if (path.StartsWith("/__native/", StringComparison.Ordinal))
            {
                var tok = Encoding.UTF8.GetBytes(ctx.Request.Headers["X-PDFS-Token"] ?? "");
                if (!CryptographicOperations.FixedTimeEquals(tok, Encoding.UTF8.GetBytes(Token)))
                {
                    res.StatusCode = 401;
                    return;
                }
                await HandleApiAsync(path["/__native/".Length..], ctx);
            }
            else
            {
                await ServeStaticAsync(path, res);
            }
        }
        catch (Exception ex)
        {
            Log.Error("HTTP " + ctx.Request.Url?.AbsolutePath, ex);
            try { await WriteTextAsync(res, 500, Friendly(ex)); } catch { /* conexión cerrada */ }
        }
        finally
        {
            try { res.Close(); } catch { /* ya cerrada */ }
        }
    }

    private static string Friendly(Exception ex) => ex switch
    {
        IOException when ex.HResult == unchecked((int)0x80070020) => "El archivo está abierto en otro programa. Ciérrelo e intente de nuevo.",
        UnauthorizedAccessException => "Windows no permite escribir en esa ubicación.",
        CryptographicException => "Error del certificado: " + ex.Message,
        TaskCanceledException => "El servidor de marca de tiempo no respondió a tiempo.",
        HttpRequestException when ex.InnerException != null => "No se pudo contactar el servidor de marca de tiempo: " + ex.InnerException.Message,
        _ => ex.Message,
    };

    private static async Task ServeStaticAsync(string path, HttpListenerResponse res)
    {
        if (path == "/" || path == "") path = "/index.html";
        var root = Path.GetFullPath(AppInfo.WebRoot);
        var full = Path.GetFullPath(Path.Combine(root, path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
        {
            res.StatusCode = 404;
            return;
        }
        var bytes = await File.ReadAllBytesAsync(full);
        res.ContentType = Mime.TryGetValue(Path.GetExtension(full), out var m) ? m : "application/octet-stream";
        res.Headers["Cache-Control"] = "no-cache";
        res.Headers["X-Content-Type-Options"] = "nosniff";
        await WriteBytesAsync(res, bytes, res.ContentType);
    }

    private async Task HandleApiAsync(string name, HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var res = ctx.Response;
        var q = req.QueryString;
        switch (name)
        {
            case "info":
                await WriteJsonAsync(res, new { version = AppInfo.Version, port = Port });
                break;

            case "fonts":
                await WriteJsonAsync(res, await Task.Run(() => FontCatalog.Instance.List()));
                break;

            case "font":
            {
                var file = q["file"];
                if (file == null || !FontCatalog.Instance.Contains(file)) { res.StatusCode = 404; return; }
                await WriteBytesAsync(res, await File.ReadAllBytesAsync(file), "font/ttf");
                break;
            }

            case "open-dialog":
            {
                var files = _form.OnUi(() =>
                {
                    using var d = new OpenFileDialog
                    {
                        Title = "Abrir",
                        Multiselect = true,
                        Filter = "PDF e imágenes|*.pdf;*.png;*.jpg;*.jpeg;*.gif;*.bmp;*.webp|Documentos PDF (*.pdf)|*.pdf|Todos los archivos|*.*",
                    };
                    return d.ShowDialog(_form) == DialogResult.OK ? d.FileNames : Array.Empty<string>();
                });
                AllowPaths(files);
                await WriteJsonAsync(res, new { files = files.Select(p => new { path = p }) });
                break;
            }

            case "save-dialog":
            {
                var body = await ReadJsonAsync<SaveRequest>(req);
                var path = _form.OnUi(() =>
                {
                    using var d = new SaveFileDialog
                    {
                        Title = "Guardar como",
                        Filter = "Documento PDF (*.pdf)|*.pdf",
                        DefaultExt = "pdf",
                        AddExtension = true,
                        OverwritePrompt = true,
                        FileName = SafeFileName(body?.Name ?? "documento.pdf"),
                    };
                    if (!string.IsNullOrWhiteSpace(body?.Dir) && Directory.Exists(body.Dir)) d.InitialDirectory = body.Dir;
                    return d.ShowDialog(_form) == DialogResult.OK ? d.FileName : null;
                });
                if (path != null) AllowPaths(new[] { path });
                await WriteJsonAsync(res, new { path });
                break;
            }

            case "read":
            {
                var p = q["path"];
                if (string.IsNullOrWhiteSpace(p)) { res.StatusCode = 400; return; }
                var full = Path.GetFullPath(p);
                if (!ReadableExt.Contains(Path.GetExtension(full).ToLowerInvariant()) || !File.Exists(full))
                {
                    await WriteTextAsync(res, 404, "El archivo no existe o no es compatible: " + full);
                    return;
                }
                AllowPaths(new[] { full });
                await WriteBytesAsync(res, await File.ReadAllBytesAsync(full), "application/octet-stream");
                break;
            }

            case "write":
            {
                var p = q["path"];
                if (string.IsNullOrWhiteSpace(p)) { res.StatusCode = 400; return; }
                var full = Path.GetFullPath(p);
                if (!IsAllowed(full) || !full.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                {
                    await WriteTextAsync(res, 403, "Ruta no autorizada. Use «Guardar como».");
                    return;
                }
                var bytes = await ReadBodyAsync(req);
                var tmp = full + ".rubrica.tmp";
                await File.WriteAllBytesAsync(tmp, bytes);
                File.Move(tmp, full, overwrite: true);
                await WriteJsonAsync(res, new { ok = true, path = full, size = bytes.Length });
                break;
            }

            case "certs":
                await WriteJsonAsync(res, CertStore.List());
                break;

            case "sign":
            {
                var tp = q["thumbprint"];
                if (string.IsNullOrWhiteSpace(tp)) { res.StatusCode = 400; return; }
                var data = await ReadBodyAsync(req);
                var cms = await Task.Run(() => CertStore.Sign(data, tp));
                await WriteBytesAsync(res, cms, "application/pkcs7-signature");
                break;
            }

            case "tsa":
            {
                var url = req.Headers["X-Tsa-Url"];
                if (string.IsNullOrWhiteSpace(url) || req.HttpMethod != "POST") { res.StatusCode = 400; return; }
                var reply = await Tsa.RequestAsync(url, await ReadBodyAsync(req), req.Headers["X-Tsa-Auth"]);
                await WriteBytesAsync(res, reply, "application/timestamp-reply");
                break;
            }

            case "update-check":
                await WriteJsonAsync(res, await Updater.CheckAsync());
                break;

            case "update-install":
            {
                var body = await ReadJsonAsync<UpdateRequest>(req);
                if (string.IsNullOrWhiteSpace(body?.Url)) { res.StatusCode = 400; return; }
                await Updater.DownloadAndRunAsync(body.Url);
                await WriteJsonAsync(res, new { ok = true });
                _form.CloseForUpdate();
                break;
            }

            default:
                res.StatusCode = 404;
                break;
        }
    }

    private static string SafeFileName(string name)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        return name;
    }

    private static async Task<byte[]> ReadBodyAsync(HttpListenerRequest req)
    {
        using var ms = new MemoryStream();
        await req.InputStream.CopyToAsync(ms);
        return ms.ToArray();
    }

    private static async Task<T?> ReadJsonAsync<T>(HttpListenerRequest req)
    {
        var bytes = await ReadBodyAsync(req);
        return bytes.Length == 0 ? default : JsonSerializer.Deserialize<T>(bytes, JsonOpts);
    }

    private static Task WriteJsonAsync(HttpListenerResponse res, object? value) =>
        WriteBytesAsync(res, JsonSerializer.SerializeToUtf8Bytes(value, JsonOpts), "application/json; charset=utf-8");

    private static Task WriteTextAsync(HttpListenerResponse res, int status, string text)
    {
        res.StatusCode = status;
        return WriteBytesAsync(res, Encoding.UTF8.GetBytes(text), "text/plain; charset=utf-8");
    }

    private static async Task WriteBytesAsync(HttpListenerResponse res, byte[] bytes, string contentType)
    {
        res.ContentType = contentType;
        res.ContentLength64 = bytes.Length;
        await res.OutputStream.WriteAsync(bytes);
    }

    public void Dispose()
    {
        try { _listener?.Stop(); _listener?.Close(); } catch { /* ignorado */ }
    }

    private sealed record SaveRequest(string? Name, string? Dir);

    private sealed record UpdateRequest(string? Url);
}
