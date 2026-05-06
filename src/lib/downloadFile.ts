export async function downloadFileFromUrl(url: string, suggestedName?: string) {
  try {
    // Attempt: create anchor with download attribute
    const a = document.createElement('a');
    a.href = url;
    if (suggestedName) a.download = suggestedName;
    // If same-origin or served with proper headers, this will download
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  } catch (e) {
    // fall through to blob fetch
  }

  try {
    const resp = await fetch(url, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('Network error');
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = suggestedName || (url.split('/').pop() || 'download');
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    throw err;
  }
}
