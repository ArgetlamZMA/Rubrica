package com.zma.rubrica;

import android.content.Context;
import android.security.KeyChain;

import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.X509Certificate;

/**
 * Acceso a los certificados de usuario instalados en Android (KeyChain), por ejemplo la firma
 * electrónica del SAR importada desde su archivo .pfx. Android pide al usuario, una sola vez,
 * permiso para que Rúbrica use el certificado; la clave privada nunca sale del almacén del sistema.
 * Estos métodos bloquean: llámelos fuera del hilo principal.
 */
final class AndroidCertificates {
    private AndroidCertificates() {}

    static X509Certificate[] chain(Context ctx, String alias) throws Exception {
        X509Certificate[] chain = KeyChain.getCertificateChain(ctx, alias);
        if (chain == null || chain.length == 0)
            throw new Exception("El certificado «" + alias + "» ya no está instalado o Rúbrica no tiene permiso para usarlo. Elíjalo de nuevo.");
        return chain;
    }

    /** Firma SHA-256 (RSA PKCS#1 v1.5 o ECDSA) de los atributos firmados del CMS. */
    static byte[] sign(Context ctx, String alias, byte[] data) throws Exception {
        PrivateKey key = KeyChain.getPrivateKey(ctx, alias);
        if (key == null)
            throw new Exception("Rúbrica no tiene permiso para usar el certificado «" + alias + "». Elíjalo de nuevo.");
        Signature s = Signature.getInstance("EC".equals(key.getAlgorithm()) ? "SHA256withECDSA" : "SHA256withRSA");
        s.initSign(key);
        s.update(data);
        return s.sign();
    }
}
