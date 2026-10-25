export function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

// Strip line breaks so user input cannot inject email headers into the subject.
export function cleanLine(value: string) {
  return value.replaceAll(/[\r\n]+/g, ' ').trim()
}

export interface EmailContent {
  heading: string
  intro: string
  details?: Array<[label: string, value: string]>
  cta?: { label: string; url: string }
}

export function renderEmail({ heading, intro, details = [], cta }: EmailContent) {
  const rows = details.map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(label)}</td><td style="padding:4px 0"><strong>${escapeHtml(value).replaceAll('\n', '<br>')}</strong></td></tr>`).join('')
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">`
    + `<h2 style="margin:0 0 12px">${escapeHtml(heading)}</h2>`
    + `<p>${escapeHtml(intro).replaceAll('\n', '<br>')}</p>`
    + (rows ? `<table style="border-collapse:collapse;margin:12px 0">${rows}</table>` : '')
    + (cta ? `<p><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px">${escapeHtml(cta.label)}</a></p>` : '')
    + `<p style="color:#666;font-size:12px">Empire Nigeria property care</p></div>`
  const text = [heading, '', intro, ...(details.length ? ['', ...details.map(([label, value]) => `${label}: ${value}`)] : []), ...(cta ? ['', `${cta.label}: ${cta.url}`] : [])].join('\n')
  return { html, text }
}
