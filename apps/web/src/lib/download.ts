// Trigger a client-side download of a text payload (CSV exports, #29). The server
// returns the CSV as a GraphQL string field; we wrap it in a Blob and click a
// transient anchor so no extra HTTP route or auth plumbing is needed.
export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
