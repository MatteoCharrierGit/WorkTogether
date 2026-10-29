package com.worktogether.security;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.web.client.RestTemplate;

import java.util.Collection;
import java.util.List;

/**
 * Validazione degli access token emessi da Authentik (OIDC, client pubblico con PKCE):
 * firma RS256 verificata con le chiavi del JWKS, {@code iss} uguale a OIDC_ISSUER, {@code aud}
 * che contiene OIDC_AUDIENCE (il client id), {@code exp} presente e non superato (60 s di
 * tolleranza sull'orologio), {@code sub} presente.
 *
 * <p>Il JWKS si scarica da OIDC_JWKS_URL se impostato (in produzione l'URL interno della rete
 * Docker, es. {@code http://authentik-server:9000/application/o/worktogether/jwks/}), altrimenti
 * da {@code <issuer>jwks/}. L'issuer controllato nel token resta sempre quello pubblico.
 * Le chiavi sono messe in cache da Nimbus e riscaricate quando arriva un {@code kid} sconosciuto.
 */
@Slf4j
@Configuration
public class OidcConfig {

    @Bean
    public JwtDecoder oidcJwtDecoder(
            @Value("${app.oidc.issuer:}") String issuer,
            @Value("${app.oidc.audience:}") String audience,
            @Value("${app.oidc.jwks-url:}") String jwksUrl) {
        if (issuer == null || issuer.isBlank() || audience == null || audience.isBlank()) {
            log.error("OIDC_ISSUER/OIDC_AUDIENCE non configurati: nessun access token utente sarà accettato");
            return token -> { throw new BadJwtException("OIDC non configurato"); };
        }
        String jwks = (jwksUrl == null || jwksUrl.isBlank()) ? defaultJwksUrl(issuer) : jwksUrl.trim();
        SimpleClientHttpRequestFactory http = new SimpleClientHttpRequestFactory();
        http.setConnectTimeout(5_000);
        http.setReadTimeout(5_000);
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(jwks)
                .jwsAlgorithm(SignatureAlgorithm.RS256)
                .restOperations(new RestTemplate(http))
                .build();
        decoder.setJwtValidator(validator(issuer.trim(), audience.trim()));
        log.info("OIDC: issuer={}, audience={}, jwks={}", issuer, audience, jwks);
        return decoder;
    }

    static String defaultJwksUrl(String issuer) {
        String base = issuer.trim();
        return (base.endsWith("/") ? base : base + "/") + "jwks/";
    }

    /** iss + exp/nbf (JwtTimestampValidator) + aud + presenza di exp e sub. */
    public static OAuth2TokenValidator<Jwt> validator(String issuer, String audience) {
        return new DelegatingOAuth2TokenValidator<>(List.of(
                JwtValidators.createDefaultWithIssuer(issuer),
                new JwtClaimValidator<Object>(JwtClaimNames.EXP, exp -> exp != null),
                new JwtClaimValidator<Object>(JwtClaimNames.SUB, sub -> sub instanceof String s && !s.isBlank()),
                new JwtClaimValidator<Object>(JwtClaimNames.AUD, aud -> audienceMatches(aud, audience))
        ));
    }

    private static boolean audienceMatches(Object aud, String audience) {
        if (aud instanceof String s) return s.equals(audience);
        if (aud instanceof Collection<?> c) return c.contains(audience);
        return false;
    }
}
