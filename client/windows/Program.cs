using System.Diagnostics;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

const string Home = "https://d1.lunarlab.uk/";
const string UpdateManifest = "https://update.lunarlab.uk/latest.json";
const string UpdateHost = "update.lunarlab.uk";
const string CurrentVersion = "3.0.2";
const long MaxUpdateBytes = 180L * 1024L * 1024L;
const long MaxChunkBytes = 24L * 1024L * 1024L;

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
        uri.Scheme == Uri.UriSchemeHttps &&
        (uri.Host.Equals("d1.lunarlab.uk", StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith(".dtam.pages.dev", StringComparison.OrdinalIgnoreCase)))
        return uri.ToString();
    return Home;
}

static void LaunchGame(string[] args)
{
    Process.Start(new ProcessStartInfo
    {
        FileName = ResolveEdge(),
        UseShellExecute = true,
        Arguments = $"--app=\"{BuildUrl(args)}\" --start-maximized --no-first-run"
    });
}

static bool TrustedUpdateUri(string value, out Uri? uri)
{
    if (Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == Uri.UriSchemeHttps && uri.Host.Equals(UpdateHost, StringComparison.OrdinalIgnoreCase)) return true;
    uri = null;
    return false;
}

static bool IsNewer(string candidate)
{
    return Version.TryParse(candidate, out var next) && Version.TryParse(CurrentVersion, out var current) && next > current;
}

static HttpClient CreateUpdateClient(TimeSpan timeout)
{
    var client = new HttpClient { Timeout = timeout };
    client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("DTAM-Windows", CurrentVersion));
    client.DefaultRequestHeaders.CacheControl = new CacheControlHeaderValue { NoCache = true };
    return client;
}

static async Task<WindowsUpdate?> FetchWindowsUpdateAsync(HttpClient client)
{
    using var response = await client.GetAsync(UpdateManifest, HttpCompletionOption.ResponseContentRead);
    if (!response.IsSuccessStatusCode) return null;
    var json = await response.Content.ReadAsStringAsync();
    if (json.Length > 256 * 1024) return null;
    using var doc = JsonDocument.Parse(json);
    if (!doc.RootElement.TryGetProperty("windows", out var win)) return null;

    var version = win.TryGetProperty("version", out var v) ? v.GetString() ?? "" : "";
    var url = win.TryGetProperty("url", out var u) ? u.GetString() ?? "" : "";
    var sha = win.TryGetProperty("sha256", out var h) ? (h.GetString() ?? "").ToLowerInvariant() : "";
    var size = win.TryGetProperty("size", out var s) && s.TryGetInt64(out var n) ? n : 0;
    if (!Version.TryParse(version, out _) || !Regex.IsMatch(sha, "^[0-9a-f]{64}$") || size <= 0 || size > MaxUpdateBytes || !TrustedUpdateUri(url, out _)) return null;

    var chunks = new List<UpdateChunk>();
    if (win.TryGetProperty("chunks", out var chunkArray) && chunkArray.ValueKind == JsonValueKind.Array)
    {
        foreach (var chunk in chunkArray.EnumerateArray())
        {
            var chunkUrl = chunk.TryGetProperty("url", out var cu) ? cu.GetString() ?? "" : "";
            var chunkSha = chunk.TryGetProperty("sha256", out var ch) ? (ch.GetString() ?? "").ToLowerInvariant() : "";
            var chunkSize = chunk.TryGetProperty("size", out var cs) && cs.TryGetInt64(out var cn) ? cn : 0;
            if (!TrustedUpdateUri(chunkUrl, out _) || !Regex.IsMatch(chunkSha, "^[0-9a-f]{64}$") || chunkSize <= 0 || chunkSize > MaxChunkBytes) return null;
            chunks.Add(new UpdateChunk(chunkUrl, chunkSha, chunkSize));
        }
    }
    if (chunks.Count > 0 && chunks.Sum(c => c.Size) != size) return null;
    return new WindowsUpdate(version, url, sha, size, chunks);
}

static async Task CheckAndLaunchUpdaterAsync()
{
    try
    {
        using var client = CreateUpdateClient(TimeSpan.FromSeconds(4));
        var update = await FetchWindowsUpdateAsync(client);
        if (update is null || !IsNewer(update.Version)) return;
        var exe = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe)) return;
        var psi = new ProcessStartInfo
        {
            FileName = exe,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        psi.ArgumentList.Add("--update-background");
        psi.ArgumentList.Add(update.Version);
        psi.ArgumentList.Add(update.Sha256);
        psi.ArgumentList.Add(update.Size.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Process.Start(psi);
    }
    catch
    {
        // The update service must never stop the web game.
    }
}

