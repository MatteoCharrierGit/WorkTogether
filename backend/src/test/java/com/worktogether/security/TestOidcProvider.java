package com.worktogether.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Mini "Authentik" per i test: chiave RSA generata al volo, JWKS servito su HTTP locale
 * (porta casuale) e firma di access token con i claim scelti dal test.
 */
public final class TestOidcProvider implements AutoCloseable {

    public static final String AUDIENCE = "worktogether";

    private final RSAKey key;
    private final RSAKey otherKey;
    private final HttpServer server;

    public TestOidcProvider() throws Exception {
        key = new RSAKeyGenerator(2048).keyID("test-kid").generate();
        otherKey = new RSAKeyGenerator(2048).keyID("test-kid").generate(); // stesso kid, chiave diversa
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        byte[] jwks = new JWKSet(key.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
        server.createContext("/application/o/worktogether/jwks/", ex -> {
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, jwks.length);
            ex.getResponseBody().write(jwks);
            ex.close();
        });
        server.start();
    }

    public String issuer() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/application/o/worktogether/";
    }

    public String jwksUrl() {
        return issuer() + "jwks/";
    }

    /** Token valido (5 minuti) con i claim di base; {@code custom} può modificarli. */
    public String token(String sub, Consumer<JWTClaimsSet.Builder> custom) throws Exception {
        return sign(key, claims(sub, custom));
    }

    /** Stessi claim ma firmato con una chiave non pubblicata nel JWKS. */
    public String tokenSignedByOtherKey(String sub) throws Exception {
        return sign(otherKey, claims(sub, b -> {}));
    }

    private JWTClaimsSet claims(String sub, Consumer<JWTClaimsSet.Builder> custom) {
        Instant now = Instant.now();
        JWTClaimsSet.Builder b = new JWTClaimsSet.Builder()
                .issuer(issuer())
                .audience(AUDIENCE)
                .subject(sub)
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plusSeconds(300)))
                .claim("azp", AUDIENCE)
                .claim("scope", "openid profile email offline_access");
        custom.accept(b);
        return b.build();
    }

    private static String sign(RSAKey k, JWTClaimsSet claims) throws Exception {
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(k.getKeyID()).build(), claims);
        jwt.sign(new RSASSASigner(k));
        return jwt.serialize();
    }

    public static Consumer<JWTClaimsSet.Builder> profile(String email, boolean verified, String name) {
        return b -> {
            for (Map.Entry<String, Object> e : Map.<String, Object>of(
                    "email", email, "email_verified", verified, "name", name,
                    "preferred_username", name.toLowerCase().replace(' ', '.')).entrySet()) {
                b.claim(e.getKey(), e.getValue());
            }
        };
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
