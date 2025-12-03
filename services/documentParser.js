// ═══════════════════════════════════════════════════════════════════════════════════
// 📄 DOCUMENT PARSER SERVICE
// ═══════════════════════════════════════════════════════════════════════════════════
// Parses Word (.docx), PDF, and TXT files into plain text for assessment analysis
// ═══════════════════════════════════════════════════════════════════════════════════

const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const path = require('path');

/**
 * Parse a document buffer into plain text
 * @param {Buffer} buffer - The file buffer
 * @param {string} filename - Original filename (for extension detection)
 * @returns {Promise<{text: string, metadata: object}>}
 */
async function parseDocument(buffer, filename) {
    const ext = path.extname(filename).toLowerCase();
    const startTime = Date.now();
    
    console.log(`📄 [PARSER] Processing ${filename} (${ext}, ${Math.round(buffer.length/1024)}KB)`);
    
    let result = {
        text: '',
        metadata: {
            filename,
            extension: ext,
            size: buffer.length,
            parseTime: 0,
            wordCount: 0,
            charCount: 0
        }
    };
    
    try {
        switch (ext) {
            case '.docx':
            case '.doc':
                result = await parseWord(buffer, result);
                break;
                
            case '.pdf':
                result = await parsePDF(buffer, result);
                break;
                
            case '.txt':
                result = await parseTXT(buffer, result);
                break;
                
            default:
                throw new Error(`Unsupported file type: ${ext}. Supported: .docx, .pdf, .txt`);
        }
        
        // Post-processing
        result.text = cleanText(result.text);
        result.metadata.wordCount = result.text.split(/\s+/).filter(w => w.length > 0).length;
        result.metadata.charCount = result.text.length;
        result.metadata.parseTime = Date.now() - startTime;
        
        console.log(`✅ [PARSER] Extracted ${result.metadata.wordCount} words in ${result.metadata.parseTime}ms`);
        
        return result;
        
    } catch (error) {
        console.error(`❌ [PARSER] Failed to parse ${filename}:`, error.message);
        throw error;
    }
}

/**
 * Parse Word document using mammoth
 */
async function parseWord(buffer, result) {
    const mammothResult = await mammoth.extractRawText({ buffer });
    result.text = mammothResult.value;
    result.metadata.messages = mammothResult.messages;
    return result;
}

/**
 * Parse PDF document using pdf-parse v2.x
 * New API: PDFParse({data: buffer}) -> load() -> getText()
 */
async function parsePDF(buffer, result) {
    const parser = new PDFParse({ data: buffer });
    await parser.load();
    
    let text = await parser.getText();
    const info = await parser.getInfo();
    
    // Handle if getText returns array of page texts
    if (Array.isArray(text)) {
        text = text.join('\n');
    }
    // Ensure text is a string
    result.text = String(text || '');
    result.metadata.pageCount = info?.numPages || null;
    result.metadata.pdfInfo = info;
    
    // Clean up
    parser.destroy();
    
    return result;
}

/**
 * Parse plain text file
 */
async function parseTXT(buffer, result) {
    // Try UTF-8 first, then fallback to latin1
    try {
        result.text = buffer.toString('utf8');
    } catch {
        result.text = buffer.toString('latin1');
    }
    return result;
}

/**
 * Clean extracted text
 * - Remove excessive whitespace
 * - Remove page numbers/headers/footers patterns
 * - Normalize line breaks
 */
function cleanText(text) {
    if (!text) return '';
    
    return text
        // Normalize line breaks
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        
        // Remove page number patterns (Page 1 of 10, p. 5, etc.)
        .replace(/Page\s*\d+\s*(of\s*\d+)?/gi, '')
        .replace(/^\s*\d+\s*$/gm, '')
        
        // Remove common header/footer patterns
        .replace(/^\s*(CONFIDENTIAL|DRAFT)\s*$/gim, '')
        
        // Collapse multiple blank lines into one
        .replace(/\n{3,}/g, '\n\n')
        
        // Collapse multiple spaces into one
        .replace(/[ \t]{2,}/g, ' ')
        
        // Trim lines
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        
        // Final trim
        .trim();
}

/**
 * Validate file before parsing
 */
function validateFile(buffer, filename, maxSizeMB = 10) {
    const ext = path.extname(filename).toLowerCase();
    const sizeMB = buffer.length / (1024 * 1024);
    
    const supportedExtensions = ['.docx', '.doc', '.pdf', '.txt'];
    
    if (!supportedExtensions.includes(ext)) {
        return {
            valid: false,
            error: `Unsupported file type: ${ext}. Supported: ${supportedExtensions.join(', ')}`
        };
    }
    
    if (sizeMB > maxSizeMB) {
        return {
            valid: false,
            error: `File too large: ${sizeMB.toFixed(2)}MB. Maximum: ${maxSizeMB}MB`
        };
    }
    
    if (buffer.length === 0) {
        return {
            valid: false,
            error: 'File is empty'
        };
    }
    
    return { valid: true };
}

module.exports = {
    parseDocument,
    validateFile,
    cleanText
};
