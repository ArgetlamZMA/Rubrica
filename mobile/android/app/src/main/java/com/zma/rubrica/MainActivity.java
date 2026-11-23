package com.zma.rubrica;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RubricaPlugin.class);
        super.onCreate(savedInstanceState);

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
}
