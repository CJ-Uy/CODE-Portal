/**
 * The copyable starting point for HTML emails. Its comment is written for whoever edits it next, a person or an AI
 * tool, and is stripped on send. Keep it free of malformed or unknown {{tags}}: comments are still scanned for fields.
 */
export function baseHtmlTemplate(baseUrl: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<!--
  CODE Mail base template

  HOW TO USE
  Paste this whole file into your AI tool (or edit it yourself) and describe the email
  you want: the message, the sections, the links. Paste the result into CODE Mail,
  Content step, HTML. Check the preview in light, dark and phone width before sending.

  RULES FOR WHOEVER EDITS THIS FILE, PERSON OR AI
  1. Lay out with tables (role="presentation"). Never use flexbox, grid, float or
     position: Outlook for Windows renders email with Microsoft Word and ignores them.
  2. Put CSS in the <style> block below or in style="" attributes. CODE Mail copies the
     <style> rules into style attributes when it sends and keeps the <style> block for
     clients that read it. No <link> stylesheets and no @import.
  3. No CSS variables. Every font-family ends in a generic family, for example
     Helvetica, Arial, sans-serif. Web fonts only load in Apple Mail.
  4. Images need an absolute https:// URL, a width attribute and alt text. Put a
     background color behind any background image: Outlook for Windows hides them.
  5. Links start with https:// or mailto:. Anything else is replaced with "#".
  6. Dark mode: every rule inside @media (prefers-color-scheme: dark) needs !important,
     or the inlined light styles win. Apple Mail and iOS Mail use those rules. The Gmail
     app and Outlook invert colors on their own, so keep strong contrast in both modes.
  7. Scripts, forms, buttons, video, iframes, SVG and comments are removed on send.
     Keep the file under about 90 KB; Gmail cuts off longer emails.
  8. Do not add a footer or unsubscribe link. CODE Mail adds the required footer.

  MERGE FIELDS
  Write a field in double curly braces anywhere in text or inside an https link:
    {{first_name}}  {{full_name}}  {{nickname}}  {{batch}}  {{email}}
  Each column of a sheet imported in the Personalization step is a field as well.
  A column named "Custom Message" becomes custom_message, written in double curly
  braces. Use only lowercase letters, numbers and underscores in field names.
-->
<style>
  /* Light mode. These rules are copied into style attributes when the email is sent. */
  body { margin: 0; padding: 0; background-color: #F5F5F6; }
  .page { background-color: #F5F5F6; }
  .card { background-color: #FFFFFF; border-radius: 12px; }
  .heading { font-family: Georgia, 'Times New Roman', serif; font-weight: normal; color: #06192F; }
  .text { font-family: Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #121315; }
  .muted { font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #3D5266; }
  .button-cell { background-color: #06192F; border-radius: 8px; }
  .button-link { font-family: Helvetica, Arial, sans-serif; font-size: 16px; font-weight: bold; color: #FFFFFF; text-decoration: none; }
  .rule { border-top: 1px solid #D7DFE9; }

  /* Phones: the card fills the screen and the side padding shrinks. */
  @media (max-width: 620px) {
    .container { width: 100% !important; }
    .pad { padding-left: 20px !important; padding-right: 20px !important; }
  }

  /* Dark mode in Apple Mail and iOS Mail. Every declaration needs !important. */
  @media (prefers-color-scheme: dark) {
    body, .page { background-color: #0B1220 !important; }
    .card { background-color: #121A2B !important; }
    .heading { color: #D7DFE9 !important; }
    .text { color: #E6EBF1 !important; }
    .muted { color: #AAAFB5 !important; }
    .button-cell { background-color: #D7DFE9 !important; }
    .button-link { color: #06192F !important; }
    .rule { border-top-color: #3D5266 !important; }
    .logo-light { display: none !important; }
    .logo-dark { display: block !important; }
  }

  /* Dark mode in Outlook.com, which marks recolored elements with data-ogsc and data-ogsb. */
  [data-ogsc] .heading { color: #D7DFE9 !important; }
  [data-ogsc] .text { color: #E6EBF1 !important; }
  [data-ogsb] .card { background-color: #121A2B !important; }
</style>
</head>
<body>
  <!-- Full-width background. -->
  <table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding: 24px 12px;">

        <!-- The card. 600px is the widest layout every client shows without scrolling. -->
        <table role="presentation" class="container card" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 600px; max-width: 600px;">

          <!-- Logo: navy in light mode, white in dark mode. mso-hide keeps Outlook from showing both. -->
          <tr>
            <td class="pad" style="padding: 28px 32px 12px;">
              <img class="logo-light" src="${baseUrl}/code-logo-full-navy.png" width="120" alt="CODE" style="display: block; width: 120px; height: auto; border: 0;">
              <img class="logo-dark" src="${baseUrl}/code-logo-full-white.png" width="120" alt="CODE" style="display: none; mso-hide: all; width: 120px; height: auto; border: 0;">
            </td>
          </tr>

          <!-- Heading. -->
          <tr>
            <td class="pad" style="padding: 8px 32px 0;">
              <h1 class="heading" style="margin: 0 0 12px; font-size: 28px; line-height: 1.25;">Hi {{first_name}},</h1>
            </td>
          </tr>

          <!-- Body text. Use one <p> per paragraph. -->
          <tr>
            <td class="pad" style="padding: 0 32px;">
              <p class="text" style="margin: 0 0 16px;">Write the message here. Keep paragraphs short and put the one thing you want readers to do in the button below.</p>
              <p class="text" style="margin: 0 0 16px;">Batch {{batch}} can find the details in the CODE Portal.</p>
            </td>
          </tr>

          <!-- Button built from a table cell, so it keeps its color and size in Outlook. -->
          <tr>
            <td class="pad" style="padding: 8px 32px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="button-cell" align="center">
                    <a class="button-link" href="${baseUrl}/portal" style="display: inline-block; padding: 12px 22px;">Open the portal</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider and a closing note. -->
          <tr>
            <td class="pad" style="padding: 0 32px 28px;">
              <div class="rule" style="height: 1px; line-height: 1px; font-size: 1px;">&nbsp;</div>
              <p class="muted" style="margin: 16px 0 0;">Questions? Reply to this email and the CODE team will get back to you.</p>
            </td>
          </tr>

        </table>
        <!-- CODE Mail adds the footer with preferences and unsubscribe links below this point. -->

      </td>
    </tr>
  </table>
</body>
</html>
`;
}
