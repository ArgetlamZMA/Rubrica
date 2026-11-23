package com.zma.rubrica;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanner;
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Funciones nativas de Rúbrica para Android:
 * abrir / guardar con el selector de Android (incluye Drive y OneDrive), compartir, imprimir,
 * archivos recibidos desde otras apps, escáner de documentos y OCR de ML Kit (sin conexión).
 */
@CapacitorPlugin(name = "Rubrica")
public class RubricaPlugin extends Plugin {

    private ActivityResultLauncher<IntentSenderRequest> scanLauncher;
    private PluginCall pendingScan;
    private final List<JSObject> launchFiles = new ArrayList<>();
    private TextRecognizer recognizer;

    @Override
    public void load() {
        scanLauncher = getActivity().registerForActivityResult(
                new ActivityResultContracts.StartIntentSenderForResult(), this::onScanResult);
        collectIntent(getActivity().getIntent(), false);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        collectIntent(intent, true);
    }

    // ---------- Archivos recibidos («Abrir con», «Compartir») ----------

    private void collectIntent(Intent intent, boolean notify) {
        if (intent == null) return;
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        if (uris.isEmpty()) return;
        intent.setAction(Intent.ACTION_MAIN); // evita reabrir al recrear la actividad
        new Thread(() -> {
            JSArray arr = new JSArray();
            for (Uri u : uris) {
                try {
                    JSObject f = fileInfo(u, true);
                    synchronized (launchFiles) { if (!notify) launchFiles.add(f); }
                    arr.put(f);
                } catch (Exception e) {
                    android.util.Log.e("Rubrica", "No se pudo leer " + u, e);
                }
            }
            if (notify) {
                JSObject ev = new JSObject();
                ev.put("files", arr);
                notifyListeners("filesReceived", ev, true);
            }
        }).start();
    }

    @PluginMethod
    public void getLaunchFiles(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (launchFiles) {
            for (JSObject f : launchFiles) arr.put(f);
            launchFiles.clear();
        }
        JSObject r = new JSObject();
        r.put("files", arr);
        call.resolve(r);
    }

    // ---------- Abrir / leer / escribir ----------

