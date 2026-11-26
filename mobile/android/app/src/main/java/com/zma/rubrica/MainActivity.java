package com.zma.rubrica;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.appcompat.app.AlertDialog;
import androidx.webkit.WebViewFeature;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RubricaPlugin.class);
        super.onCreate(savedInstanceState);
        warnIfOldWebView();

        // Botón «Atrás»: primero cierra ventanas, herramientas o el documento; si no hay nada, sale.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() != null ? getBridge().getWebView() : null;
                if (web == null) { exit(); return; }
                web.evaluateJavascript("(window.pdfsBack && window.pdfsBack()) ? '1' : '0'", value -> {
                    if (!"\"1\"".equals(value)) exit();
                });
            }

            private void exit() {
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    /**
     * La interfaz declara una política de seguridad (CSP) que solo deja ejecutar sus propios scripts.
     * Capacitor inyecta su puente antes de cargar la página (addDocumentStartJavaScript), lo que la política
     * permite. En un WebView muy antiguo (anterior a 2021) lo insertaría dentro del HTML, la política lo
     * bloquearía y las funciones del teléfono (firmar, guardar, escanear) no estarían disponibles.
     */
    private void warnIfOldWebView() {
        boolean ok;
        try { ok = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT); } catch (Throwable t) { ok = true; }
        if (ok) return;
        new AlertDialog.Builder(this)
            .setTitle("Actualice Android System WebView")
            .setMessage("El componente que muestra Rúbrica en este teléfono es muy antiguo. Actualice «Android System WebView» (o Google Chrome) desde Google Play para firmar, guardar y escanear documentos.")
            .setPositiveButton("Abrir Google Play", (d, w) -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.webview"))); }
                catch (Exception e) { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.webview"))); }
            })
            .setNegativeButton("Más tarde", null)
            .show();
    }
}
