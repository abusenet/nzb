<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">

  <!-- Set the character set -->
  <xsl:output method="html" encoding="utf-8" indent="yes" media-type="text/html; charset=utf-8" />

  <xsl:template match="/*[local-name() = 'nzb']">
    <xsl:variable name="title" select="*/*[local-name() = 'meta' and @*[local-name() = 'type' and . = 'title']]" />

    <!-- Set the DOCTYPE targeting HTML5 -->
    <xsl:text disable-output-escaping='yes'>&lt;!DOCTYPE html></xsl:text>

    <html>
      <!-- Set default language to En. -->
      <xsl:attribute name="lang">en</xsl:attribute>
      <head>
        <title><xsl:value-of select="$title" /></title>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href='data:image/svg+xml,&lt;svg xmlns="http://www.w3.org/2000/svg"/>'></link>

        <script>
          window.addEventListener("load", function() {
            document.querySelector(`[name="q"]`).value = new URLSearchParams(location.search).get('q');
          });
        </script>
      </head>

      <body>
        <main>
          <h1>Index of <xsl:value-of select="$title" /></h1>

          <form>
            <label>
              Filter
              <input name="q" type="search" value="" />
            </label>
            <button type="submit">⏎</button>
          </form>

          <table cellpadding="6">

            <thead>
              <tr>
                <td></td>
                <th>Name</th>
                <th>Size</th>
                <th>Poster</th>
                <th>Last Modified Date</th>
              </tr>
            </thead>

            <tbody>
              <xsl:apply-templates select="*[local-name() = 'file']" />
            </tbody>

            <tfoot>
              <tr>
                <td>
                  <form id="bulk">
                    <button type="submit" formmethod="POST" formaction="?action=extract">Extract</button>
                  </form>
                </td>
              </tr>
            </tfoot>

          </table>
        </main>
      </body>
    </html>

  </xsl:template>

  <xsl:template match="*[local-name() = 'file']">
    <xsl:variable name="subject" select="@*[local-name() = 'subject']" />
    <xsl:variable name="name" select="substring-before(substring-after($subject, '&quot;'), '&quot;')" />
    <xsl:variable name="bytes" select="sum(.//*[local-name() = 'segment']/@*[local-name() = 'bytes'])" />

    <tr>
      <td>
        <input type="checkbox" name="files" value="$name" form="bulk" />
      </td>
      <td>
        <a href="{$name}"><xsl:value-of select="$name" /></a>
      </td>
      <td>
        <xsl:call-template name="prettyBytes">
          <xsl:with-param name="bytes" select="$bytes" />
        </xsl:call-template>
      </td>
      <td>
        <xsl:value-of select="@*[local-name() = 'poster']" disable-output-escaping="yes" />
      </td>
      <td>
        <xsl:call-template name="ISOString">
          <xsl:with-param name="unixTime" select="@*[local-name() = 'date']" />
        </xsl:call-template>
      </td>
    </tr>
  </xsl:template>

  <xsl:template name="prettyBytes">
    <xsl:param name="bytes" />
    <xsl:choose>
      <xsl:when test="round($bytes div 1024) &lt; 1">
        <xsl:value-of select="$bytes" /> B
      </xsl:when>
      <xsl:when test="round($bytes div 1048576) &lt; 1">
        <xsl:value-of select="format-number(($bytes div 1024), '0.0')" /> KB
      </xsl:when>
      <xsl:when test="round($bytes div 1073741824) &lt; 1">
        <xsl:value-of select="format-number(($bytes div 1048576), '0.0')" /> MB
      </xsl:when>
      <xsl:otherwise>
        <xsl:value-of select="format-number(($bytes div 1073741824), '0.00')" /> GB
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="ISOString">
    <xsl:param name="unixTime" />

    <xsl:variable name="JDN" select="floor($unixTime div 86400) + 2440588" />
    <xsl:variable name="secs" select="$unixTime mod 86400" />

    <xsl:variable name="f" select="$JDN + 1401 + floor((floor((4 * $JDN + 274277) div 146097) * 3) div 4) - 38"/>
    <xsl:variable name="e" select="4*$f + 3"/>
    <xsl:variable name="g" select="floor(($e mod 1461) div 4)"/>
    <xsl:variable name="h" select="5*$g + 2"/>

    <xsl:variable name="d" select="floor(($h mod 153) div 5 ) + 1"/>
    <xsl:variable name="m" select="(floor($h div 153) + 2) mod 12 + 1"/>
    <xsl:variable name="y" select="floor($e div 1461) - 4716 + floor((14 - $m) div 12)"/>

    <xsl:variable name="H" select="floor($secs div 3600)"/>
    <xsl:variable name="M" select="floor($secs mod 3600 div 60)"/>
    <xsl:variable name="S" select="$secs mod 60"/>

    <xsl:value-of select="$y"/>
    <xsl:text>-</xsl:text>
    <xsl:value-of select="format-number($m, '00')"/>
    <xsl:text>-</xsl:text>
    <xsl:value-of select="format-number($d, '00')"/>
    <xsl:text>T</xsl:text>
    <xsl:value-of select="format-number($H, '00')"/>
    <xsl:text>:</xsl:text>
    <xsl:value-of select="format-number($M, '00')"/>
    <xsl:text>:</xsl:text>
    <xsl:value-of select="format-number($S, '00')"/>
  </xsl:template>
</xsl:stylesheet>
