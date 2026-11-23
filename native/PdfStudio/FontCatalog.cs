using System.Text;

namespace PdfStudio;

/// <summary>Una fuente instalada: familia, estilo y archivo.</summary>
internal sealed record FontEntry(string Family, string Style, string File);

/// <summary>
/// Catálogo de fuentes del equipo: fuentes de Windows, fuentes instaladas por el usuario y
/// fuentes en la nube de Microsoft 365 (Aptos y otras), que Office descarga en
/// %LOCALAPPDATA%\Microsoft\FontCache\4\CloudFonts y que otras aplicaciones no ven.
/// </summary>
internal sealed class FontCatalog
{
    public static FontCatalog Instance { get; } = new();

    private readonly object _gate = new();
    private List<FontEntry> _list = new();
    private HashSet<string> _files = new(StringComparer.OrdinalIgnoreCase);
    private Task? _scan;

    public void StartScan()
    {
        lock (_gate) _scan ??= Task.Run(Scan);
    }

    public IReadOnlyList<FontEntry> List()
    {
        StartScan();
        _scan!.Wait(TimeSpan.FromSeconds(30));
        lock (_gate) return _list;
    }

    public bool Contains(string file)
    {
        lock (_gate) return _files.Contains(file);
    }

    internal static IEnumerable<string> FontDirectories()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        yield return Environment.GetFolderPath(Environment.SpecialFolder.Fonts);
        yield return Path.Combine(local, "Microsoft", "Windows", "Fonts");
        yield return Path.Combine(local, "Microsoft", "FontCache", "4", "CloudFonts");
    }

    private void Scan()
    {
        var list = new List<FontEntry>();
        var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var opts = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true };
        foreach (var dir in FontDirectories())
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) continue;
            foreach (var file in Directory.EnumerateFiles(dir, "*", opts))
            {
                var ext = Path.GetExtension(file).ToLowerInvariant();
                if (ext is ".ttc" or ".fon" or ".fnt" or ".ini" or ".dat" or ".xml" or ".json") continue;
                try
                {
                    var names = FontNames.Read(file);
                    if (names == null) continue;
                    if (files.Add(file)) list.Add(new FontEntry(names.Value.Family, names.Value.Style, file));
                }
                catch (Exception ex)
                {
                    Log.Error("Fuente " + file, ex);
                }
            }
        }
        list.Sort((a, b) => string.Compare(a.Family, b.Family, StringComparison.CurrentCultureIgnoreCase));
        lock (_gate)
        {
            _list = list;
            _files = files;
        }
        Log.Info($"Fuentes encontradas: {list.Count}");
    }
}

/// <summary>Lee la familia y el estilo desde la tabla «name» de un archivo TrueType/OpenType.</summary>
internal static class FontNames
{
    private const uint TagName = 0x6E616D65; // 'name'

    public static (string Family, string Style)? Read(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        if (fs.Length < 12) return null;
        using var br = new BinaryReader(fs);
        var sfnt = U32(br);
        // 0x00010000 = TrueType, 'OTTO' = OpenType CFF, 'true' = TrueType de Apple. Se omiten colecciones .ttc.
        if (sfnt != 0x00010000 && sfnt != 0x4F54544F && sfnt != 0x74727565) return null;
        var numTables = U16(br);
        fs.Seek(6, SeekOrigin.Current);
        long nameOffset = -1;
        for (var i = 0; i < numTables; i++)
        {
            var tag = U32(br);
            U32(br); // checksum
            var offset = U32(br);
            U32(br); // longitud
            if (tag == TagName) nameOffset = offset;
        }
        if (nameOffset < 0 || nameOffset >= fs.Length) return null;

        fs.Seek(nameOffset, SeekOrigin.Begin);
        U16(br); // formato
        var count = U16(br);
        var stringOffset = U16(br);
        var records = new List<(ushort Platform, ushort Encoding, ushort Language, ushort NameId, ushort Length, ushort Offset)>();
        for (var i = 0; i < count; i++)
            records.Add((U16(br), U16(br), U16(br), U16(br), U16(br), U16(br)));

        string? Get(ushort id)
        {
            var matches = records.Where(x => x.NameId == id && (x.Platform == 3 || x.Platform == 0 || x.Platform == 1))
                .OrderBy(x => x.Platform == 3 && x.Language == 0x0409 ? 0 : x.Platform == 3 ? 1 : x.Platform == 0 ? 2 : 3)
                .ToList();
            if (matches.Count == 0) return null;
            var r = matches[0];
            var pos = nameOffset + stringOffset + r.Offset;
            if (pos + r.Length > fs.Length) return null;
            fs.Seek(pos, SeekOrigin.Begin);
            var raw = br.ReadBytes(r.Length);
            var text = r.Platform == 1 ? Encoding.Latin1.GetString(raw) : Encoding.BigEndianUnicode.GetString(raw);
            text = text.Trim('\0', ' ');
            return string.IsNullOrWhiteSpace(text) ? null : text;
        }

        var family = Get(16) ?? Get(1);
        var style = Get(17) ?? Get(2) ?? "Regular";
        if (string.IsNullOrWhiteSpace(family)) return null;
        return (family, style);
    }

    private static ushort U16(BinaryReader br)
    {
        var b = br.ReadBytes(2);
        if (b.Length < 2) throw new EndOfStreamException();
        return (ushort)((b[0] << 8) | b[1]);
    }

    private static uint U32(BinaryReader br)
    {
        var b = br.ReadBytes(4);
        if (b.Length < 4) throw new EndOfStreamException();
        return ((uint)b[0] << 24) | ((uint)b[1] << 16) | ((uint)b[2] << 8) | b[3];
    }
}
