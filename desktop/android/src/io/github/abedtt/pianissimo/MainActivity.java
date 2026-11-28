package io.github.abedtt.pianissimo;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Pianissimo for Android: the editor, built by Vite, runs from inside the APK, with no server and
 * no network. The pages are served from https://appassets.androidplatform.net/ (Android's address
 * for an app's own files), so the browser treats them as a secure website: IndexedDB keeps My
 * scores, audio and WebAssembly work. Like the desktop launchers it answers /__desktop.json (the
 * app's version, so it can tell you about new releases) and /server/* (not connected).
 *
 * What a browser does and a WebView does not is done here: saving exported files (into Downloads),
 * printing (Android's print dialog, which also saves PDFs), choosing files, opening links in the
 * browser, the Back button, and the piano sound (its samples are in the APK; other instruments are
 * kept on the phone after they first play).
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    /** Where the instrument samples come from (src/audio/player.ts, sounds.ts). */
    static final String[] SAMPLE_HOSTS = { "tonejs.github.io", "gleitz.github.io" };
    static final int PICK_FILE = 1;
    static final int ASK_MIC = 2;

    WebView web;
    FrameLayout root;
    ValueCallback<Uri[]> picking;
    PermissionRequest micRequest;
    String version = "";

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        try {
            version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            version = "";
        }
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        fitSystemBars();
        setBars(night() ? "#12151d" : "#ffffff", night());

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " PianissimoAndroid/" + version);

        web.addJavascriptInterface(new Bridge(), "PianissimoAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, agent, disposition, mime, length) -> openOutside(Uri.parse(url)));
        // the site's service worker is for websites; here every file is already on the phone
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return text(404, "text/plain", "Not used in the app");
            }
        });

        // Android 13+: the Back gesture comes here (apps targeting Android 16 no longer get onBackPressed)
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(ORIGIN + "/app.html");
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        back();
    }

    /** First close what is open in the page (a dialog, a menu), then go back a page, then leave. */
    void back() {
        web.evaluateJavascript("window.__pianissimoBack ? window.__pianissimoBack() : false", (handled) -> {
            if ("true".equals(handled)) return;
            if (web.canGoBack()) web.goBack();
            else finish();
        });
    }

    boolean night() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    /** Android 15+ draws apps under the status and navigation bars (and the keyboard): keep the page clear of them. */
    @SuppressWarnings("deprecation")
    void fitSystemBars() {
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                l = bars.left;
                t = bars.top;
                r = bars.right;
                b = Math.max(bars.bottom, ime.bottom);
            } else {
                l = insets.getSystemWindowInsetLeft();
                t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight();
                b = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return insets;
        });
    }

    /** The strip behind the status bar takes the colour of the page's top bar, with icons that stay readable. */
    @SuppressWarnings("deprecation")
    void setBars(String color, boolean dark) {
        int c;
        try {
            c = Color.parseColor(color);
        } catch (IllegalArgumentException e) {
            return;
        }
        root.setBackgroundColor(c);
        Window w = getWindow();
        if (Build.VERSION.SDK_INT < 35) {
            w.setStatusBarColor(c);
            w.setNavigationBarColor(c);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController ctl = w.getInsetsController();
            if (ctl != null) {
                int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                ctl.setSystemBarsAppearance(dark ? 0 : light, light);
            }
        } else {
            View d = w.getDecorView();
            int flags = d.getSystemUiVisibility();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            d.setSystemUiVisibility(dark ? flags & ~light : flags | light);
        }
    }

    void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open " + uri, Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != ASK_MIC || micRequest == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) micRequest.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        else micRequest.deny();
        micRequest = null;
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_FILE || picking == null) return;
        Uri[] chosen = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                chosen = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < chosen.length; i++) chosen[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                chosen = new Uri[] { data.getData() };
            }
        }
        picking.onReceiveValue(chosen);
        picking = null;
    }

    // ------------------------------------------------------------------ serving the app

    static final Map<String, String> TYPES = new HashMap<>();
    static {
        String[][] t = {
            { "html", "text/html" }, { "js", "text/javascript" }, { "mjs", "text/javascript" }, { "css", "text/css" },
            { "json", "application/json" }, { "webmanifest", "application/manifest+json" }, { "svg", "image/svg+xml" },
            { "png", "image/png" }, { "jpg", "image/jpeg" }, { "jpeg", "image/jpeg" }, { "gif", "image/gif" }, { "webp", "image/webp" },
            { "ico", "image/x-icon" }, { "woff2", "font/woff2" }, { "woff", "font/woff" }, { "ttf", "font/ttf" }, { "otf", "font/otf" },
            { "wasm", "application/wasm" }, { "mp3", "audio/mpeg" }, { "ogg", "audio/ogg" }, { "wav", "audio/wav" },
            { "xml", "application/xml" }, { "musicxml", "application/vnd.recordare.musicxml+xml" }, { "txt", "text/plain" },
            { "bin", "application/octet-stream" }, { "mid", "audio/midi" }, { "sf2", "application/octet-stream" },
        };
        for (String[] p : t) TYPES.put(p[0], p[1]);
    }

    static String typeOf(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.ROOT);
        String t = TYPES.get(ext);
        if (t == null) t = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return t == null ? "application/octet-stream" : t;
    }

    static WebResourceResponse respond(int status, String type, InputStream body, Map<String, String> extra) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        h.put("X-Content-Type-Options", "nosniff");
        if (extra != null) h.putAll(extra);
        String reason = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 503 ? "Service Unavailable" : "Error";
        boolean isText = type.startsWith("text/") || type.endsWith("json") || type.endsWith("xml") || type.equals("text/javascript");
        return new WebResourceResponse(type, isText ? "utf-8" : null, status, reason, h, body);
    }

    static WebResourceResponse text(int status, String type, String body) {
        return respond(status, type, new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)), null);
    }

    static String json(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    WebResourceResponse serve(WebResourceRequest req) {
        Uri url = req.getUrl();
        String host = url.getHost();
        if (host == null) return null;
        for (String h : SAMPLE_HOSTS) if (host.equals(h)) return sample(url);
        if (!host.equals(HOST)) return null;
        String path = url.getPath() == null ? "/" : url.getPath();
        if (path.equals("/__desktop.json")) {
            // the desktop launchers' answer: this is the app (its version), and it cannot scan or install updates itself
            return text(200, "application/json", "{\"platform\":\"android\",\"version\":" + json(version) + ",\"canInstall\":false,\"scan\":false}");
        }
        if (path.startsWith("/server/")) {
            return text(503, "application/json", "{\"error\":" + json(
                "The Android app works on its own, without an online server, so signing in, sharing and the online library are off. Your scores are saved on this phone.") + "}");
        }
        if (path.equals("/__android.js")) return asset("android.js");
        if (path.startsWith("/__")) return text(404, "text/plain", "Not found");
        if (path.equals("/sw.js")) return text(404, "text/plain", "Not used in the app");
        if (path.endsWith("/")) path += "index.html";
        String rel = "www" + Uri.decode(path);
        if (rel.contains("/../") || rel.contains("\\")) return text(404, "text/plain", "Not found");
        if (rel.endsWith(".html")) return page(rel);
        return asset(rel);
    }

    WebResourceResponse asset(String rel) {
        try {
            return respond(200, typeOf(rel), getAssets().open(rel), null);
        } catch (IOException e) {
            return text(404, "text/plain", "Not found");
        }
    }

    /** An HTML page, with the app's helpers (android.js) loaded before the page's own scripts. */
    WebResourceResponse page(String rel) {
        try (InputStream in = getAssets().open(rel)) {
            String html = new String(readAll(in), StandardCharsets.UTF_8);
            int head = html.indexOf("<head>");
            String tag = "<script src=\"/__android.js\"></script>";
            html = head >= 0 ? html.substring(0, head + 6) + tag + html.substring(head + 6) : tag + html;
            return text(200, "text/html", html);
        } catch (IOException e) {
            return text(404, "text/plain", "Not found");
        }
    }

    /**
     * Instrument samples: the piano's are in the APK; the others are downloaded the first time they
     * play and kept, so every sound heard once also plays offline. No connection: the editor falls
     * back to its own synthesizer, as on the website.
     */
    WebResourceResponse sample(Uri url) {
        String path = url.getPath();
        if (path == null || path.contains("..") || !path.endsWith(".mp3")) return null;
        Map<String, String> cors = new HashMap<>();
        cors.put("Access-Control-Allow-Origin", "*");
        String rel = "samples/" + url.getHost() + path;
        try {
            return respond(200, "audio/mpeg", getAssets().open(rel), cors);
        } catch (IOException notBundled) {
            // not in the APK
        }
        File kept = new File(getFilesDir(), rel);
        try {
            if (!kept.isFile()) {
                HttpURLConnection c = (HttpURLConnection) new URL(url.toString()).openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(20000);
                if (c.getResponseCode() != 200) return null;
                byte[] data;
                try (InputStream in = c.getInputStream()) {
                    data = readAll(in);
                }
                File dir = kept.getParentFile();
                if (dir != null && !dir.isDirectory() && !dir.mkdirs()) return respond(200, "audio/mpeg", new ByteArrayInputStream(data), cors);
                File part = new File(kept.getPath() + ".part");
                try (OutputStream out = new FileOutputStream(part)) {
                    out.write(data);
                }
                if (!part.renameTo(kept)) return respond(200, "audio/mpeg", new ByteArrayInputStream(data), cors);
            }
            return respond(200, "audio/mpeg", new FileInputStream(kept), cors);
        } catch (IOException offline) {
            return null;
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        for (int n; (n = in.read(buf)) > 0;) out.write(buf, 0, n);
        return out.toByteArray();
    }

    class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return serve(request);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String scheme = url.getScheme() == null ? "" : url.getScheme();
            if (HOST.equals(url.getHost()) || scheme.equals("blob") || scheme.equals("data") || scheme.equals("about")) return false;
            // the release page, Audiveris, mail links…: the phone's browser or mail app
            openOutside(url);
            return true;
        }
    }

    class Chrome extends WebChromeClient {
        /** The microphone (tuner, playing into the score): Android asks you once, then the page gets it. */
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            boolean audio = false;
            for (String r : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audio = true;
            if (!audio || !HOST.equals(request.getOrigin().getHost())) {
                request.deny();
                return;
            }
            String[] mic = { PermissionRequest.RESOURCE_AUDIO_CAPTURE };
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                request.grant(mic);
                return;
            }
            if (micRequest != null) micRequest.deny();
            micRequest = request;
            requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, ASK_MIC);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (picking != null) picking.onReceiveValue(null);
            picking = callback;
            Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            // MusicXML, MIDI, recordings…: file types the phone may not know, so every file can be chosen
            pick.setType("*/*");
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(pick, PICK_FILE);
            } catch (ActivityNotFoundException e) {
                picking = null;
                return false;
            }
            return true;
        }
    }

    /** What the page's helpers (android.js) call. */
    class Bridge {
        /** Save an exported file (base64) into Downloads/Pianissimo. Returns where, or an error message starting with "!". */
        @JavascriptInterface
        public String save(String name, String type, String base64) {
            String clean = name.replaceAll("[\\\\/:*?\"<>|\\u0000-\\u001f]+", "").trim();
            if (clean.isEmpty()) clean = "score";
            final String file = clean;
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                ContentResolver cr = getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, file);
                if (type != null && !type.isEmpty()) v.put(MediaStore.MediaColumns.MIME_TYPE, type.split(";")[0]);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Pianissimo");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri item = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (item == null) throw new IOException("Android did not let Pianissimo save into Downloads");
                try (OutputStream out = cr.openOutputStream(item)) {
                    if (out == null) throw new IOException("Android did not let Pianissimo save into Downloads");
                    out.write(data);
                }
                v.clear();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(item, v, null, null);
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Saved in Downloads/Pianissimo: " + file, Toast.LENGTH_LONG).show());
                return "Downloads/Pianissimo/" + file;
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Could not save " + file + ": " + e.getMessage(), Toast.LENGTH_LONG).show());
                return "!" + e.getMessage();
            }
        }

        /** Print the page as it is laid out for printing (Android's dialog can also save it as a PDF). */
        @JavascriptInterface
        public void print(String title) {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                String job = title == null || title.trim().isEmpty() ? "Pianissimo" : title.trim();
                pm.print(job, web.createPrintDocumentAdapter(job), new PrintAttributes.Builder().build());
            });
        }

        /** The page's top bar colour and theme, for the strip behind the status bar. */
        @JavascriptInterface
        public void bars(String color, boolean dark) {
            runOnUiThread(() -> setBars(color, dark));
        }

        @JavascriptInterface
        public String version() {
            return version;
        }
    }
}