static async Task<bool> DownloadSegmentAsync(HttpClient client, UpdateChunk chunk, FileStream output, IncrementalHash wholeHash)
{
    if (!TrustedUpdateUri(chunk.Url, out var uri) || uri is null) return false;
    using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead);
    if (!response.IsSuccessStatusCode) return false;
    if (response.Content.Headers.ContentLength is long length && length != chunk.Size) return false;
    await using var input = await response.Content.ReadAsStreamAsync();
    using var chunkHash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    var buffer = new byte[64 * 1024];
    long total = 0;
    int read;
    while ((read = await input.ReadAsync(buffer)) > 0)
    {
        total += read;
        if (total > chunk.Size) return false;
        chunkHash.AppendData(buffer, 0, read);
        wholeHash.AppendData(buffer, 0, read);
        await output.WriteAsync(buffer.AsMemory(0, read));
    }
    if (total != chunk.Size) return false;
    var digest = Convert.ToHexString(chunkHash.GetHashAndReset()).ToLowerInvariant();
    return digest.Equals(chunk.Sha256, StringComparison.OrdinalIgnoreCase);
}

static async Task<bool> DownloadUpdateAsync(HttpClient client, WindowsUpdate update, string target)
{
    await using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
    using var wholeHash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    long total = 0;

    if (update.Chunks.Count > 0)
    {
        foreach (var chunk in update.Chunks)
        {
            if (!await DownloadSegmentAsync(client, chunk, output, wholeHash)) return false;
            total += chunk.Size;
        }
    }
    else
    {
        // Backward-compatible single-object path for older manifests.
        var whole = new UpdateChunk(update.Url, update.Sha256, update.Size);
        if (!await DownloadSegmentAsync(client, whole, output, wholeHash)) return false;
        total = update.Size;
    }

    await output.FlushAsync();
    if (total != update.Size || output.Length != update.Size) return false;
    var digest = Convert.ToHexString(wholeHash.GetHashAndReset()).ToLowerInvariant();
    return digest.Equals(update.Sha256, StringComparison.OrdinalIgnoreCase);
}

static async Task RunBackgroundUpdateAsync(string[] args)
{
    if (args.Length != 4 || args[0] != "--update-background") return;
    var expectedVersion = args[1];
    var expectedSha = args[2].ToLowerInvariant();
    if (!long.TryParse(args[3], out var expectedSize) || expectedSize <= 0 || expectedSize > MaxUpdateBytes || !Regex.IsMatch(expectedSha, "^[0-9a-f]{64}$")) return;

    using var mutex = new Mutex(false, "Local\\DTAM-Updater-" + Regex.Replace(expectedVersion, "[^0-9A-Za-z_.-]", "_"));
    if (!mutex.WaitOne(0)) return;
    try
    {
        using var client = CreateUpdateClient(TimeSpan.FromMinutes(3));
        var update = await FetchWindowsUpdateAsync(client);
        if (update is null || update.Version != expectedVersion || update.Sha256 != expectedSha || update.Size != expectedSize) return;

        var currentExe = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(currentExe) || !File.Exists(currentExe)) return;
        var updateDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DTAM", "updates");
        Directory.CreateDirectory(updateDir);
        var nextExe = Path.Combine(updateDir, $"DTAM-{update.Version}-{Guid.NewGuid():N}.exe");
        try
        {
            if (!await DownloadUpdateAsync(client, update, nextExe))
            {
                if (File.Exists(nextExe)) File.Delete(nextExe);
                return;
            }
        }
        catch
        {
            if (File.Exists(nextExe)) File.Delete(nextExe);
            return;
        }

        static string PsQuote(string value) => "'" + value.Replace("'", "''") + "'";
        var script = "$ErrorActionPreference='SilentlyContinue';" +
                     $"Wait-Process -Id {Environment.ProcessId};" +
                     "Start-Sleep -Milliseconds 150;" +
                     $"Move-Item -LiteralPath {PsQuote(nextExe)} -Destination {PsQuote(currentExe)} -Force;";
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        var helper = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        helper.ArgumentList.Add("-NoProfile");
        helper.ArgumentList.Add("-NonInteractive");
        helper.ArgumentList.Add("-WindowStyle");
        helper.ArgumentList.Add("Hidden");
        helper.ArgumentList.Add("-EncodedCommand");
        helper.ArgumentList.Add(encoded);
        Process.Start(helper);
    }
    catch
    {
        // Leave the current executable untouched on every updater failure.
    }
    finally
    {
        try { mutex.ReleaseMutex(); } catch { }
    }
}

if (args.Length > 0 && args[0] == "--update-background")
{
    await RunBackgroundUpdateAsync(args);
    return;
}

try
{
    LaunchGame(args);
}
catch (Exception ex)
{
    MessageBoxW(0, "无法启动 Microsoft Edge。\n\n" + ex.Message + "\n\n也可以直接访问 " + Home, "DTAM", 0x10);
}

await CheckAndLaunchUpdaterAsync();

internal sealed record UpdateChunk(string Url, string Sha256, long Size);
internal sealed record WindowsUpdate(string Version, string Url, string Sha256, long Size, IReadOnlyList<UpdateChunk> Chunks);
