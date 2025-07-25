// agents/download-agent.js

const { Tool } = require('@langchain/core/tools');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mime = require('mime-types');

// agents/download-agent.js -> inside the downloadFile function

async function downloadFile(url, baseFilename, fallbackLinkText) {
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 60000,
    });

    const headers = response.headers;
    let extension = '';

    // --- Start Debug Logging ---
    console.log('[Downloader] Response Headers:', {
        'content-type': headers['content-type'],
        'content-disposition': headers['content-disposition'],
    });
    // --- End Debug Logging ---

    // 1. BEST CASE: Use the filename from the Content-Disposition header.
    // This is the most reliable source.
    const contentDisposition = headers['content-disposition'];
    if (contentDisposition) {
        // This regex looks for filename="some.pdf" or filename*=UTF-8''some.pdf
        const filenameMatch = contentDisposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/);
        if (filenameMatch && filenameMatch[1]) {
            // Decode the filename if it's URL-encoded
            const serverFilename = decodeURIComponent(filenameMatch[1].replace(/"/g, ''));
            const serverExt = path.extname(serverFilename);
            if (serverExt) {
                extension = serverExt;
                console.log(`[Downloader] Found extension '${extension}' from Content-Disposition.`);
            }
        }
    }

    // 2. GOOD FALLBACK: If no extension from Content-Disposition, try Content-Type.
    if (!extension) {
        const contentType = headers['content-type'];
        const mimeExt = mime.extension(contentType);
        if (mimeExt && mimeExt !== 'bin') { // Ignore generic 'bin' from octet-stream
            extension = `.${mimeExt}`;
            console.log(`[Downloader] Found extension '${extension}' from Content-Type: ${contentType}.`);
        }
    }

    // 3. LAST RESORT: If STILL no extension, use our link text fallback.
    if (!extension) {
        console.log('[Downloader] No specific extension found in headers. Using link text fallback.');
        if (fallbackLinkText && fallbackLinkText.toLowerCase().includes('zip')) {
            extension = '.zip';
        } else {
            // This is our ultimate fallback. A file MUST have an extension.
            extension = '.bin'; // a generic binary file
        }
        console.log(`[Downloader] Using fallback extension: '${extension}'`);
    }

    const finalFilename = `${baseFilename}${extension}`;
    const filePath = path.join(uploadsDir, finalFilename);
    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', (err) => { fs.unlink(filePath, () => reject(err)); });
        response.data.on('error', (err) => { writer.close(); fs.unlink(filePath, () => reject(err)); });
    });

    console.log(`[Downloader] Successfully saved file: ${filePath}`);
    return filePath;
}


class DownloadDocumentsTool extends Tool {
    constructor() {
        super();
        this.name = 'download_documents';
        this.description = 'Download documents from URLs and return file paths.';
    }

    async _call(input) {
        // ... (This function is also correct from the previous reply)
        const { documentLinks, progressCallback } = input;
        const downloaded = [];
        let completed = 0;

        for (const link of documentLinks) {
            try {
                const safeName = (link.text || 'document').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
                const baseFilename = `${Date.now()}_${safeName}`;
                const filePath = await downloadFile(link.url, baseFilename, link.text);
                downloaded.push({ filePath, url: link.url, text: link.text });
                completed++;
                const currentProgress = 50 + Math.round((completed / documentLinks.length) * 30);
                progressCallback && progressCallback({ step: 'downloading', progress: currentProgress, message: `Downloaded: ${path.basename(filePath)}` });
            } catch (err) {
                console.error(`[Downloader] Failed to download ${link.text} from ${link.url}:`, err.message);
                completed++;
                const currentProgress = 50 + Math.round((completed / documentLinks.length) * 30);
                progressCallback && progressCallback({ step: 'downloading', progress: currentProgress, message: `Failed: ${link.text}` });
            }
        }
        progressCallback && progressCallback({ step: 'downloading', progress: 80, message: 'All downloads attempted.' });
        return downloaded;
    }
}

module.exports = { DownloadDocumentsTool };