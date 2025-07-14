const { Tool } = require('@langchain/core/tools');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

class ExtractArchiveTool extends Tool {
    constructor() {
        super();
        this.name = 'extract_archive';
        this.description = 'Extracts ZIP archives to a destination folder.';
    }
    /**
     * @param {{filePath: string, destination: string}} input
     * @returns {Promise<{status: string, extractedFiles?: string[], error_message?: string}>}
     */
    async _call(input) {
        const { filePath, destination } = input;
        try {
            if (!fs.existsSync(filePath)) {
                return { status: 'error', error_message: `Archive file not found: ${filePath}` };
            }
            if (!fs.existsSync(destination)) {
                fs.mkdirSync(destination, { recursive: true });
            }
            const zip = new AdmZip(filePath);
            zip.extractAllTo(destination, true);
            const extractedFiles = zip.getEntries().map(e => e.entryName);
            return { status: 'success', extractedFiles };
        } catch (err) {
            return { status: 'error', error_message: `Extraction failed: ${err.message}` };
        }
    }
}

module.exports = { ExtractArchiveTool };
