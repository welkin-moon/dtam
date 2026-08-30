using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

const string Home = "https://d1.lunarlab.uk/";

[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
static extern int MessageBoxW(nint hWnd, string text, string caption, uint type);

static string ResolveEdge()
{
    var candidates = new[]
    {
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe")
    };
    return candidates.FirstOrDefault(File.Exists) ?? "msedge.exe";
}

static string BuildUrl(string[] args)
{
    if (args.Length == 0) return Home;
    var first = args[0].Trim();
    if (Regex.IsMatch(first, @"^\d{2}$")) return Home + "?room=" + Uri.EscapeDataString(first);
    if (Uri.TryCreate(first, UriKind.Absolute, out var uri) &&
        uri.Scheme is "https" or "http" &&
        (uri.Host.Equals("d1.lunarlab.uk", StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith(".dtam.pages.dev", StringComparison.OrdinalIgnoreCase)))
        return uri.ToString();
    return Home;
}

try
{
    Process.Start(new ProcessStartInfo
    {
        FileName = ResolveEdge(),
        UseShellExecute = true,
        Arguments = $"--app=\"{BuildUrl(args)}\" --start-maximized --no-first-run"
    });
}
catch (Exception ex)
{
    MessageBoxW(0, "无法启动 Microsoft Edge。\n\n" + ex.Message + "\n\n也可以直接访问 " + Home, "DTAM", 0x10);
}
