package uk.lunarlab.dtam;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String HOME = "https://d1.lunarlab.uk/";
    private static final String UPDATE_MANIFEST = "https://update.lunarlab.uk/latest.json";
    private static final String BOOTSTRAP_GAME_HOST = "d1.lunarlab.uk";
    private static final String TRUSTED_UPDATE_HOST = "update.lunarlab.uk";
    private static final String INSTALL_ACTION = "uk.lunarlab.dtam.INSTALL_RESULT";
    private static final int REQ_AUDIO = 41;
    private static final int REQ_UNKNOWN_SOURCES = 42;
    private static final long MAX_UPDATE_BYTES = 180L * 1024L * 1024L;

    private final ExecutorService background = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView webView;
    private PermissionRequest pendingAudioRequest;
    private File pendingInstall;
    private boolean receiverRegistered;
    private boolean updateChecked;
    private boolean launchMigrationPending;
    private String trustedGameOrigin;

    private final BroadcastReceiver installReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = null;
                if (Build.VERSION.SDK_INT >= 33) {
                    confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
                } else {
                    Object value = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (value instanceof Intent) confirm = (Intent) value;
                }
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(confirm);
                }
                return;
            }
            if (status == PackageInstaller.STATUS_SUCCESS) {
                toast("DTAM 更新已安装");
            } else {
                String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                toast("更新安装未完成" + (message == null ? "" : "：" + message));
            }
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        registerInstallReceiver();
        createWebView();
        loadGameUrl(resolveLaunchUrl(getIntent()));
        main.postDelayed(this::checkForUpdate, 900);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (webView != null) loadGameUrl(resolveLaunchUrl(intent));
    }

    private void createWebView() {
        webView = new WebView(this);
        setContentView(webView);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " DTAM-Android/3.0.2");

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return routeUrl(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (launchMigrationPending && isHttpsUri(uri)) {
                    trustedGameOrigin = originOf(uri);
                    launchMigrationPending = false;
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return routeUrl(Uri.parse(url));
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingAudioRequest == request) pendingAudioRequest = null;
            }
        });
    }

    private void loadGameUrl(String url) {
        launchMigrationPending = true;
        trustedGameOrigin = null;
        webView.loadUrl(url);
    }

    private boolean routeUrl(Uri uri) {
        if (!isHttpsUri(uri)) return true;
        String origin = originOf(uri);
        if (launchMigrationPending || (origin != null && origin.equals(trustedGameOrigin))) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {}
        return true;
    }

    private void handleWebPermission(PermissionRequest request) {
        Uri origin = request.getOrigin();
        String requestOrigin = originOf(origin);
        String currentOrigin = webView == null || webView.getUrl() == null ? null : originOf(Uri.parse(webView.getUrl()));
        boolean trusted = requestOrigin != null && (requestOrigin.equals(trustedGameOrigin)
                || (launchMigrationPending && requestOrigin.equals(currentOrigin)));
        if (!trusted) {
            request.deny();
            return;
        }
        boolean audio = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audio = true;
        }
        if (!audio) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            pendingAudioRequest = request;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_AUDIO) return;
        PermissionRequest request = pendingAudioRequest;
        pendingAudioRequest = null;
        if (request == null) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            request.deny();
            toast("需要麦克风权限才能使用语音");
        }
    }

    private String resolveLaunchUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data != null) {
            if (isBootstrapGameUri(data)) return data.toString();
            if ("dtam".equalsIgnoreCase(data.getScheme()) && "join".equalsIgnoreCase(data.getHost())) {
                String room = data.getQueryParameter("room");
                if ((room == null || !room.matches("\\d{2}")) && data.getPathSegments().size() > 0) {
                    room = data.getPathSegments().get(0);
                }
                if (room != null && room.matches("\\d{2}")) return HOME + "?room=" + room;
            }
        }
        return HOME;
    }

    private static boolean isBootstrapGameUri(Uri uri) {
        return isHttpsUri(uri) && BOOTSTRAP_GAME_HOST.equalsIgnoreCase(uri.getHost());
    }

    private static boolean isHttpsUri(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null;
    }

    private static String originOf(Uri uri) {
        if (!isHttpsUri(uri)) return null;
        int port = uri.getPort();
        return "https://" + uri.getHost().toLowerCase(Locale.ROOT) + (port > 0 && port != 443 ? ":" + port : "");
    }

    private void checkForUpdate() {
        if (updateChecked || isFinishing()) return;
        updateChecked = true;
        background.execute(() -> {
            try {
                JSONObject root = new JSONObject(fetchText(UPDATE_MANIFEST));
                JSONObject android = root.optJSONObject("android");
                if (android == null) return;
                long latestCode = android.optLong("versionCode", 0);
                String latestName = android.optString("version", "");
                String url = android.optString("url", "");
                String sha256 = android.optString("sha256", "").toLowerCase(Locale.ROOT);
                long size = android.optLong("size", 0);
                if (latestCode <= currentVersionCode()) return;
                if (!isTrustedUpdateUrl(url) || !sha256.matches("[0-9a-f]{64}")) return;
                if (size > MAX_UPDATE_BYTES) throw new IllegalStateException("update too large");
                main.post(() -> toast("发现 DTAM " + latestName + "，正在安全下载更新"));
                File apk = downloadUpdate(url, sha256, latestCode, size);
                main.post(() -> requestInstall(apk));
            } catch (Exception e) {
                // Fail open: update checks must never block game startup.
            }
        });
    }

    private String fetchText(String value) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(value).openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(4000);
        c.setUseCaches(false);
        c.setRequestProperty("Cache-Control", "no-cache");
        c.setRequestProperty("User-Agent", "DTAM-Android/3.0.2");
        try (InputStream in = new BufferedInputStream(c.getInputStream())) {
            if (c.getResponseCode() / 100 != 2) throw new IllegalStateException("HTTP " + c.getResponseCode());
            byte[] buf = new byte[8192];
            int n;
            StringBuilder text = new StringBuilder();
            while ((n = in.read(buf)) > 0) {
                text.append(new String(buf, 0, n, "UTF-8"));
                if (text.length() > 256 * 1024) throw new IllegalStateException("manifest too large");
            }
            return text.toString();
        } finally {
            c.disconnect();
        }
    }

    private File downloadUpdate(String value, String expectedSha, long versionCode, long expectedSize) throws Exception {
        URL parsed = new URL(value);
        if (!"https".equalsIgnoreCase(parsed.getProtocol()) || !TRUSTED_UPDATE_HOST.equalsIgnoreCase(parsed.getHost())) throw new SecurityException("untrusted update host");
        File target = new File(getCacheDir(), "dtam-update-" + versionCode + ".apk");
        HttpURLConnection c = (HttpURLConnection) parsed.openConnection();
        c.setConnectTimeout(4000);
        c.setReadTimeout(20000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "DTAM-Android/3.0.2");
        long total = 0;
        try (InputStream in = new BufferedInputStream(c.getInputStream()); OutputStream out = new FileOutputStream(target)) {
            if (c.getResponseCode() / 100 != 2) throw new IllegalStateException("HTTP " + c.getResponseCode());
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_UPDATE_BYTES) throw new IllegalStateException("update too large");
                out.write(buf, 0, n);
            }
        } finally {
            c.disconnect();
        }
        if (expectedSize > 0 && total != expectedSize) throw new SecurityException("update size mismatch");
        String actual = sha256(target);
        if (!actual.equalsIgnoreCase(expectedSha)) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw new SecurityException("update digest mismatch");
        }
        return target;
    }

    private void requestInstall(File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            pendingInstall = apk;
            toast("更新已验证；请允许 DTAM 安装更新，然后返回");
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
            startActivityForResult(settings, REQ_UNKNOWN_SOURCES);
            return;
        }
        installVerifiedApk(apk);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_UNKNOWN_SOURCES && pendingInstall != null) {
            File apk = pendingInstall;
            pendingInstall = null;
            if (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls()) installVerifiedApk(apk);
            else toast("未获得安装更新权限；游戏仍可继续使用");
        }
    }

    private void installVerifiedApk(File apk) {
        try {
            PackageInstaller installer = getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            if (Build.VERSION.SDK_INT >= 26) params.setAppPackageName(getPackageName());
            int sessionId = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(sessionId);
                 InputStream in = new FileInputStream(apk);
                 OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
                Intent result = new Intent(INSTALL_ACTION).setPackage(getPackageName());
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
                PendingIntent pending = PendingIntent.getBroadcast(this, sessionId, result, flags);
                session.commit(pending.getIntentSender());
            }
        } catch (Exception e) {
            toast("无法启动系统更新安装器：" + e.getMessage());
        }
    }

    private void registerInstallReceiver() {
        IntentFilter filter = new IntentFilter(INSTALL_ACTION);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(installReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(installReceiver, filter);
        receiverRegistered = true;
    }

    private long currentVersionCode() throws Exception {
        PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private static boolean isTrustedUpdateUrl(String value) {
        try {
            URL url = new URL(value);
            return "https".equalsIgnoreCase(url.getProtocol()) && TRUSTED_UPDATE_HOST.equalsIgnoreCase(url.getHost());
        } catch (Exception e) {
            return false;
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder out = new StringBuilder(64);
        for (byte b : md.digest()) out.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return out.toString();
    }

    private void toast(String text) {
        if (Looper.myLooper() == Looper.getMainLooper()) Toast.makeText(this, text, Toast.LENGTH_LONG).show();
        else main.post(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show());
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (receiverRegistered) {
            try { unregisterReceiver(installReceiver); } catch (Exception ignored) {}
        }
        background.shutdownNow();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
