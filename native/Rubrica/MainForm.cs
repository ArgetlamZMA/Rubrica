using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Rubrica;

/// <summary>
/// Ventana principal: aloja la interfaz (web/dist) en WebView2 y la conecta con el servidor local.
/// </summary>
internal sealed class MainForm : Form
{
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private readonly List<string> _queued = new();
    private readonly object _queueGate = new();
    private LocalServer? _server;
    private bool _ready;
    private bool _allowClose;

    public MainForm(string[] initialFiles)
    {
        Text = "Rúbrica";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { /* sin ícono */ }
        MinimumSize = new Size(900, 600);
        WindowBounds.Restore(this);
        BackColor = Color.FromArgb(13, 13, 13);
        Controls.Add(_web);
        lock (_queueGate) _queued.AddRange(initialFiles);
        Load += async (_, _) => await InitAsync();
        FormClosing += OnFormClosing;
    }

    private async Task InitAsync()
    {
        try
        {
            FontCatalog.Instance.StartScan();
            _server = new LocalServer(this);
            _server.Start();

            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(AppInfo.DataDir, "WebView2"));
            await _web.EnsureCoreWebView2Async(env);
            var core = _web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDevToolsEnabled = true; // F12 para revisar errores
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;

            var info = JsonSerializer.Serialize(new { token = _server.Token, version = AppInfo.Version, port = _server.Port });
            // El token solo se entrega a la página de la aplicación, nunca a sitios externos (inicio de sesión, etc.).
            await core.AddScriptToExecuteOnDocumentCreatedAsync(
                $"if (location.origin === {JsonSerializer.Serialize(_server.Origin)}) {{ window.__PDFS_NATIVE = {info}; }}");

            core.NewWindowRequested += OnNewWindowRequested;
            core.DocumentTitleChanged += (_, _) => Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? "Rúbrica" : core.DocumentTitle;
            core.NavigationCompleted += (_, e) =>
            {
                if (!e.IsSuccess || _ready) return;
                _ready = true;
                FlushQueue();
            };
            core.Navigate(_server.Origin + "/");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            var r = MessageBox.Show(this,
                "Rúbrica necesita «Microsoft Edge WebView2 Runtime», incluido en Windows 10/11.\n\n¿Abrir la página de descarga?",
                "Rúbrica", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (r == DialogResult.Yes) OpenExternal("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            _allowClose = true;
            Close();
        }
        catch (Exception ex)
        {
            Log.Error("Inicio", ex);
            MessageBox.Show(this, "No se pudo iniciar Rúbrica:\n\n" + ex.Message, "Rúbrica", MessageBoxButtons.OK, MessageBoxIcon.Error);
            _allowClose = true;
            Close();
        }
    }

    /// <summary>Ventanas emergentes: el inicio de sesión de Microsoft/Google se abre dentro de la app; los demás enlaces, en el navegador.</summary>
    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;
        var host = uri.Host.ToLowerInvariant();
        var inApp = uri.Scheme is "blob" or "data" || host == "localhost"
                    || host.EndsWith("login.microsoftonline.com") || host.EndsWith("login.live.com") || host.EndsWith("login.microsoft.com")
                    || host == "accounts.google.com" || host.EndsWith(".accounts.google.com");
        if (inApp) return;
        e.Handled = true;
        OpenExternal(e.Uri);
    }

    internal static void OpenExternal(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { Log.Error("Abrir enlace", ex); }
    }

    /// <summary>Archivos recibidos desde otra instancia (doble clic en un PDF, «Abrir con»).</summary>
    public void ReceiveExternalFiles(string[] paths)
    {
        if (IsDisposed) return;
        if (!IsHandleCreated)
        {
            lock (_queueGate) _queued.AddRange(paths);
            return;
        }
        BeginInvoke(new Action(() =>
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
            BringToFront();
            lock (_queueGate) _queued.AddRange(paths);
            if (_ready) FlushQueue();
        }));
    }

    private void FlushQueue()
    {
        string[] items;
        lock (_queueGate) { items = _queued.ToArray(); _queued.Clear(); }
        if (items.Length == 0 || _server == null || _web.CoreWebView2 == null) return;
        _server.AllowPaths(items);
        _ = _web.CoreWebView2.ExecuteScriptAsync($"window.pdfsNativeOpen && window.pdfsNativeOpen({JsonSerializer.Serialize(items)})");
    }

    /// <summary>Ejecuta una función en el hilo de la interfaz (diálogos de Windows).</summary>
    public T OnUi<T>(Func<T> func) => InvokeRequired ? (T)Invoke(func)! : func();

    public void CloseForUpdate()
    {
        BeginInvoke(new Action(() => { _allowClose = true; Close(); }));
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_allowClose || _web.CoreWebView2 == null)
        {
            WindowBounds.Save(this);
            _server?.Dispose();
            return;
        }
        e.Cancel = true;
        _ = ConfirmCloseAsync();
    }

    private async Task ConfirmCloseAsync()
    {
        var dirty = "false";
        try { dirty = await _web.CoreWebView2.ExecuteScriptAsync("(typeof S !== 'undefined' && S.docs.some(d => d.dirty))"); }
        catch (Exception ex) { Log.Error("Cerrar", ex); }
        if (dirty == "true" && MessageBox.Show(this, "Hay documentos con cambios sin guardar. ¿Salir de todas formas?",
                "Rúbrica", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
        _allowClose = true;
        Close();
    }
}

/// <summary>Recuerda tamaño y posición de la ventana.</summary>
internal static class WindowBounds
{
    private sealed record Data(int X, int Y, int W, int H, bool Max);

    private static string FilePath => Path.Combine(AppInfo.DataDir, "window.json");

    public static void Restore(Form f)
    {
        f.StartPosition = FormStartPosition.CenterScreen;
        f.Size = new Size(1360, 860);
        try
        {
            if (!File.Exists(FilePath)) return;
            var d = JsonSerializer.Deserialize<Data>(File.ReadAllText(FilePath));
            if (d == null || d.W < 600 || d.H < 400) return;
            var r = new Rectangle(d.X, d.Y, d.W, d.H);
            if (!Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r))) return;
            f.StartPosition = FormStartPosition.Manual;
            f.Bounds = r;
            if (d.Max) f.WindowState = FormWindowState.Maximized;
        }
        catch (Exception ex) { Log.Error("Ventana", ex); }
    }

    public static void Save(Form f)
    {
        try
        {
            var b = f.WindowState == FormWindowState.Normal ? f.Bounds : f.RestoreBounds;
            File.WriteAllText(FilePath, JsonSerializer.Serialize(new Data(b.X, b.Y, b.Width, b.Height, f.WindowState == FormWindowState.Maximized)));
        }
        catch (Exception ex) { Log.Error("Ventana", ex); }
    }
}
