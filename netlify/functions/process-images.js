import { Buffer } from 'buffer';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import AdmZip from 'adm-zip';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  const tmpDir = '/tmp';
  const inputDir = path.join(tmpDir, `input-${Date.now()}`);
  const outputDir = path.join(tmpDir, `output-${Date.now()}`);

  try {
    // Parse multipart form data
    const boundary = event.headers['content-type'].split('boundary=')[1];
    const parts = parseMultipart(Buffer.from(event.body, 'base64'), boundary);

    // Create input directory
    await fs.mkdir(inputDir, { recursive: true });

    // Extract files
    for (const part of parts) {
      if (part.filename) {
        const filePath = path.join(inputDir, part.filename);
        
        // If ZIP, extract it
        if (part.filename.endsWith('.zip')) {
          const zip = new AdmZip(part.data);
          zip.extractAllTo(inputDir, true);
        } else {
          await fs.writeFile(filePath, part.data);
        }
      }
    }

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    // Execute generate-images.cjs
    const scriptPath = path.join(__dirname, '../../scripts/generate-images.cjs');
    const generateImages = require(scriptPath);
    
    await generateImages(inputDir, outputDir);

    // Create output ZIP
    const outputZip = new AdmZip();
    await addDirectoryToZip(outputZip, outputDir, '');

    const zipBuffer = outputZip.toBuffer();

    // Cleanup
    await fs.rm(inputDir, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="diag360-images.zip"'
      },
      body: zipBuffer.toString('base64'),
      isBase64Encoded: true
    };

  } catch (error) {
    console.error('Error:', error);
    
    // Cleanup on error
    try {
      await fs.rm(inputDir, { recursive: true, force: true });
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch {}

    return {
      statusCode: 500,
      body: `Erreur de traitement : ${error.message}`
    };
  }
};

// Helper: Parse multipart form data
function parseMultipart(buffer, boundary) {
  const parts = [];
  const delimiter = Buffer.from(`--${boundary}`);
  const sections = [];
  
  let start = 0;
  while (true) {
    const pos = buffer.indexOf(delimiter, start);
    if (pos === -1) break;
    if (start !== 0) {
      sections.push(buffer.slice(start, pos));
    }
    start = pos + delimiter.length;
  }

  for (const section of sections) {
    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = section.slice(0, headerEnd).toString();
    const data = section.slice(headerEnd + 4, section.length - 2);

    const filenameMatch = headers.match(/filename="([^"]+)"/);
    if (filenameMatch) {
      parts.push({
        filename: filenameMatch[1],
        data: data
      });
    }
  }

  return parts;
}

// Helper: Add directory to ZIP recursively
async function addDirectoryToZip(zip, dirPath, zipPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const zipEntryPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, fullPath, zipEntryPath);
    } else {
      const content = await fs.readFile(fullPath);
      zip.addFile(zipEntryPath, content);
    }
  }
}