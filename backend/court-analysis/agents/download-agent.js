const { Tool } = require('@langchain/core/tools');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function downloadFile(url, filename) {
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const filePath = path.join(uploadsDir, filename);
    const writer = fs.createWriteStream(filePath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 60000
    });
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
    return filePath;
}

// LangChain Tool for downloading documents
class DownloadDocumentsTool extends Tool {
    constructor() {
        super();
        this.name = 'download_documents';
        this.description = 'Download documents from URLs and return file paths.';
    }
    /**
     * @param {{documentLinks: Array<{url: string, text: string}>, progressCallback?: function}} input
     * @returns {Promise<Array<{filePath: string, url: string, text: string}>>}
     */
    async _call(input) {
        const { documentLinks, progressCallback } = input;
        const downloaded = [];
        let completed = 0;
        for (const link of documentLinks) {
            try {
                const ext = path.extname(link.url).split('?')[0] || '.bin';
                const safeName = (link.text || 'document').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
                const filename = `${Date.now()}_${safeName}${ext}`;
                const filePath = await downloadFile(link.url, filename);
                downloaded.push({ filePath, url: link.url, text: link.text });
                completed++;
                progressCallback && progressCallback({ step: 'downloading', progress: 50 + Math.round((completed / documentLinks.length) * 30), message: `Downloaded: ${link.text}` });
            } catch (err) {
                progressCallback && progressCallback({ step: 'downloading', progress: 50 + Math.round((completed / documentLinks.length) * 30), message: `Failed to download: ${link.text}` });
            }
        }
        progressCallback && progressCallback({ step: 'downloading', progress: 80, message: 'All downloads complete.' });
        return downloaded;
    }
}

module.exports = { DownloadDocumentsTool };
