using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Rubrica;

/// <summary>
/// Convierte documentos de Office a PDF con el Office instalado (automatización COM, sin ensamblados de interoperabilidad)
/// o, si no hay Office, con LibreOffice en modo sin interfaz. Nunca se ejecutan macros y nada se envía a internet.
/// </summary>
public static class OfficeConverter
{
    public enum Kind { None, Word, Excel, PowerPoint }

    private static readonly Dictionary<string, Kind> Ext = new(StringComparer.OrdinalIgnoreCase)
    {
        [".doc"] = Kind.Word, [".docx"] = Kind.Word, [".docm"] = Kind.Word, [".dot"] = Kind.Word, [".dotx"] = Kind.Word, [".rtf"] = Kind.Word, [".odt"] = Kind.Word,
        [".xls"] = Kind.Excel, [".xlsx"] = Kind.Excel, [".xlsm"] = Kind.Excel, [".xlsb"] = Kind.Excel, [".csv"] = Kind.Excel, [".ods"] = Kind.Excel,
        [".ppt"] = Kind.PowerPoint, [".pptx"] = Kind.PowerPoint, [".pptm"] = Kind.PowerPoint, [".pps"] = Kind.PowerPoint, [".ppsx"] = Kind.PowerPoint, [".odp"] = Kind.PowerPoint,
    };

    public static IReadOnlyCollection<string> Extensions => Ext.Keys;

    public static Kind KindOf(string fileName) => Ext.TryGetValue(Path.GetExtension(fileName ?? ""), out var k) ? k : Kind.None;

    private static readonly Dictionary<Kind, string> ProgId = new()
    {
        [Kind.Word] = "Word.Application", [Kind.Excel] = "Excel.Application", [Kind.PowerPoint] = "PowerPoint.Application",
    };

    public static bool HasOffice(Kind k) => k != Kind.None && Type.GetTypeFromProgID(ProgId[k]) != null;