    @PluginMethod
    public void openDocument(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        String[] mimes = call.getBoolean("imagesOnly", false)
                ? new String[]{"image/*"}
                : new String[]{"application/pdf", "image/*"};
        i.putExtra(Intent.EXTRA_MIME_TYPES, mimes);
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, call.getBoolean("multiple", true));
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "onOpenResult");
    }

    @ActivityCallback
    private void onOpenResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject r = new JSObject();
            r.put("files", new JSArray());
            call.resolve(r);
            return;
        }
        Intent data = result.getData();
        List<Uri> uris = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip != null) for (int k = 0; k < clip.getItemCount(); k++) uris.add(clip.getItemAt(k).getUri());
        else if (data.getData() != null) uris.add(data.getData());
        new Thread(() -> {
            try {
                JSArray arr = new JSArray();
                for (Uri u : uris) {
                    persist(u);
                    arr.put(fileInfo(u, true));
                }
                JSObject r = new JSObject();
                r.put("files", arr);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("No se pudo abrir el archivo: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void read(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) { call.reject("Falta uri"); return; }
        try {
            call.resolve(fileInfo(Uri.parse(uri), true));
        } catch (Exception e) {
            call.reject("No se pudo leer el archivo (puede haberse movido o borrado): " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String uri = call.getString("uri");
        String data = call.getString("data");
        if (uri == null || data == null) { call.reject("Faltan datos"); return; }
        try {
            writeTo(Uri.parse(uri), Base64.decode(data, Base64.DEFAULT));
            JSObject r = new JSObject();
            r.put("uri", uri);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No se pudo guardar en el archivo original: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void saveAs(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/pdf"));
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "documento.pdf"));
        startActivityForResult(call, i, "onSaveAsResult");
    }

    @ActivityCallback
    private void onSaveAsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        Uri uri = result.getData().getData();
        new Thread(() -> {
            try {
                persist(uri);
                writeTo(uri, Base64.decode(call.getString("data", ""), Base64.DEFAULT));
                JSObject r = new JSObject();
                r.put("uri", uri.toString());
                r.put("name", displayName(uri));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("No se pudo guardar: " + e.getMessage(), e);
            }
        }).start();
    }

    // ---------- Compartir e imprimir ----------

    @PluginMethod
    public void share(PluginCall call) {
        try {
            String name = sanitize(call.getString("name", "documento.pdf"));
            File dir = new File(getContext().getCacheDir(), "compartir");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File f = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(call.getString("mime", "application/pdf"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, name);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Compartir " + name);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo compartir: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void print(PluginCall call) {
        final byte[] pdf = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        final String name = call.getString("name", "documento.pdf");
        getActivity().runOnUiThread(() -> {
            PrintManager pm = (PrintManager) getActivity().getSystemService(android.content.Context.PRINT_SERVICE);
            pm.print(name, new PrintDocumentAdapter() {
                @Override
                public void onLayout(PrintAttributes oldA, PrintAttributes newA, CancellationSignal cancel, LayoutResultCallback cb, Bundle extras) {
                    if (cancel.isCanceled()) { cb.onLayoutCancelled(); return; }
                    cb.onLayoutFinished(new PrintDocumentInfo.Builder(name)
                            .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true);
                }

                @Override
                public void onWrite(PageRange[] pages, ParcelFileDescriptor dest, CancellationSignal cancel, WriteResultCallback cb) {
                    try (OutputStream out = new FileOutputStream(dest.getFileDescriptor())) {
                        out.write(pdf);
                        cb.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
                    } catch (Exception e) {
                        cb.onWriteFailed(e.getMessage());
                    }
                }
            }, null);
            call.resolve();
        });
    }

    // ---------- Escáner de documentos (ML Kit) ----------

    @PluginMethod
    public void scan(PluginCall call) {
        GmsDocumentScannerOptions options = new GmsDocumentScannerOptions.Builder()
                .setGalleryImportAllowed(call.getBoolean("gallery", true))
                .setPageLimit(call.getInt("pageLimit", 50))
                .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
                .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
                .build();
        GmsDocumentScanner scanner = GmsDocumentScanning.getClient(options);
        pendingScan = call;
        scanner.getStartScanIntent(getActivity())
                .addOnSuccessListener(sender -> scanLauncher.launch(new IntentSenderRequest.Builder(sender).build()))
                .addOnFailureListener(e -> {
                    pendingScan = null;
                    call.reject("El escáner de Google no está disponible en este dispositivo: " + e.getMessage(), e);
                });
    }

    private void onScanResult(ActivityResult result) {
        PluginCall call = pendingScan;
        pendingScan = null;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            JSObject r = new JSObject();
            r.put("pages", new JSArray());
            call.resolve(r);
            return;
        }
        GmsDocumentScanningResult res = GmsDocumentScanningResult.fromActivityResultIntent(result.getData());
        new Thread(() -> {
            try {
                JSArray pages = new JSArray();
                if (res != null && res.getPages() != null) {
                    for (GmsDocumentScanningResult.Page p : res.getPages()) {
                        byte[] bytes = readAll(p.getImageUri());
                        BitmapFactory.Options o = new BitmapFactory.Options();
                        o.inJustDecodeBounds = true;
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o);
                        JSObject page = new JSObject();
                        page.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                        page.put("width", o.outWidth);
                        page.put("height", o.outHeight);
                        pages.put(page);
                    }
                }
                JSObject r = new JSObject();
                r.put("pages", pages);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("No se pudieron leer las páginas escaneadas: " + e.getMessage(), e);
            }
        }).start();
    }

    // ---------- OCR (ML Kit, sin conexión) ----------

    @PluginMethod
    public void ocr(PluginCall call) {
        try {
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bmp == null) { call.reject("Imagen no válida"); return; }
            if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            final int w = bmp.getWidth(), h = bmp.getHeight();
            recognizer.process(InputImage.fromBitmap(bmp, 0))
                    .addOnSuccessListener(text -> {
                        JSArray words = new JSArray();
                        for (Text.TextBlock b : text.getTextBlocks())
                            for (Text.Line l : b.getLines())
                                for (Text.Element el : l.getElements()) {
                                    Rect r = el.getBoundingBox();
                                    if (r == null) continue;
                                    JSObject wd = new JSObject();
                                    wd.put("t", el.getText());
                                    wd.put("x", r.left);
                                    wd.put("y", r.top);
                                    wd.put("w", r.width());
                                    wd.put("h", r.height());
                                    words.put(wd);
                                }
                        JSObject out = new JSObject();
                        out.put("text", text.getText());
                        out.put("words", words);
                        out.put("width", w);
                        out.put("height", h);
                        call.resolve(out);
                    })
                    .addOnFailureListener(e -> call.reject("OCR falló: " + e.getMessage(), e));
        } catch (Exception e) {
            call.reject("OCR falló: " + e.getMessage(), e);
        }
    }

    // ---------- Utilidades ----------

    private void persist(Uri uri) {
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) {
            try {
                getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored2) {
                // el proveedor no ofrece permisos persistentes; el archivo se abre igual en esta sesión
            }
        }
    }

    private JSObject fileInfo(Uri uri, boolean withData) throws Exception {
        JSObject f = new JSObject();
        f.put("uri", uri.toString());
        f.put("name", displayName(uri));
        String mime = getContext().getContentResolver().getType(uri);
        f.put("mime", mime == null ? "" : mime);
        if (withData) f.put("data", Base64.encodeToString(readAll(uri), Base64.NO_WRAP));
        return f;
    }

    private String displayName(Uri uri) {
        String name = null;
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {
            // sin nombre disponible
        }
        if (name == null) name = uri.getLastPathSegment();
        return name == null ? "documento.pdf" : name;
    }

    private byte[] readAll(Uri uri) throws Exception {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("No se pudo abrir " + uri);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private void writeTo(Uri uri, byte[] bytes) throws Exception {
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new Exception("No se pudo escribir en " + uri);
            out.write(bytes);
        }
    }

    private static String sanitize(String name) {
        return name.replaceAll("[\\\\/:*?\"<>|]", "_");
    }
}
