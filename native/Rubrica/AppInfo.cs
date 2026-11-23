using System.Reflection;

namespace Rubrica;

/// <summary>Datos generales de la aplicación.</summary>
internal static class AppInfo
{
    /// <summary>Repositorio de GitHub donde se publican las versiones (owner/repo). Cámbielo si publica un fork.</summary>
    public const string GitHubRepo = "ArgetlamZMA/Rubrica";

    /// <summary>Puerto local preferido. Debe coincidir con la URI de redirección registrada en Microsoft/Google.</summary>
    public const int PreferredPort = 8765;

    public static string Version
    {
        get
        {
            var v = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
                    ?? Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0";
            var plus = v.IndexOf('+');
            return plus >= 0 ? v[..plus] : v;
        }
    }

    public static string DataDir
    {
        get
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var d = Path.Combine(local, "Rubrica");
            // La versión 1.0 se llamaba «PDF Studio»: conservar su configuración, firmas y recientes.
            var old = Path.Combine(local, "PDFStudio");
            if (!Directory.Exists(d) && Directory.Exists(old))
            {
                try { Directory.Move(old, d); } catch { /* si falla, se empieza con datos nuevos */ }
            }
            Directory.CreateDirectory(d);
            return d;
        }
    }

    public static string WebRoot => Path.Combine(AppContext.BaseDirectory, "web");
}