    /// <summary>Ruta de soffice.exe si LibreOffice está instalado.</summary>
    public static string? LibreOfficePath()
    {
        foreach (var root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) })
        {
            if (string.IsNullOrEmpty(root)) continue;
            var p = Path.Combine(root, "LibreOffice", "program", "soffice.exe");
            if (File.Exists(p)) return p;
        }
        return null;
    }

    public static object Info() => new
    {
        word = HasOffice(Kind.Word),
        excel = HasOffice(Kind.Excel),
        powerpoint = HasOffice(Kind.PowerPoint),
        libreoffice = LibreOfficePath() != null,
        extensions = Ext.Keys.Select(e => e.TrimStart('.')).ToArray(),
    };

    /// <summary>Convierte los bytes de un documento de Office a PDF.</summary>
    public static async Task<byte[]> ConvertAsync(byte[] data, string fileName, TimeSpan? timeout = null)
    {
        var kind = KindOf(fileName);
        if (kind == Kind.None) throw new NotSupportedException("Este tipo de archivo no se puede convertir a PDF: " + Path.GetExtension(fileName));
        var useOffice = HasOffice(kind);
        var lo = useOffice ? null : LibreOfficePath();
        if (!useOffice && lo == null)
            throw new InvalidOperationException(kind switch
            {
                Kind.Word => "Para convertir documentos de Word se necesita Microsoft Word o LibreOffice instalados en este equipo.",
                Kind.Excel => "Para convertir hojas de Excel se necesita Microsoft Excel o LibreOffice instalados en este equipo.",
                _ => "Para convertir presentaciones se necesita Microsoft PowerPoint o LibreOffice instalados en este equipo.",
            });

        var dir = Path.Combine(Path.GetTempPath(), "Rubrica-office-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var safe = string.Concat(Path.GetFileName(fileName).Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
            var input = Path.Combine(dir, safe);
            var output = Path.Combine(dir, Path.GetFileNameWithoutExtension(safe) + ".pdf");
            await File.WriteAllBytesAsync(input, data);
            var limit = timeout ?? TimeSpan.FromMinutes(3);
            if (useOffice) await RunSta(() => ConvertWithOffice(kind, input, output), limit);
            else await ConvertWithLibreOffice(lo!, input, dir, limit);
            if (!File.Exists(output)) throw new InvalidOperationException("La conversión no produjo un PDF.");
            return await File.ReadAllBytesAsync(output);
        }
        finally
        {
            try { Directory.Delete(dir, true); } catch { /* el antivirus o Office pueden retener el archivo un momento */ }
        }
    }

    /// <summary>La automatización de Office requiere un hilo STA propio.</summary>
    private static Task RunSta(Action action, TimeSpan limit)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var t = new Thread(() =>
        {
            try { action(); tcs.TrySetResult(); }
            catch (Exception ex) { tcs.TrySetException(Unwrap(ex)); }
        }) { IsBackground = true, Name = "Rubrica-Office" };
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        return tcs.Task.WaitAsync(limit).ContinueWith(r =>
        {
            if (r.IsFaulted && r.Exception!.InnerException is TimeoutException)
                throw new TimeoutException("Office tardó demasiado en convertir el archivo. Ábralo en Office para revisar si muestra algún aviso.");
            r.GetAwaiter().GetResult();
        });
    }

    private static Exception Unwrap(Exception ex)
    {
        while (ex is System.Reflection.TargetInvocationException && ex.InnerException != null) ex = ex.InnerException;
        if (ex is COMException c)
            return new InvalidOperationException("Office no pudo abrir o convertir el archivo (puede estar dañado o protegido con contraseña). " + c.Message, c);
        return ex;
    }

    private const int MsoAutomationSecurityForceDisable = 3;

    private static void ConvertWithOffice(Kind kind, string input, string output)
    {
        var type = Type.GetTypeFromProgID(ProgId[kind])!;
        dynamic app = Activator.CreateInstance(type)!;
        var reused = false;
        object? file = null;
        Action? restore = null;
        try
        {
            switch (kind)
            {
                case Kind.Word:
                {
                    reused = app.Documents.Count > 0; // Word ya abierto por el usuario: no ocultarlo ni cerrarlo
                    if (!reused) { try { app.Visible = false; } catch { } }
                    restore = Remember(app);
                    app.DisplayAlerts = 0; // wdAlertsNone
                    app.AutomationSecurity = MsoAutomationSecurityForceDisable;
                    // Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
                    dynamic doc = app.Documents.Open(input, false, true, false);
                    file = doc;
                    doc.ExportAsFixedFormat(output, 17); // wdExportFormatPDF
                    doc.Close(0); // wdDoNotSaveChanges
                    file = null;
                    break;
                }
                case Kind.Excel:
                {
                    reused = app.Workbooks.Count > 0;
                    restore = Remember(app);
                    app.DisplayAlerts = false;
                    app.AutomationSecurity = MsoAutomationSecurityForceDisable;
                    // Open(Filename, UpdateLinks = 0, ReadOnly = true)
                    dynamic wb = app.Workbooks.Open(input, 0, true);
                    file = wb;
                    wb.ExportAsFixedFormat(0, output); // xlTypePDF
                    wb.Close(false);
                    file = null;
                    break;
                }
                case Kind.PowerPoint:
                {
                    reused = app.Presentations.Count > 0; // PowerPoint tiene una sola instancia
                    restore = Remember(app);
                    app.DisplayAlerts = 1; // ppAlertsNone
                    app.AutomationSecurity = MsoAutomationSecurityForceDisable;
                    // Open(FileName, ReadOnly = msoTrue, Untitled = msoFalse, WithWindow = msoFalse)
                    dynamic pres = app.Presentations.Open(input, -1, 0, 0);
                    file = pres;
                    pres.SaveAs(output, 32); // ppSaveAsPDF
                    pres.Close();
                    file = null;
                    break;
                }
            }
        }
        finally
        {
            if (file != null) { try { ((dynamic)file).Close(); } catch { } try { Marshal.FinalReleaseComObject(file); } catch { } }
            if (!reused) { try { app.Quit(); } catch { } }
            else { try { restore?.Invoke(); } catch { } } // deja Office del usuario como estaba
            try { Marshal.FinalReleaseComObject(app); } catch { }
            GC.Collect();
            GC.WaitForPendingFinalizers();
        }
    }

    private static Action Remember(dynamic app)
    {
        object alerts = app.DisplayAlerts, security = app.AutomationSecurity;
        return () => { app.DisplayAlerts = (dynamic)alerts; app.AutomationSecurity = (dynamic)security; };
    }

    private static async Task ConvertWithLibreOffice(string soffice, string input, string outDir, TimeSpan limit)
    {
        // perfil temporal propio: no interfiere con un LibreOffice abierto por el usuario
        var profile = new Uri(Path.Combine(outDir, "lo-profile")).AbsoluteUri;
        var psi = new ProcessStartInfo(soffice)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };
        foreach (var a in new[] { "-env:UserInstallation=" + profile, "--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", outDir, input })
            psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("No se pudo iniciar LibreOffice.");
        using var cts = new CancellationTokenSource(limit);
        try { await p.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException)
        {
            try { p.Kill(true); } catch { }
            throw new TimeoutException("LibreOffice tardó demasiado en convertir el archivo.");
        }
        if (p.ExitCode != 0)
            throw new InvalidOperationException("LibreOffice no pudo convertir el archivo: " + (await p.StandardError.ReadToEndAsync()).Trim());
    }
}
