package com.worktogether.service;

import org.commonmark.node.Node;
import org.commonmark.parser.Parser;
import org.commonmark.renderer.html.HtmlRenderer;
import org.springframework.stereotype.Component;

/**
 * Converte il corpo Markdown delle email in HTML e lo incapsula in un template
 * responsive inline-styled (i client email non supportano CSS esterno).
 * Riutilizzabile sia per l'invio manuale (admin) sia per le email automatiche.
 */
@Component
public class MarkdownEmailRenderer {

    private final Parser parser = Parser.builder().build();
    private final HtmlRenderer renderer = HtmlRenderer.builder().build();

    /** Renderizza solo il frammento HTML del corpo (senza wrapper). */
    public String renderBody(String markdown) {
        if (markdown == null || markdown.isBlank()) return "";
        Node document = parser.parse(markdown);
        return renderer.render(document);
    }

    /**
     * Restituisce un documento HTML completo pronto per l'invio email,
     * con il corpo Markdown renderizzato e stili inline di base.
     */
    public String renderEmail(String markdown) {
        String body = renderBody(markdown);
        return """
                <!DOCTYPE html>
                <html lang="it">
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                </head>
                <body style="margin:0;padding:0;background-color:#f4f5f7;">
                  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;">
                    <tr>
                      <td align="center" style="padding:24px 12px;">
                        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%%;background-color:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
                          <tr>
                            <td style="padding:32px 40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">
                              %s
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:16px 40px;border-top:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#9ca3af;">
                              Inviato tramite WorkTogether
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </body>
                </html>
                """.formatted(body);
    }
}
