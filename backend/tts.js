const gTTS = require('gtts');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const config = require('./config/config');

// Ensure audio directory exists
async function ensureAudioDir() {
    try {
        await fs.access(config.storage.audioDir);
    } catch (error) {
        await fs.mkdir(config.storage.audioDir, { recursive: true });
        console.log('Created audio directory:', config.storage.audioDir);
    }
}

// Generate TTS audio file
async function generateTTS(text, language = config.tts.defaultLanguage) {
    try {
        await ensureAudioDir();
        
        // Validate text
        if (!text || text.length > config.tts.maxTextLength) {
            throw new Error(`Text must be between 1 and ${config.tts.maxTextLength} characters`);
        }
        
        // Validate language
        const lang = config.tts.supportedLanguages.includes(language) ? language : config.tts.defaultLanguage;
        
        // Generate unique filename
        const hash = crypto.createHash('md5').update(text + lang).digest('hex');
        const filename = `tts_${hash}.mp3`;
        const filepath = path.join(config.storage.audioDir, filename);
        
        // Check if file already exists (caching)
        if (config.tts.cacheEnabled) {
            try {
                await fs.access(filepath);
                console.log(`TTS cache hit: ${filename}`);
                return filename; // File exists, return filename
            } catch (error) {
                // File doesn't exist, generate it
            }
        }
        
        // Create gTTS instance
        const gtts = new gTTS(text, lang);
        
        // Generate audio file
        await new Promise((resolve, reject) => {
            gtts.save(filepath, (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
        
        console.log(`TTS generated: ${filename} (${lang})`);
        return filename;
        
    } catch (error) {
        console.error('TTS Generation Error:', error);
        throw new Error('Failed to generate audio: ' + error.message);
    }
}

// Generate TTS for multiple languages
async function generateMultiLanguageTTS(text, languages = [config.tts.defaultLanguage]) {
    const results = {};
    
    for (const lang of languages) {
        try {
            if (config.tts.supportedLanguages.includes(lang)) {
                const filename = await generateTTS(text, lang);
                results[lang] = filename;
            } else {
                console.warn(`Unsupported TTS language: ${lang}`);
                results[lang] = null;
            }
        } catch (error) {
            console.error(`TTS failed for language ${lang}:`, error);
            results[lang] = null;
        }
    }
    
    return results;
}

// Clean old audio files
async function cleanupOldAudioFiles() {
    try {
        const files = await fs.readdir(config.storage.audioDir);
        const now = Date.now();
        const maxAge = config.storage.audioRetentionHours * 60 * 60 * 1000;
        
        let cleanedCount = 0;
        
        for (const file of files) {
            if (file.startsWith('tts_') && file.endsWith('.mp3')) {
                const filepath = path.join(config.storage.audioDir, file);
                try {
                    const stats = await fs.stat(filepath);
                    
                    if (now - stats.mtimeMs > maxAge) {
                        await fs.unlink(filepath);
                        cleanedCount++;
                        console.log(`Cleaned up old audio file: ${file}`);
                    }
                } catch (error) {
                    console.error(`Error processing file ${file}:`, error);
                }
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`Audio cleanup completed: ${cleanedCount} files removed`);
        }
        
    } catch (error) {
        console.error('Audio cleanup error:', error);
    }
}

// Get supported languages list
function getSupportedLanguages() {
    return config.tts.supportedLanguages;
}

// Validate TTS text
function validateTTSText(text) {
    if (!text || typeof text !== 'string') {
        throw new Error('Text is required and must be a string');
    }
    
    if (text.length > config.tts.maxTextLength) {
        throw new Error(`Text too long (max ${config.tts.maxTextLength} characters)`);
    }
    
    return text.trim();
}

// Get audio file info
async function getAudioFileInfo(filename) {
    try {
        const filepath = path.join(config.storage.audioDir, filename);
        const stats = await fs.stat(filepath);
        
        return {
            filename: filename,
            size: stats.size,
            sizeKB: Math.round(stats.size / 1024),
            created: stats.birthtime,
            modified: stats.mtime,
            path: filepath
        };
    } catch (error) {
        throw new Error('Audio file not found: ' + filename);
    }
}

// Get audio directory statistics
async function getAudioStats() {
    try {
        const files = await fs.readdir(config.storage.audioDir);
        const audioFiles = files.filter(f => f.startsWith('tts_') && f.endsWith('.mp3'));
        
        let totalSize = 0;
        const fileDetails = [];
        
        for (const file of audioFiles) {
            try {
                const filepath = path.join(config.storage.audioDir, file);
                const stats = await fs.stat(filepath);
                totalSize += stats.size;
                fileDetails.push({
                    name: file,
                    size: stats.size,
                    created: stats.birthtime
                });
            } catch (error) {
                console.error(`Error reading file ${file}:`, error);
            }
        }
        
        return {
            totalFiles: audioFiles.length,
            totalSizeBytes: totalSize,
            totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
            oldestFile: fileDetails.length > 0 ? 
                fileDetails.sort((a, b) => a.created - b.created)[0] : null,
            newestFile: fileDetails.length > 0 ? 
                fileDetails.sort((a, b) => b.created - a.created)[0] : null
        };
    } catch (error) {
        console.error('Audio stats error:', error);
        return {
            totalFiles: 0,
            totalSizeBytes: 0,
            totalSizeMB: 0,
            oldestFile: null,
            newestFile: null
        };
    }
}

// Schedule cleanup based on config
if (config.storage.audioRetentionHours > 0) {
    const cleanupInterval = Math.min(config.storage.audioRetentionHours * 60 * 60 * 1000, 24 * 60 * 60 * 1000); // Max 24 hours
    setInterval(cleanupOldAudioFiles, cleanupInterval);
    console.log(`Audio cleanup scheduled every ${cleanupInterval / (60 * 60 * 1000)} hours`);
}

// Initial cleanup on startup
cleanupOldAudioFiles();

// Log TTS configuration on startup
console.log(`🔊 TTS Configuration:`);
console.log(`  - Supported Languages: ${config.tts.supportedLanguages.join(', ')}`);
console.log(`  - Default Language: ${config.tts.defaultLanguage}`);
console.log(`  - Cache Enabled: ${config.tts.cacheEnabled}`);
console.log(`  - Max Text Length: ${config.tts.maxTextLength} characters`);
console.log(`  - Audio Directory: ${config.storage.audioDir}`);
console.log(`  - Retention: ${config.storage.audioRetentionHours} hours`);

module.exports = {
    generateTTS,
    generateMultiLanguageTTS,
    cleanupOldAudioFiles,
    getSupportedLanguages,
    validateTTSText,
    getAudioFileInfo,
    getAudioStats,
    SUPPORTED_LANGUAGES: config.tts.supportedLanguages
};