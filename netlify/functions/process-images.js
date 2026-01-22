const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const sharp = require('sharp');

exports.handler = async (event) => {
  console.log('🚀 Function started');
  console.log('Method:', event.httpMethod);
  
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ error: 'Method Not Allowed' }) 
    };
  }

  const tmpDir = '/tmp';
  const inputDir = path.join(tmpDir, `input-${Date.now()}`);
  const outputDir = path.join(tmpDir, `output-${Date.now()}`);

  try {
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    console.log('📦 Content-Type:', contentType);
    
    if (!contentType.includes('multipart/form-data')) {
      throw new Error('Content-Type must be multipart/form-data');
    }

    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      throw new Error('No boundary found');
    }
    const boundary = boundaryMatch[1];

    const bodyBuffer = Buffer.from(event.body, 'base64');
    const parts = parseMultipart(bodyBuffer, boundary);
    console.log(`📦 Found ${parts.length} file(s)`);

    if (parts.length === 0) {
      throw new Error('No files uploaded');
    }

    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    console.log('📁 Directories created');

    for (const part of parts) {
      if (part.filename) {
        console.log('💾 Processing:', part.filename);
        
        if (part.filename.endsWith('.zip')) {
          const zip = new AdmZip(part.data);
          zip.extractAllTo(inputDir, true);
          console.log('📂 ZIP extracted');
        } else {
          const filePath = path.join(inputDir, part.filename);
          await fs.writeFile(filePath, part.data);
        }
      }
    }

    console.log('🖼️ Starting image generation...');
    await generateImages(inputDir, outputDir);

    console.log('📦 Creating output ZIP...');
    const outputZip = new AdmZip();
    await addDirectoryToZip(outputZip, outputDir, '');
    const zipBuffer = outputZip.toBuffer();
    console.log('✅ ZIP ready:', zipBuffer.length, 'bytes');

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
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);

    try {
      await fs.rm(inputDir, { recursive: true, force: true });
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch {}

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.message,
        stack: error.stack
      })
    };
  }
};

function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const sections = [];

  let start = 0;
  while (true) {
    const pos = buffer.indexOf(boundaryBuffer, start);
    if (pos === -1) break;
    if (start !== 0) {
      sections.push(buffer.slice(start, pos));
    }
    start = pos + boundaryBuffer.length;
  }

  for (const section of sections) {
    const headerEnd = section.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;

    const headers = section.slice(0, headerEnd).toString();
    const data = section.slice(headerEnd + 4, section.length - 2);

    const filenameMatch = headers.match(/filename="([^"]+)"/);
    if (filenameMatch) {
      parts.push({ filename: filenameMatch[1], data: data });
    }
  }

  return parts;
}

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

async function generateImages(inputDir, outputDir) {
  const files = await fs.readdir(inputDir);
  const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));

  console.log(`📷 Found ${imageFiles.length} image(s)`);

  if (imageFiles.length === 0) {
    throw new Error('No images found');
  }

  const sizes = [
    { width: 480, suffix: '@1x', label: 'mobile' },
    { width: 768, suffix: '@2x', label: 'tablet' },
    { width: 1280, suffix: '@3x', label: 'desktop' },
    { width: 1920, suffix: '@4x', label: 'large' }
  ];

  for (const file of imageFiles) {
    const inputPath = path.join(inputDir, file);
    const basename = path.parse(file).name;
    const imageFolderPath = path.join(outputDir, basename);
    
    await fs.mkdir(imageFolderPath, { recursive: true });

    for (const size of sizes) {
      const outputPath = path.join(imageFolderPath, `${basename}${size.suffix}.webp`);
      await sharp(inputPath)
        .resize(size.width, null, { withoutEnlargement: true, fit: 'inside' })
        .webp({ quality: 85 })
        .toFile(outputPath);
      
      console.log(`  ✓ ${basename}${size.suffix}.webp`);
    }

    console.log(`✅ ${file} done`);
  }

  console.log(`🎉 ${imageFiles.length} folders created`);
}