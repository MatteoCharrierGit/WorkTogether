package com.worktogether.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Cifratura della chiave OpenRouter a riposo (AES-256/GCM).
 * La chiave AES è derivata dal segreto applicativo (`app.ai.secret`).
 * Output: base64( iv[12] || ciphertext+tag ).
 */
@Component
public class AiKeyCipher {

    private static final int IV_LEN = 12;
    private static final int TAG_BITS = 128;
    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public AiKeyCipher(@Value("${app.ai.secret}") String secret) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(secret.getBytes(StandardCharsets.UTF_8));
            this.key = new SecretKeySpec(digest, "AES");
        } catch (Exception e) {
            throw new IllegalStateException("Impossibile inizializzare la cifratura", e);
        }
    }

    public String encrypt(String plain) {
        if (plain == null || plain.isEmpty()) return null;
        try {
            byte[] iv = new byte[IV_LEN];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] ct = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return Base64.getEncoder().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("Errore di cifratura", e);
        }
    }

    public String decrypt(String stored) {
        if (stored == null || stored.isEmpty()) return null;
        try {
            byte[] all = Base64.getDecoder().decode(stored);
            byte[] iv = new byte[IV_LEN];
            System.arraycopy(all, 0, iv, 0, IV_LEN);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] pt = cipher.doFinal(all, IV_LEN, all.length - IV_LEN);
            return new String(pt, StandardCharsets.UTF_8);
        } catch (Exception e) {
            // Chiave illeggibile (segreto cambiato o dato corrotto): trattala come assente.
            return null;
        }
    }

    /** Maschera per la UI: mostra inizio e fine, nasconde il resto. */
    public static String mask(String plain) {
        if (plain == null || plain.isEmpty()) return null;
        if (plain.length() <= 10) return "••••";
        return plain.substring(0, 6) + "…" + plain.substring(plain.length() - 4);
    }
}
