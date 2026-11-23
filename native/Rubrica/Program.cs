using System.IO.Pipes;
using System.Text;

namespace Rubrica;

internal static class Program
{
    private static readonly string PipeName = "Rubrica-" + Environment.UserName;

    [STAThread]
    private static void Main(string[] args)
    {
        var files = args.Where(a => !a.StartsWith('-') && File.Exists(a)).Select(Path.GetFullPath).ToArray();

        // Instancia única: si ya hay una ventana abierta, se le envían los archivos y se sale.
        using var mutex = new Mutex(true, "Local\\" + PipeName, out var isFirst);
        if (!isFirst)
        {
            if (TrySendToRunningInstance(files)) return;
        }

        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Log.Error("UI", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Error("Dominio", e.ExceptionObject as Exception);

        var form = new MainForm(files);
        if (isFirst) StartPipeServer(form);
        Application.Run(form);
    }

    private static bool TrySendToRunningInstance(string[] files)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(2000);
            var payload = Encoding.UTF8.GetBytes(string.Join("\n", files.Length > 0 ? files : new[] { "::activate" }));
            client.Write(payload, 0, payload.Length);
            client.Flush();
            return true;
        }
        catch (Exception ex)
        {
            Log.Error("Pipe cliente", ex);
            return false;
        }
    }

    private static void StartPipeServer(MainForm form)
    {
        var thread = new Thread(() =>
        {
            while (true)
            {
                try
                {
                    using var server = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte);
                    server.WaitForConnection();
                    using var reader = new StreamReader(server, Encoding.UTF8);
                    var text = reader.ReadToEnd();
                    var paths = text.Split('\n', StringSplitOptions.RemoveEmptyEntries).Where(p => p != "::activate").ToArray();
                    form.ReceiveExternalFiles(paths);
                }
                catch (Exception ex)
                {
                    Log.Error("Pipe servidor", ex);
                    Thread.Sleep(500);
                }
            }
        })
        { IsBackground = true, Name = "RubricaPipe" };
        thread.Start();
    }
}

/// <summary>Registro de errores en %LOCALAPPDATA%\Rubrica\rubrica.log</summary>
internal static class Log
{
    private static readonly object Gate = new();

    public static void Error(string where, Exception? ex) => Write($"ERROR [{where}] {ex}");

    public static void Info(string msg) => Write("INFO " + msg);

    private static void Write(string line)
    {
        try
        {
            lock (Gate)
            {
                var path = Path.Combine(AppInfo.DataDir, "rubrica.log");
                if (File.Exists(path) && new FileInfo(path).Length > 2_000_000) File.Delete(path);
                File.AppendAllText(path, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {line}{Environment.NewLine}");
            }
        }
        catch
        {
            // el registro nunca debe detener la aplicación
        }
    }
}
